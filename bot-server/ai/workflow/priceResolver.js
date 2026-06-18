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
  const invPrice = numericPrice(product.price); // Inventario
  const syncedMl = numericPrice(product.mlPrice); // last-synced ML price (ProductFamily.mlPrice)

  // 1. LIVE ML price — the source of truth. Quote it whenever we can fetch it.
  //    This NEVER downgrades while a live price exists.
  if (link) {
    try {
      const r = await getMLPrice(link, invPrice);
      if (r && r.source === "ml" && numericPrice(r.price)) {
        return {
          amount: numericPrice(r.price),
          source: "ml",
          live: true,
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

  // The LIVE ML price was NOT available (no link, fetch failed/404, or the
  // listing has no price). We do NOT silently quote Inventario — the ML price is
  // paramount; Inventario is a downgrade only when there's genuinely NO ML price.
  if (syncedMl != null) {
    // 2a. We still have a last-synced ML price. If Inventario is BELOW it, the
    //     two sources disagree and quoting the cheaper Inventario would
    //     undersell — hand to a human instead of serving a wrong number.
    if (invPrice != null && invPrice < syncedMl) {
      return {
        amount: null,
        source: null,
        handoff: true,
        link,
        handoffReason: `Sin precio ML en vivo; inventario ($${invPrice}) por debajo del último precio ML ($${syncedMl}) — validar con un asesor`,
      };
    }
    // 2b. No conflict (Inventario ≥ synced, or no Inventario) → quote the
    //     last-synced ML price (still the source of truth, just cached).
    return { amount: syncedMl, source: "ml", live: false, handoff: false, link };
  }

  // 3. No ML price AT ALL (never synced / not an ML product) → Inventario is the
  //    legitimate last resort.
  if (invPrice != null) {
    return { amount: invPrice, source: "inventario", handoff: false, link };
  }

  // 4. sellable but no price anywhere → human handoff (never invent a price).
  const sellable = product.active !== false && product.sellable === true;
  if (sellable) return { amount: null, source: null, handoff: true, link };

  // 5. not quotable
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

// A Mercado Libre URL with no product/store path → the generic homepage. The
// directive: NEVER share the generic ML link; fall back to our official store.
function isGenericMlUrl(url) {
  const m = String(url).match(/^https?:\/\/[^/]*mercadolibre\.com[^/]*(\/[^?#]*)?/i);
  if (!m) return false;
  const path = (m[1] || "").replace(/\/+$/, "");
  return path === ""; // bare domain or just "/"
}

// The official store link from the company's configured marketplaces (prefer ML).
async function officialStoreUrl() {
  try {
    const { getBusinessInfo } = require("../../businessInfoManager");
    const biz = await getBusinessInfo();
    const mkts = (biz?.marketplaces || []).filter((m) => m && m.url && m.active !== false);
    const ml = mkts.find((m) => /mercado\s*libre|mercadolibre/i.test(m.name || "")) || mkts[0];
    return ml?.url || null;
  } catch {
    return null;
  }
}

// Safety net: the model sometimes pastes a raw Mercado Libre URL straight into
// its reply instead of calling share_product_link. This scans the outgoing text
// for raw ML links and (a) ENFORCES the link directive — a bare/generic ML link
// (homepage) is swapped for the official store link, never sent as-is — and
// (b) swaps every ML link for a psid-traceable redirect so clicks are attributed.
async function sanitizeMarketplaceLinks(text, opts = {}) {
  if (!text || !opts.psid || opts.sandbox) return text;
  const found = text.match(/https?:\/\/[^\s)]+/g) || [];
  let out = text;
  for (const rawMatch of found) {
    const url = rawMatch.replace(/[.,;:!?]+$/, ""); // trim trailing punctuation
    if (/agente\.hanlob\.com\.mx\/r\//i.test(url)) continue; // already tracked
    if (!/mercadolibre\.com/i.test(url)) continue; // only marketplace links

    const generic = isGenericMlUrl(url);
    let target = url;
    let label = opts.productName || null;
    if (generic) {
      const store = await officialStoreUrl();
      if (store) {
        target = store; // never the homepage — use our store
        label = "Tienda oficial";
        console.log(`🔗 [workflow] generic ML link → official store link (${opts.psid})`);
      } else {
        // No store configured: strip the generic link rather than send the homepage.
        out = out.split(url).join("").replace(/[ \t]{2,}/g, " ");
        console.warn(`🔗 [workflow] generic ML link removed; no store configured (${opts.psid})`);
        continue;
      }
    }
    try {
      const tracked = await trackedLink(target, {
        psid: opts.psid,
        sandbox: opts.sandbox,
        productName: label,
        productId: generic ? null : opts.productId || null,
      });
      if (tracked) {
        out = out.split(url).join(tracked);
        if (!generic) console.log(`🔗 [workflow] rewrote raw ML link → tracked (${opts.psid})`);
      }
    } catch {
      /* leave the raw url as-is on failure */
    }
  }
  return out;
}

// DETERMINISTIC PRICE CLAMP — prices are NOT the model's to author.
//
// The engine resolves the canonical price for the product under discussion each
// turn (ML → Inventario hierarchy, in resolvePrice). The model is only allowed
// to SAY a price that the engine actually resolved this turn. This scans the
// outgoing reply for price tokens ($N or "N pesos/MXN") and rewrites any number
// that isn't one of the allowed (resolved) amounts to the primary resolved
// amount — so a hallucinated/neighbor price (the "7x4 → $3450" bug) can never
// reach the customer.
//
// SAFE BY DESIGN: when the turn resolved NO concrete price (overview / range /
// chit-chat), allowedAmounts is empty and this is a no-op — range replies like
// "desde 4x7m hasta 7x10m" are never touched (they carry no prices anymore).
//
// @param {string} text
// @param {number[]} allowedAmounts - every price the engine resolved this turn
// @param {number|null} primaryAmount - what to rewrite a wrong price TO (the
//        measure the customer asked about). Defaults to allowedAmounts[0].
// @returns {{ text: string, changed: boolean }}
function clampPrices(text, allowedAmounts = [], primaryAmount = null) {
  if (!text) return { text, changed: false };
  const allowed = (allowedAmounts || [])
    .map((n) => (typeof n === "number" ? n : parseFloat(String(n).replace(/[^0-9.]/g, ""))))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!allowed.length) return { text, changed: false }; // nothing resolved → never touch

  const primary = Number.isFinite(primaryAmount) && primaryAmount > 0 ? primaryAmount : allowed[0];
  // Tolerate rounding (e.g. ML 804.3 vs the bot saying $804).
  const ok = (v) => allowed.some((a) => Math.abs(v - a) <= Math.max(1, a * 0.01));
  const display = String(Math.round(primary));
  let changed = false;

  // $-prefixed amounts: $3,450  $ 450  $804.30
  let out = text.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, (m, num) => {
    const v = parseFloat(num.replace(/,/g, ""));
    if (!Number.isFinite(v) || ok(v)) return m;
    changed = true;
    return `$${display}`;
  });
  // bare "N pesos" / "N MXN" (no $ sign)
  out = out.replace(/\b(\d[\d,]*(?:\.\d+)?)\s*(pesos|mxn)\b/gi, (m, num, unit) => {
    const v = parseFloat(num.replace(/,/g, ""));
    if (!Number.isFinite(v) || ok(v)) return m;
    changed = true;
    return `${display} ${unit}`;
  });

  return { text: out, changed };
}

module.exports = { resolvePrice, mlLinkOf, trackedLink, sanitizeMarketplaceLinks, clampPrices, isGenericMlUrl, officialStoreUrl };
