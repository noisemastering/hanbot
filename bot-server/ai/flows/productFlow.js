// ai/flows/productFlow.js
// Model flow — retrieves and manages product information.
// Does NOT handle sales process (that's retail/wholesale/reseller flows).
// Handles: product lookup, variants, pricing, colors, links, wholesale thresholds,
//          out-of-realm detection, "we don't offer" list.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const ProductFamily = require("../../models/ProductFamily");
const Product = require("../../models/Product");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Products people frequently ask for that we don't offer.
 * Used for early exit before checking other flow manifests.
 */
const NOT_OFFERED = [
  { pattern: /\b(lona|lonaria)\b/i, name: 'lonas' },
  { pattern: /\b(pasto\s*(sintético|artificial))\b/i, name: 'pasto sintético' },
  { pattern: /\b(malla\s*ciclón(ica)?|ciclónica)\b/i, name: 'malla ciclónica' },
  { pattern: /\b(tela?\s*mosquiter[oa])\b/i, name: 'tela mosquitera' }
];

/**
 * Check if the user is asking for a product we don't offer.
 * @param {string} userMessage
 * @returns {{ notOffered: boolean, productName: string }|null}
 */
function checkNotOffered(userMessage) {
  if (!userMessage) return null;
  for (const item of NOT_OFFERED) {
    if (item.pattern.test(userMessage)) {
      return { notOffered: true, productName: item.name };
    }
  }
  return null;
}

/**
 * Load products for a given set of family IDs from the DB.
 * Only returns active families with sellable leaf nodes.
 * @param {Array<string>} familyIds - ProductFamily ObjectIds from manifest
 * @returns {Promise<Array>} Loaded product data
 */
async function loadProducts(familyIds) {
  if (!familyIds || familyIds.length === 0) return [];

  try {
    // Get all active, sellable descendants of the given families
    const families = await ProductFamily.find({
      $or: [
        { _id: { $in: familyIds } },
        { parentId: { $in: familyIds } }
      ],
      active: true
    }).lean();

    // Recursively find all descendants
    const allFamilyIds = families.map(f => f._id);
    const descendants = await ProductFamily.find({
      parentId: { $in: allFamilyIds },
      active: true
    }).lean();

    const allFamilies = [...families, ...descendants];
    const sellable = allFamilies.filter(f => f.sellable);

    // Also load Product documents linked to these families
    const products = await Product.find({
      familyId: { $in: allFamilies.map(f => f._id) }
    }).lean();

    // Build normalized product list
    return sellable.map(fam => {
      const linkedProducts = products.filter(p => String(p.familyId) === String(fam._id));
      const preferredLink = fam.onlineStoreLinks?.find(l => l.isPreferred)?.url
        || fam.onlineStoreLinks?.[0]?.url
        || null;

      return {
        productId: String(fam._id),
        name: fam.name,
        description: fam.description || fam.marketingDescription || null,
        price: fam.price || null,
        mlPrice: fam.mlPrice || null,
        link: preferredLink,
        size: fam.size || null,
        colors: linkedProducts.map(p => p.name).filter(Boolean),
        variants: linkedProducts.map(p => ({
          id: String(p._id),
          name: p.name,
          price: p.price,
          size: p.size,
          link: p.mLink || null
        })),
        wholesaleEnabled: fam.wholesaleEnabled || false,
        wholesaleMinQty: fam.wholesaleMinQty || null,
        wholesalePrice: fam.wholesalePrice || null,
        requiresHumanAdvisor: fam.requiresHumanAdvisor || false,
        attributes: fam.attributes || {},
        imageUrl: fam.imageUrl || fam.thumbnail || null
      };
    });
  } catch (err) {
    console.error('❌ [product] DB load error:', err.message);
    return [];
  }
}

/**
 * Find a product by name/description using AI matching.
 * @param {string} userMessage - What the customer asked for
 * @param {Array} products - Loaded products from loadProducts()
 * @returns {Promise<Array>} Matching products
 */
