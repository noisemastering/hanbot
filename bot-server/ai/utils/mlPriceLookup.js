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
  // Capture BOTH forms: a sellable ITEM id ("MLM-2888465189" / "MLM2888465189")
  // and a CATALOG product id from /p/ and /up/ links ("MLMU3914956039"). The old
  // /MLM-?\d+/ regex missed "MLMU…" (the U isn't a digit), so /up/ catalog links
  // returned null → instant DB fallback (never even tried live ML).
  const match = url.match(/ML[A-Z]*-?\d+/i);
  return match ? match[0].replace(/-/g, "").toUpperCase() : null;
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
  // A "/p/MLM…" or "/up/MLMU…" URL is a CATALOG PRODUCT id, not a sellable ITEM
  // id — the items/prices endpoints 404 (and /products/{MLMU} 403s) on it. We
  // resolve it to the seller's winning ITEM below via /products/{id}/items.
  const isCatalog = /\/(p|up)\/ML/i.test(mlUrl || "");

  // Check cache
  const cached = _cache.get(mlItemId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached;
  }

  try {
    const token = await getValidAccessToken(ML_SELLER_ID);

    // CATALOG (/p/MLM…) → resolve the buy-box winning ITEM so items/prices works.
    // If the catalog gives a price directly, use it. Otherwise fall through with
    // the resolved item id.
    let itemId = mlItemId;
    if (isCatalog) {
      // /products/{catalogId}/items → the seller's actual sellable item(s) for
      // this catalog product. Works for BOTH /p/MLM and /up/MLMU (where
      // /products/{id} itself 403s). Take the first result's item_id and price it
      // properly below (the prices endpoint surfaces promotions).
      try {
        const pi = await axios.get(`https://api.mercadolibre.com/products/${mlItemId}/items`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 4000,
        });
        const win = pi.data?.results?.[0];
        if (win?.item_id) itemId = win.item_id;
        else if (win?.price != null) {
          const op = win.original_price && win.original_price > win.price ? win.original_price : null;
          const result = { price: win.price, originalPrice: op, hasDiscount: !!op, discountPercent: op ? Math.round((1 - win.price / op) * 100) : 0, source: "ml", fetchedAt: Date.now() };
          _cache.set(mlItemId, result);
          return result;
        }
      } catch (e1) {
        // Fallback: /products/{id} buy_box_winner (some /p/ catalog products).
        try {
          const pr = await axios.get(`https://api.mercadolibre.com/products/${mlItemId}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 3000,
          });
          const bbw = pr.data?.buy_box_winner;
          if (bbw?.item_id) itemId = bbw.item_id;
          else if (bbw?.price != null) {
            const op = bbw.original_price && bbw.original_price > bbw.price ? bbw.original_price : null;
            const result = { price: bbw.price, originalPrice: op, hasDiscount: !!op, discountPercent: op ? Math.round((1 - bbw.price / op) * 100) : 0, source: "ml", fetchedAt: Date.now() };
            _cache.set(mlItemId, result);
            return result;
          }
        } catch (e2) { /* fall through; items call below will 404 → DB fallback */ }
      }
    }

    // Use the Prices endpoint — the Items endpoint doesn't show marketplace promotions
    const res = await axios.get(`https://api.mercadolibre.com/items/${itemId}/prices`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 3000
    });

    const prices = res.data?.prices || [];

    // Find the active promotion price. ML can return MULTIPLE overlapping
    // active promotions (e.g. a long-running deal + a short flash deal). The
    // customer always sees/pays the LOWEST active price — so we must pick the
    // minimum amount, not the first match. (Picking the first under-discounted
    // us: we quoted $949 while ML displayed $885.)
    const now = new Date();
    const activePromos = prices.filter(p =>
      p.type === 'promotion' &&
      p.amount &&
      (!p.conditions?.start_time || new Date(p.conditions.start_time) <= now) &&
      (!p.conditions?.end_time || new Date(p.conditions.end_time) > now)
    );
    const promoPrice = activePromos.length
      ? activePromos.reduce((lo, p) => (p.amount < lo.amount ? p : lo))
      : null;

    // Standard/base price
    const standardPrice = prices.find(p => p.type === 'standard');

    let price, originalPrice, hasDiscount, discountPercent;

    if (promoPrice && standardPrice) {
      price = promoPrice.amount;
      originalPrice = promoPrice.regular_amount || standardPrice.amount;
      hasDiscount = originalPrice > price;
      discountPercent = hasDiscount ? Math.round((1 - price / originalPrice) * 100) : 0;
    } else if (standardPrice) {
      price = standardPrice.amount;
      originalPrice = null;
      hasDiscount = false;
      discountPercent = 0;
    } else {
      // Fallback to items endpoint
      const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 3000
      });
      price = itemRes.data.price;
      originalPrice = itemRes.data.original_price || null;
      hasDiscount = originalPrice && originalPrice > price;
      discountPercent = hasDiscount ? Math.round((1 - price / originalPrice) * 100) : 0;
    }

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
 * IMPORTANT: priceSource will be 'ml' if the price came from a live ML call,
 * or 'db' if it fell back to the DB price (network/auth failure).
 * Quote handlers MUST refuse to quote when priceSource !== 'ml'.
 *
 * @param {Object} product - Product from productFlow.loadProducts()
 * @returns {Promise<Object>} Same product with updated price fields + priceSource
 */
async function enrichWithMLPrice(product) {
  if (!product?.link) {
    // No ML link at all — mark as DB-sourced so quote logic refuses
    return { ...product, priceSource: 'db' };
  }

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

/**
 * Filter a product list to only items with live ML pricing.
 * Returns { quotable, nonQuotable } so the caller can decide whether to
 * escalate / skip / explain.
 */
function partitionQuotable(products) {
  const quotable = [];
  const nonQuotable = [];
  for (const p of products || []) {
    if (p?.priceSource === 'ml') quotable.push(p);
    else nonQuotable.push(p);
  }
  return { quotable, nonQuotable };
}

module.exports = { getMLPrice, enrichWithMLPrice, partitionQuotable, extractMLItemId };
