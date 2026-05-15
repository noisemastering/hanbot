// ai/utils/mlPriceLookup.js
// Real-time ML price lookup. ML is the source of truth for prices.
// Checks the actual listing price on Mercado Libre and detects active offers.

const axios = require('axios');
const { getValidAccessToken } = require('../../utils/mercadoLibreOAuth');

const ML_SELLER_ID = '482595248';

// In-memory cache: { mlItemId: { price, originalPrice, hasDiscount, discountPercent, fetchedAt } }
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Extract MLM item ID from a Mercado Libre URL.
 * @param {string} url
 * @returns {string|null} e.g. "MLM2707972264"
 */
function extractMLItemId(url) {
  if (!url) return null;
  const match = url.match(/MLM-?(\d+)/i);
  return match ? `MLM${match[1]}` : null;
}

/**
 * Fetch the real-time price for an ML item.
 * Returns the ML listing price, original price (if on sale), and discount info.
 * Falls back to the DB price if the ML API is unavailable.
 *
 * @param {string} mlUrl - The ML product URL (e.g. https://articulo.mercadolibre.com.mx/MLM-...)
 * @param {number} dbPrice - The price from our DB (fallback)
 * @returns {Promise<{ price: number, originalPrice: number|null, hasDiscount: boolean, discountPercent: number, source: 'ml'|'db' }>}
 */
async function getMLPrice(mlUrl, dbPrice) {
  const mlItemId = extractMLItemId(mlUrl);
  if (!mlItemId) {
    return { price: dbPrice, originalPrice: null, hasDiscount: false, discountPercent: 0, source: 'db' };
  }

  // Check cache
  const cached = _cache.get(mlItemId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached;
  }

  try {
    const token = await getValidAccessToken(ML_SELLER_ID);
    const res = await axios.get(`https://api.mercadolibre.com/items/${mlItemId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 3000
    });

    const item = res.data;
    const price = item.price;
    const originalPrice = item.original_price || null;
    const hasDiscount = originalPrice && originalPrice > price;
    const discountPercent = hasDiscount ? Math.round((1 - price / originalPrice) * 100) : 0;

    const result = {
      price,
      originalPrice: hasDiscount ? originalPrice : null,
      hasDiscount,
      discountPercent,
      source: 'ml',
      fetchedAt: Date.now()
    };

    _cache.set(mlItemId, result);
    return result;
  } catch (err) {
    console.error(`⚠️ [mlPrice] Failed to fetch ${mlItemId}: ${err.message}`);
    // Fallback to DB price
    return { price: dbPrice, originalPrice: null, hasDiscount: false, discountPercent: 0, source: 'db' };
  }
}

/**
 * Enrich a product object with real-time ML pricing.
 * Overwrites the DB price with the ML price and adds discount info.
 *
 * @param {Object} product - Product from productFlow.loadProducts()
 * @returns {Promise<Object>} Same product with updated price fields
 */
async function enrichWithMLPrice(product) {
  if (!product?.link) return product;

  const mlPrice = await getMLPrice(product.link, product.price);

  return {
    ...product,
    price: mlPrice.price,
    originalPrice: mlPrice.originalPrice,
    hasDiscount: mlPrice.hasDiscount,
    discountPercent: mlPrice.discountPercent,
    priceSource: mlPrice.source
  };
}

module.exports = { getMLPrice, enrichWithMLPrice, extractMLItemId };
