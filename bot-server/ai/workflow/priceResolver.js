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

module.exports = { resolvePrice, mlLinkOf };
