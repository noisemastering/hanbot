// utils/mlProductNormalization.js
// AI-assisted product normalization — maps ML item titles to our ProductFamily tree.

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const MLOrder = require("../models/MLOrder");
const MLProductMapping = require("../models/MLProductMapping");
const ProductFamily = require("../models/ProductFamily");

/**
 * Bootstrap mappings from existing ProductFamily.onlineStoreLinks.
 * If a ProductFamily has an ML link, we can auto-map any order with that item ID.
 */
async function bootstrapFromExistingLinks() {
  const families = await ProductFamily.find({
    sellable: true,
    active: true,
    'onlineStoreLinks.0': { $exists: true }
  }).lean();

  let created = 0;
  for (const fam of families) {
    for (const link of (fam.onlineStoreLinks || [])) {
      if (!link.url) continue;
      // Extract ML item ID from URL (e.g., MLM1234567890)
      const match = link.url.match(/MLM\d+/i);
      if (!match) continue;

      const mlItemId = match[0].toUpperCase();

      // Find orders with this item ID that don't have a mapping yet
      const orders = await MLOrder.find({
        'items.mlItemId': mlItemId
      }).select('items').lean();

      for (const order of orders) {
        for (const item of order.items) {
          if (item.mlItemId?.toUpperCase() !== mlItemId) continue;
          if (!item.title) continue;

          try {
            await MLProductMapping.findOneAndUpdate(
              { mlItemTitle: item.title },
              {
                $set: {
                  mlItemId: item.mlItemId,
                  productFamilyId: fam._id,
                  confidence: 'high',
                  matchedBy: 'link',
                  aiReasoning: `Auto-matched via ML link: ${link.url}`
                },
                $max: { lastSeenAt: new Date() },
                $inc: { orderCount: 0 } // Don't increment, just ensure field exists
              },
              { upsert: true }
            );
            created++;
          } catch (err) {
            if (err.code !== 11000) console.error('Bootstrap error:', err.message);
          }
        }
      }
    }
  }

  console.log(`🔗 Bootstrap: created ${created} mappings from existing ML links`);
  return { created };
}

/**
 * Get all distinct unmapped item titles with their frequency.
 */
async function getUnmappedTitles(limit = 100) {
  const pipeline = [
    { $unwind: '$items' },
    { $match: { 'items.productFamilyId': null } },
    { $group: {
      _id: '$items.title',
      mlItemId: { $first: '$items.mlItemId' },
      count: { $sum: 1 },
      lastSeen: { $max: '$dateCreated' },
      totalRevenue: { $sum: '$items.unitPrice' }
    }},
    { $sort: { count: -1 } },
    { $limit: limit }
  ];

  const results = await MLOrder.aggregate(pipeline);

  // Filter out titles that already have a mapping
  const existingMappings = await MLProductMapping.find({
    mlItemTitle: { $in: results.map(r => r._id) }
  }).select('mlItemTitle').lean();
  const mappedTitles = new Set(existingMappings.map(m => m.mlItemTitle));

  return results.filter(r => !mappedTitles.has(r._id)).map(r => ({
    title: r._id,
    mlItemId: r.mlItemId,
    orderCount: r.count,
    lastSeen: r.lastSeen,
    totalRevenue: r.totalRevenue
  }));
}

/**
 * Build a compact product tree description for the AI prompt.
 */
async function buildProductContext() {
  const families = await ProductFamily.find({
    sellable: true,
    active: true
  }).select('name size price parentId').lean();

  // Build parent path map
  const allFamilies = await ProductFamily.find({}).select('name parentId').lean();
  const familyMap = new Map(allFamilies.map(f => [String(f._id), f]));

  return families.map(f => {
    const path = [];
    let current = f;
    while (current?.parentId) {
      const parent = familyMap.get(String(current.parentId));
      if (parent) { path.unshift(parent.name); current = parent; }
      else break;
    }
    return {
      id: String(f._id),
      name: f.name,
      path: path.join(' > '),
      size: f.size || null,
      price: f.price || null
    };
  });
}

/**
 * Use AI to match a batch of ML titles to our product catalog.
 */
