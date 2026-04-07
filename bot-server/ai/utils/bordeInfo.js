// ai/utils/bordeInfo.js
// Borde Separador info helpers extracted from the legacy bordeFlow.js so the
// helpers can outlive the legacy flow file.
// Used by: bot-server/index.js (greeting) and bot-server/ai/global/intents.js.

const ProductFamily = require("../../models/ProductFamily");

let bordeWidthCm = null;
let bordeWidthCacheExpiry = 0;

/**
 * Borde width — only one width exists. Cached for 5 minutes.
 * Falls back to 13cm if DB lookup fails.
 */
async function getBordeWidth() {
  if (bordeWidthCm && Date.now() < bordeWidthCacheExpiry) return bordeWidthCm;

  try {
    const parent = await ProductFamily.findOne({
      name: /borde\s*separador/i,
      sellable: { $ne: true }
    }).select('description').lean();

    const widthMatch = parent?.description?.match(/(\d+)\s*cm/i);
    if (widthMatch) {
      bordeWidthCm = parseInt(widthMatch[1]);
    } else {
      const child = await ProductFamily.findOne({
        name: /borde|separador/i,
        sellable: true,
        active: true,
        size: /^\d+x\d+/i
      }).select('size').lean();
      const sizeMatch = child?.size?.match(/^(\d+)x/i);
      bordeWidthCm = sizeMatch ? parseInt(sizeMatch[1]) : 13;
    }

    bordeWidthCacheExpiry = Date.now() + 5 * 60 * 1000;
    return bordeWidthCm;
  } catch (err) {
    console.error("Error fetching borde width:", err.message);
    return 13;
  }
}

function extractLengthsFromProducts(products) {
  const lengths = new Set();
  for (const p of products) {
    const text = `${p.name || ''} ${p.size || ''}`;
    const match = text.match(/(\d+)\s*m/i);
    if (match) {
      lengths.add(parseInt(match[1]));
    }
  }
  return [...lengths].sort((a, b) => a - b);
}

async function findAllBordeProducts(adProductIds = null) {
  try {
    const bordeParent = await ProductFamily.findOne({
      name: /borde\s*separador/i,
      sellable: { $ne: true }
    }).lean();

    if (bordeParent) {
      const products = await ProductFamily.find({
        parentId: bordeParent._id,
        sellable: true,
        active: true
      }).sort({ price: 1 }).lean();
      if (products.length > 0) return products;
    }

    const byName = await ProductFamily.find({
      name: /borde.*separador|rollo.*de.*\d+\s*m/i,
      sellable: true,
      active: true
    }).sort({ price: 1 }).lean();

    const bordeByName = byName.filter(p => {
      const size = (p.size || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const isBorde = /borde|separador|cinta/.test(name);
      const hasMeterSize = /^\d+\s*m/i.test(size) || /\d+\s*m(ts?|etros?)?\s*$/i.test(size);
      return isBorde || hasMeterSize;
    });

    if (bordeByName.length > 0) return bordeByName;

    if (adProductIds?.length) {
      const adProducts = await ProductFamily.find({
        _id: { $in: adProductIds },
        sellable: true,
        active: true
      }).sort({ price: 1 }).lean();
      if (adProducts.length > 0) return adProducts;
    }

    return [];
  } catch (error) {
    console.error("❌ Error finding borde products:", error);
    return [];
  }
}

/**
 * Get available borde lengths in meters, optionally filtered by ad-specified products.
 * @param {object} sourceContext - { ad: { productIds } }
 * @param {object} convo - conversation object (fallback for ad product IDs)
 * @returns {Promise<number[]>} sorted lengths
 */
async function getAvailableLengths(sourceContext, convo) {
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;

  if (adProductIds?.length) {
    try {
      const products = await ProductFamily.find({
        _id: { $in: adProductIds },
        sellable: true,
        active: true
      }).lean();

      const lengths = extractLengthsFromProducts(products);
      if (lengths.length > 0) return lengths;
    } catch (err) {
      console.error("Error getting ad product lengths:", err.message);
    }
  }

  const allProducts = await findAllBordeProducts();
  return extractLengthsFromProducts(allProducts);
}

module.exports = { getBordeWidth, getAvailableLengths };
