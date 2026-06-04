// ai/workflow/priceResolver.js
//
// Price-quoting hierarchy for the workflow engine:
//   1. ML price (live, via mlPriceLookup) — quote it if available.
//   2. else the Inventario price (ProductFamily.price) — quote it.
//   3. else if the item is sellable (active && sellable) but has no price —
//      signal a human handoff (never invent a price).
//   4. else not quotable.
const { getMLPrice } = require("../utils/mlPriceLookup");

function mlLinkOf(product) {
  const links = product?.onlineStoreLinks || [];
  return links.find((l) => l?.url && /mercadolibre/i.test(l.url))?.url || null;
}

function numericPrice(p) {
  if (p == null) return null;
  const n = typeof p === "number" ? p : parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve a quote for a product per the hierarchy.
 * @param {Object} product - a ProductFamily (preferred) or Product doc/lean object
 * @returns {Promise<{ amount: number|null, source: 'ml'|'inventario'|null, handoff: boolean,
 *                      link: string|null, hasDiscount?: boolean, originalPrice?: number|null }>}
 */
async function resolvePrice(product) {
  const empty = { amount: null, source: null, handoff: false, link: null };
  if (!product) return empty;

  const link = mlLinkOf(product);
  const invPrice = numericPrice(product.price);

  // 1. ML price (live)
  if (link) {
    try {
      const r = await getMLPrice(link, invPrice);
      if (r && r.source === "ml" && numericPrice(r.price)) {
        return {
          amount: numericPrice(r.price),
          source: "ml",
          handoff: false,
          link,
          hasDiscount: !!r.hasDiscount,
          originalPrice: r.originalPrice || null,
        };
      }
    } catch (err) {
      console.error("⚠️ resolvePrice ML lookup failed:", err.message);
    }
  }

  // 2. Inventario price
  if (invPrice) {
    return { amount: invPrice, source: "inventario", handoff: false, link };
  }

  // 3. sellable but no price → human handoff
  const sellable = product.active !== false && product.sellable === true;
  if (sellable) return { amount: null, source: null, handoff: true, link };

  // 4. not quotable
  return { ...empty, link };
}

/**
 * Wrap a raw destination URL in a psid-traceable redirect (/r/{clickId}) so clicks
 * from workflow conversations are recorded in ClickLog and surface in
 * commerce-status. Returns the raw url unchanged when there is no psid (e.g. the
 * sandbox) or no url. getOrCreateClickLink reuses an existing unclicked link for
 * the same psid+url and auto-fills adId/campaign/channel from the conversation.
 * @param {string|null} rawUrl
 * @param {{psid?: string|null, sandbox?: boolean, productName?: string, productId?: string}} [opts]
 * @returns {Promise<string|null>}
 */
async function trackedLink(rawUrl, opts = {}) {
  if (!rawUrl || !opts.psid || opts.sandbox) return rawUrl || null;
  try {
    const { getOrCreateClickLink } = require("../../tracking");
    return await getOrCreateClickLink(opts.psid, rawUrl, {
      productName: opts.productName,
      productId: opts.productId,
    });
  } catch (err) {
    console.error("⚠️ trackedLink failed, using raw url:", err.message);
    return rawUrl;
  }
}

module.exports = { resolvePrice, mlLinkOf, trackedLink };