async function matchTitlesBatch(titles, productContext) {
  const productList = productContext.map((p, i) =>
    `${i}: ${p.path ? p.path + ' > ' : ''}${p.name}${p.size ? ` (${p.size})` : ''}${p.price ? ` $${p.price}` : ''}`
  ).join('\n');

  const titleList = titles.map((t, i) => `${i}: "${t.title}"`).join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un sistema de clasificación de productos para Hanlob, fabricante mexicano de malla sombra.
Dado un listado de títulos de Mercado Libre, empáreja cada uno con el producto más cercano de nuestro catálogo.

CATÁLOGO:
${productList}

Responde con JSON:
{
  "matches": [
    { "titleIndex": 0, "productIndex": 3, "confidence": "high", "reasoning": "6x4m negro = producto 3" },
    { "titleIndex": 1, "productIndex": null, "confidence": "low", "reasoning": "No hay equivalente" }
  ]
}

REGLAS:
- confidence "high": coincidencia clara por tamaño y tipo
- confidence "medium": coincidencia probable pero el título es ambiguo
- confidence "low": no hay coincidencia clara
- productIndex null si no hay match
- El tamaño es el criterio más importante (3x4m, 6x4m, etc.)
- "Reforzada" = con refuerzo, "Argollas" o "sin refuerzo" = sin refuerzo
- Rollos (100m) son diferente familia que confeccionadas
- Solo devuelve JSON`
        },
        { role: 'user', content: `Títulos de Mercado Libre a clasificar:\n${titleList}` }
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('❌ AI batch match error:', err.message);
    return { matches: [] };
  }
}

/**
 * Run AI normalization on all unmapped titles.
 */
async function normalizeUnmapped(options = {}) {
  const batchSize = options.batchSize || 10;
  const limit = options.limit || 200;

  const unmapped = await getUnmappedTitles(limit);
  if (unmapped.length === 0) return { processed: 0, mapped: 0 };

  const productContext = await buildProductContext();
  if (productContext.length === 0) return { processed: 0, mapped: 0, error: 'No sellable products in catalog' };

  let mapped = 0;
  let processed = 0;

  // Process in batches
  for (let i = 0; i < unmapped.length; i += batchSize) {
    const batch = unmapped.slice(i, i + batchSize);
    const result = await matchTitlesBatch(batch, productContext);

    for (const match of (result.matches || [])) {
      const titleEntry = batch[match.titleIndex];
      if (!titleEntry) continue;

      const productEntry = match.productIndex != null ? productContext[match.productIndex] : null;

      try {
        await MLProductMapping.findOneAndUpdate(
          { mlItemTitle: titleEntry.title },
          {
            $set: {
              mlItemId: titleEntry.mlItemId,
              productFamilyId: productEntry ? productEntry.id : null,
              confidence: match.confidence || 'low',
              matchedBy: 'ai',
              aiReasoning: match.reasoning || '',
              orderCount: titleEntry.orderCount,
              lastSeenAt: titleEntry.lastSeen
            }
          },
          { upsert: true }
        );
        if (productEntry) mapped++;
        processed++;
      } catch (err) {
        if (err.code !== 11000) console.error('Mapping save error:', err.message);
      }
    }

    // Small delay between batches
    if (i + batchSize < unmapped.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`🧠 Normalization: processed ${processed}, mapped ${mapped} of ${unmapped.length}`);
  return { processed, mapped, total: unmapped.length };
}

/**
 * Apply existing mappings to MLOrder items that don't have a productFamilyId yet.
 */
async function applyMappingsToOrders() {
  const mappings = await MLProductMapping.find({
    productFamilyId: { $ne: null }
  }).lean();

  let updated = 0;
  for (const mapping of mappings) {
    const result = await MLOrder.updateMany(
      { 'items.title': mapping.mlItemTitle, 'items.productFamilyId': null },
      {
        $set: {
          'items.$[elem].productFamilyId': mapping.productFamilyId,
          'items.$[elem].mappingConfidence': mapping.confidence
        }
      },
      { arrayFilters: [{ 'elem.title': mapping.mlItemTitle, 'elem.productFamilyId': null }] }
    );
    updated += result.modifiedCount;
  }

  console.log(`📦 Applied mappings to ${updated} order items`);
  return { updated };
}

/**
 * Get normalization stats.
 */
async function getStats() {
  const totalOrders = await MLOrder.countDocuments();
  const totalItems = await MLOrder.aggregate([
    { $unwind: '$items' },
    { $count: 'total' }
  ]);
  const mappedItems = await MLOrder.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.productFamilyId': { $ne: null } } },
    { $count: 'total' }
  ]);
  const totalMappings = await MLProductMapping.countDocuments();
  const reviewedMappings = await MLProductMapping.countDocuments({ reviewed: true });
  const highConfidence = await MLProductMapping.countDocuments({ confidence: 'high' });
  const needsReview = await MLProductMapping.countDocuments({ reviewed: false, productFamilyId: { $ne: null } });

  return {
    totalOrders,
    totalItems: totalItems[0]?.total || 0,
    mappedItems: mappedItems[0]?.total || 0,
    totalMappings,
    reviewedMappings,
    highConfidence,
    needsReview,
    coverage: totalItems[0]?.total > 0
      ? ((mappedItems[0]?.total || 0) / totalItems[0].total * 100).toFixed(1)
      : 0
  };
}

module.exports = {
  bootstrapFromExistingLinks,
  getUnmappedTitles,
  normalizeUnmapped,
  applyMappingsToOrders,
  getStats
};