async function findProduct(userMessage, products) {
  if (!userMessage || !products.length) return [];

  const productSummary = products.map((p, i) =>
    `${i}: ${p.name}${p.size ? ` (${p.size})` : ''}${p.description ? ` — ${p.description}` : ''}`
  ).join('\n');

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un sistema de búsqueda de productos. Dado el mensaje del cliente, identifica cuál(es) producto(s) de la lista corresponden a lo que busca.

PRODUCTOS DISPONIBLES:
${productSummary}

Responde con JSON:
{ "matches": [<índices de productos que coinciden>], "confidence": "high"|"medium"|"low", "outsideRealm": <true si el cliente pide algo que NO está en la lista> }

REGLAS:
- Si el cliente pide algo que claramente NO está en la lista, pon outsideRealm: true y matches: []
- Si hay duda, pon confidence: "low"
- Solo devuelve JSON`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.outsideRealm) {
      return { matches: [], outsideRealm: true };
    }

    const matched = (result.matches || [])
      .filter(i => i >= 0 && i < products.length)
      .map(i => products[i]);

    return { matches: matched, outsideRealm: false, confidence: result.confidence };
  } catch (err) {
    console.error('❌ [product] AI match error:', err.message);
    return { matches: [], outsideRealm: false };
  }
}

/**
 * Check if a product exceeds the wholesale threshold.
 * @param {Object} product - Product from loadProducts()
 * @param {number} quantity - Requested quantity
 * @returns {{ isWholesale: boolean, threshold: number|null }}
 */
function checkWholesaleThreshold(product, quantity) {
  if (!product.wholesaleEnabled || !product.wholesaleMinQty) {
    return { isWholesale: false, threshold: null };
  }
  return {
    isWholesale: quantity >= product.wholesaleMinQty,
    threshold: product.wholesaleMinQty
  };
}

/**
 * Check other convo_flow manifests to find the right flow for an out-of-realm product.
 * @param {string} userMessage - What the customer asked for
 * @param {Array<Object>} manifests - Other convo_flow manifests from DB
 * @returns {Promise<{ flowId: string, flowName: string }|null>}
 */
async function findFlowForProduct(userMessage, manifests) {
  if (!manifests || manifests.length === 0) return null;

  const manifestSummary = manifests.map((m, i) =>
    `${i}: ${m.name} — productos: ${(m.products || []).join(', ')}`
  ).join('\n');

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Identifica cuál flujo puede manejar el producto que pide el cliente.

FLUJOS DISPONIBLES:
${manifestSummary}

Responde con JSON:
{ "matchIndex": <índice del flujo que mejor corresponde, o -1 si ninguno> }

Solo devuelve JSON.`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    if (result.matchIndex >= 0 && result.matchIndex < manifests.length) {
      const matched = manifests[result.matchIndex];
      return { flowId: matched._id || matched.id, flowName: matched.name };
    }
    return null;
  } catch (err) {
    console.error('❌ [product] AI flow match error:', err.message);
    return null;
  }
}

/**
 * Handle a product inquiry.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context
 *   familyIds: array of ProductFamily ObjectIds from manifest
 *   products: pre-loaded products (if already initialized, avoids re-querying)
 *   manifests: other convo_flow manifests for flow switching
 * @returns {{ type: string, products?: Array, action?: string }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const { familyIds = [], products: preloaded = null, manifests = [] } = context;

  // ── LOAD PRODUCTS (once, then cache in convo_flow) ──
  const products = preloaded || await loadProducts(familyIds);

  // ── CHECK "WE DON'T OFFER" LIST (early exit) ──
  const notOffered = checkNotOffered(userMessage);
  if (notOffered) {
    console.log(`🏛️ [product] Not offered: ${notOffered.productName}`);
    return {
      type: 'not_offered',
      productName: notOffered.productName,
      text: `Disculpa, no manejamos ${notOffered.productName}.`
    };
  }

  // ── FIND MATCHING PRODUCT ──
  const search = await findProduct(userMessage, products);

  // ── OUT OF REALM — check other manifests ──
  if (search.outsideRealm) {
    console.log('🏛️ [product] Product outside realm — checking other flows');
    const otherFlow = await findFlowForProduct(userMessage, manifests);
    if (otherFlow) {
      return { type: 'flow_switch', action: 'product_redirect', targetFlow: otherFlow.flowId, targetFlowName: otherFlow.flowName };
    }
    // No other flow handles it either
    return {
      type: 'not_offered',
      text: 'Disculpa, ese producto no lo manejamos por el momento.'
    };
  }

  // ── MATCHED PRODUCTS ──
  // Product flow only returns product data. Wholesale/retail intent detection
  // is the duty of retail_flow and wholesale_flow, not product_flow.
  if (search.matches && search.matches.length > 0) {
    console.log(`🏛️ [product] Found ${search.matches.length} product(s)`);
    return {
      type: 'products_found',
      products: search.matches,
      confidence: search.confidence
    };
  }

  // ── NO MATCH ──
  return null;
}

module.exports = {
  handle,
  loadProducts,
  findProduct,
  findFlowForProduct,
  checkWholesaleThreshold,
  checkNotOffered,
  NOT_OFFERED
};
