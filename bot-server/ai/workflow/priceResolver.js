// ai/workflow/priceResolver.js
//
// Price-quoting hierarchy for the workflow engine:
//   1. ML price (live, via mlPriceLookup) — quote it if available.
//   2. else the Inventario price (ProductFamily.price) — quote it.
//   3. else if the item is sellable (active && sellable) but has no price —
//      signal a human handoff (never invent a price).
//   4. else not quotable.
const { getMLPrice } = require("../utils/mlPriceLookup");
const marketplace = require("../marketplace");

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
// RULE (all flows): an active product with a price but NO purchase link is still
// QUOTED, but it can't be bought self-service, so we ALSO hand off to a human to
// close the sale. With a link, the quote stands as-is.
// ── ROLLO COMPLETO ───────────────────────────────────────────────────────────
// Decided 2026-10-23, after five reported conversations in two days.
//
// A full roll is a wholesale-shaped sale: an asesor quotes it, closes it and
// quotes the freight. It is the ONE case where the live Mercado Libre price does
// NOT win, because our ML listings for full rolls are priced well above our own
// direct price. Ground Cover 4x100 m sold on ML for $5,314 while the direct
// price is $4,222.40 ($3,640 sheet + IVA) — a customer who had both numbers
// replied "juegan con sus precios" and an asesor had to apologize. So for a full
// roll: our price sheet decides, IVA included, no buy link, always a handoff.
//
// IVA is folded into the amount here rather than left as a "+ IVA" suffix: the
// asesores quote these rolls gross ($4,222.40, not "$3,640 + IVA"), and a
// customer who anchors on the net number feels the same bait-and-switch twice.
const IVA_RATE = 0.16;
const round2 = (n) => Math.round(n * 100) / 100;

// A full roll is identified from productCode (CAT-TYPE-SHADE-COLOR-SIZE, where
// SIZE is e.g. 02X100 / 04X100 / 54M), with a name fallback for anything whose
// code is missing. Only the two shapes the catalogue actually sells as full
// rolls count: a 100 m roll of any width, and the borde's 54 m roll. The 47 m UV
// cord roll is deliberately NOT one — it is a $300 complement with no cut
// version, and routing it through an asesor would help nobody.
const FULL_ROLL_CODE = /(?:^|-)(?:\d{1,2}(?:[.,]\d)?X100|54M)$/i;
const FULL_ROLL_NAME = /(?:\b\d{1,2}(?:[.,]\d)?\s*[x\u00d7]\s*100\b|\brollo\s+de\s+54\s*m\b)/i;

// Synchronous read of whatever the caller happened to load.
function isFullRoll(product) {
  if (!product) return false;
  const code = String(product.productCode || "").trim();
  if (code) return FULL_ROLL_CODE.test(code);
  return FULL_ROLL_NAME.test(String(product.name || ""));
}

// …and the version resolvePrice actually uses.
//
// The sync read is not enough on its own, and the reason is worth keeping: the
// sellable leaf for GC 4x100 m is named just "Negro" — the size lives in its
// productCode (GC-ROL-NEG-04X100) and in its PARENT's name ("Rollo de 4x100 m").
// Most gates build their own projections and few of them select productCode, so
// a rule that trusted the loaded document silently did nothing for exactly the
// product that caused the complaint. Rather than add productCode to a dozen
// .select() lists and wait for the thirteenth to forget it, this reads the two
// fields itself, once per product per process.
const _fullRollCache = new Map(); // productId → boolean

async function resolveIsFullRoll(product) {
  if (!product) return false;
  if (isFullRoll(product)) return true;
  // A code we actually loaded and that did NOT match settles it — no lookup.
  if (String(product.productCode || "").trim()) return false;
  const id = product._id ? String(product._id) : null;
  if (!id) return false;
  if (_fullRollCache.has(id)) return _fullRollCache.get(id);

  let verdict = false;
  try {
    const PF = require("../../models/ProductFamily");
    const self = await PF.findById(id).select("productCode name parentId").lean();
    if (self) {
      verdict = isFullRoll(self);
      if (!verdict && self.parentId) {
        const parent = await PF.findById(self.parentId).select("productCode name").lean();
        // The parent carries the size for colour-only leaves. Its productCode is
        // NOT consulted: a family's code can describe a whole size group.
        if (parent) verdict = FULL_ROLL_NAME.test(String(parent.name || ""));
      }
    }
  } catch {
    verdict = false; // never block a quote on this lookup
  }
  _fullRollCache.set(id, verdict);
  return verdict;
}

function noLinkResult(base, product) {
  if (base.link) return { ...base, handoff: false };
  return {
    ...base,
    handoff: true,
    quoteThenHandoff: true,
    handoffReason: `Producto sin link de compra en línea: ${product.name || "producto del flujo"} — cotizado en $${base.amount}; concretar la venta con un asesor`,
  };
}

// ALTERNATE MARKETPLACE resolution. A campaign routed THIS product to a non-default
// POS (e.g. the client's own store). Price/link/refund/delivery come from that POS;
// everything else stays on the default channel. Same guarantees as the ML path: a
// sold-out or price-less product hands off, and we NEVER invent a price.
async function resolveViaAltPos(product, pos) {
  const label = pos?.name || "otra tienda";
  const linkInfo = marketplace.linkForPos(product, pos) || {};
  const link = linkInfo.url || null;
  const invPrice = numericPrice(product.price);

  // LINK-ONLY alt (e.g. the Hanlob store, trial mode): the PRICE stays on the
  // default channel (live ML → the source of truth); we only swap the buy LINK to
  // this POS's link for the routed products. No price API is queried.
  if (pos.kind !== "http_price_api") {
    const base = await resolvePrice(product, {}); // normal ML/inventario hierarchy
    // A ROLLO COMPLETO is never relinked and never loses its handoff. Without
    // this the clause below would hand back the very buy link the rule withholds
    // and clear the handoff that routes the sale to an asesor.
    if (base.fullRoll) return base;
    // Only relink when there's a real price to quote AND an alt link to point to;
    // otherwise leave the default result (incl. its handoff) exactly as-is.
    if (!link || !(numericPrice(base.amount) > 0)) return base;
    // Price stays from the default channel; link + refund/delivery come from this POS.
    const out = { ...base, link, marketplace: label, linkFrom: label, policies: pos?.policies || null };
    // If the default path would've handed off ONLY for lacking a purchase link, the
    // alt link now lets the customer self-serve → clear that specific handoff.
    if (base.quoteThenHandoff) {
      out.handoff = false;
      out.quoteThenHandoff = false;
      delete out.handoffReason;
    }
    return out;
  }

  // STOCK GATE — same rule as the default path.
  if (product.active !== false && product.sellable === true && product.stock != null && Number(product.stock) < 1) {
    return {
      amount: null, source: null, handoff: true, soldOut: true, link, marketplace: label,
      handoffReason: `Producto AGOTADO en ${label}: ${product.name || "producto del flujo"} — pasar con un asesor para seguimiento/aviso`,
    };
  }

  let r;
  try {
    r = await marketplace.priceViaPos(pos, { link, dbPrice: invPrice, sku: linkInfo.sku });
  } catch (err) {
    r = { available: false, fetchFailed: true, reason: err.message };
  }

  if (r && r.available && numericPrice(r.price)) {
    const buyLink = r.url || link; // prefer the store's own canonical buy URL
    return noLinkResult(
      {
        amount: numericPrice(r.price),
        source: "alt",
        marketplace: label,
        live: true,
        link: buyLink,
        plusIva: r.taxIncluded === false, // the store told us whether its price carries IVA
        currency: r.currency || "MXN",
        hasDiscount: !!r.hasDiscount,
        originalPrice: r.originalPrice || null,
        policies: pos?.policies || null,
      },
      product
    );
  }

  // No live price via the alt store → NEVER invent one. Hand off, labeled by store.
  return {
    amount: null, source: null, handoff: true, link, marketplace: label, altOffline: !!r?.fetchFailed,
    handoffReason: r?.fetchFailed
      ? `⚠️ ${label} sin conexión — no se pudo leer el precio en vivo de ${product.name || "el producto"}; validar con un asesor`
      : `Sin precio en vivo en ${label} para ${product.name || "el producto"} — validar con un asesor`,
  };
}

async function resolvePrice(product, opts = {}) {
  const empty = { amount: null, source: null, handoff: false, link: null };
  if (!product) return empty;

  // A campaign routed this product to an alternate marketplace → resolve there.
  if (opts.altPos) return resolveViaAltPos(product, opts.altPos);

  // STOCK GATE: an active, sellable product with NO stock is still OFFERED, but
  // it's SOLD OUT → acknowledge it AND HAND OFF to a human (capture the lead so a
  // human can follow up / notify when it returns). Never quote-to-buy or share a
  // buy link. Stock is a MANUAL field (default 1). Treat undefined/unloaded stock
  // as available, so an un-selected field can never false-flag a product as sold out.
  if (
    product.active !== false &&
    product.sellable === true &&
    product.stock != null &&
    Number(product.stock) < 1
  ) {
    return {
      amount: null,
      source: null,
      handoff: true,
      soldOut: true,
      // A full roll never hands out a buy link, sold out or not — otherwise the
      // one path that runs BEFORE the full-roll branch leaks the ML link it
      // exists to withhold.
      link: (await resolveIsFullRoll(product)) ? null : mlLinkOf(product),
      handoffReason: `Producto AGOTADO (activo, sin stock): ${product.name || "producto del flujo"} — pasar con un asesor para seguimiento/aviso`,
    };
  }

  // ROLLO COMPLETO (see the note above isFullRoll): the sheet price, IVA in,
  // no link, always a handoff. Placed BEFORE the live-ML fetch on purpose — for
  // a full roll the ML price is not a better answer, it is the wrong one.
  if (await resolveIsFullRoll(product)) {
    // Read the sheet price and the tax flag from the DB, not from the caller's
    // projection. The same missing .select() that hid productCode also hides
    // priceExcludesTax, and quoting a net price as if it were gross undercharges
    // by 16% — the mirror image of the bug this rule exists to fix. NOT cached:
    // inventory prices are edited in the dashboard and must take effect at once.
    let sheet = numericPrice(product.price);
    let excludesTax = !!product.priceExcludesTax;
    if (product._id) {
      try {
        const PF = require("../../models/ProductFamily");
        const fresh = await PF.findById(product._id).select("price priceExcludesTax").lean();
        if (fresh) {
          sheet = numericPrice(fresh.price);
          excludesTax = !!fresh.priceExcludesTax;
        }
      } catch { /* fall back to whatever the caller loaded */ }
    }
    const gross = sheet == null ? null : round2(excludesTax ? sheet * (1 + IVA_RATE) : sheet);
    if (gross != null) {
      return {
        amount: gross,
        source: "inventario",
        live: false,
        link: null,
        plusIva: false,
        ivaIncluded: excludesTax,
        fullRoll: true,
        handoff: true,
        quoteThenHandoff: true,
        handoffReason: `ROLLO COMPLETO: ${product.name || "producto"} — cotizado en $${gross}${excludesTax ? " (IVA incluido)" : ""} del precio de lista, SIN link de Mercado Libre; el asesor cierra la venta y cotiza el envío`,
      };
    }
    return {
      amount: null,
      source: null,
      link: null,
      fullRoll: true,
      handoff: true,
      handoffReason: `ROLLO COMPLETO sin precio de lista: ${product.name || "producto"} — cotizar con un asesor, sin dar precio`,
    };
  }

  const link = mlLinkOf(product);
  const invPrice = numericPrice(product.price); // Inventario
  const syncedMl = numericPrice(product.mlPrice); // last-synced ML price (ProductFamily.mlPrice)
  // "+ IVA" belongs to the INVENTARIO price only. A Mercado Libre price — live or
  // last-synced — is a consumer price with tax already in it, so appending "+ IVA"
  // to one overcharges the customer by 16% on a number we didn't even set. The flag
  // describes product.price, not whatever ML is showing today.
  const plusIva = !!product.priceExcludesTax; // applies to the Inventario price

  // 1. LIVE ML price — the source of truth. Quote it whenever we can fetch it.
  //    This NEVER downgrades while a live price exists.
  let mlOffline = false; // ML was UNREACHABLE (not just "listing had no price")
  // The link exists but ML has NO price behind it (404 / catalog with no winner —
  // e.g. every one of our listings for that product is paused). The customer can't
  // buy there, so the link must NOT be handed out as if they could.
  let mlUnpriceable = false;
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
          plusIva: false, // ML prices include IVA

          hasDiscount: !!r.hasDiscount,
          originalPrice: r.originalPrice || null,
        };
      }
      if (r && r.fetchFailed) mlOffline = true; // couldn't reach ML at all
      else if (r) mlUnpriceable = true; // reached ML; it has nothing to sell there
    } catch (err) {
      mlOffline = true;
      console.error("⚠️ resolvePrice ML lookup failed:", err.message);
    }
  }

  // NO ML LINK AT ALL → `mlPrice` describes a listing we no longer point anyone to.
  // Nobody set that number on purpose: the sync wrote it, and the sync finds products
  // BY their link, so the moment the link goes the cached price freezes forever (the
  // delisted borde rolls are stuck on a June sync). Keeping it in play bought nothing
  // — on every unlinked product it equals `price` — while the "inventario below the
  // last ML price" guard below would fire the first time someone lowers the sheet
  // price for a delisted item, and the bot would stop quoting a price at all. That
  // guard protects a LIVE listing from being undersold; with no listing there is
  // nothing to undersell. So: no link ⇒ the price sheet decides, and the quote still
  // hands off, because the customer can't self-serve without a link.
  if (!link) {
    if (invPrice != null) {
      return noLinkResult({ amount: invPrice, source: "inventario", link: null, plusIva }, product);
    }
    // NO SHEET PRICE EITHER → hand off, and quote NOTHING. The stale `mlPrice` is not a
    // fallback: nobody set it, it belongs to a listing we removed, and a number no
    // human stands behind is worse than no number. A person quotes this one.
    return {
      amount: null,
      source: null,
      handoff: true,
      link: null,
      handoffReason: `Sin link de compra y sin precio de lista para ${product.name || "el producto"} — cotizar con un asesor${syncedMl != null ? ` (el último precio ML conocido, $${syncedMl}, es de una publicación retirada: NO cotizarlo al cliente)` : ""}`,
    };
  }

  // THE LINK EXISTS BUT THE LISTING SELLS NOTHING (404, paused, catalogue with no
  // winner). The customer cannot buy there, and the cached `mlPrice` is the price of
  // exactly that dead listing — so it is not the number to quote either. Look in the
  // PRICE SHEET; if the sheet has nothing, quote NOTHING and hand off. The link is
  // withheld in both cases: sending someone to a page with nothing to buy is worse
  // than sending them nowhere. (This runs BEFORE the undersell guard below: that guard
  // protects a LIVE listing from being undercut, and this listing isn't live.)
  if (mlUnpriceable) {
    if (invPrice != null) {
      return {
        amount: invPrice, source: "inventario", live: false, link: null, plusIva,
        handoff: true, quoteThenHandoff: true,
        handoffReason: `Sin publicación activa en Mercado Libre para ${product.name || "el producto"} — cotizado en $${invPrice} (precio de lista); cerrar la venta con un asesor`,
      };
    }
    return {
      amount: null,
      source: null,
      handoff: true,
      link: null,
      handoffReason: `Sin publicación activa en Mercado Libre y sin precio de lista para ${product.name || "el producto"} — cotizar con un asesor${syncedMl != null ? ` (el último precio ML conocido, $${syncedMl}, es de esa publicación caída: NO cotizarlo al cliente)` : ""}`,
    };
  }

  // A LINK EXISTS, the listing is presumably fine, but we could NOT READ the live
  // price (ML unreachable). Here the cached price still describes a REAL, buyable
  // listing, so it stands in until ML answers again — and the undersell guard below
  // still applies, because the customer can click through to the real price.
  if (syncedMl != null) {
    // 2a. We still have a last-synced ML price. If Inventario is BELOW it, the
    //     two sources disagree and quoting the cheaper Inventario would
    //     undersell — hand to a human instead of serving a wrong number.
    if (invPrice != null && invPrice < syncedMl) {
      return {
        amount: null,
        source: null,
        handoff: true,
        mlOffline, // true → this handoff was forced by ML being unreachable, not a real price issue
        link,
        handoffReason: mlOffline
          ? `⚠️ Mercado Libre sin conexión — no se pudo leer el precio en vivo; inventario ($${invPrice}) por debajo del último precio ML ($${syncedMl}) — validar con un asesor`
          : `Sin precio ML en vivo; inventario ($${invPrice}) por debajo del último precio ML ($${syncedMl}) — validar con un asesor`,
      };
    }
    // 2b. No conflict (Inventario ≥ synced, or no Inventario) → quote the
    //     last-synced ML price. The listing is live; this is the same number the
    //     customer will see when they click, just read from cache.
    return noLinkResult({ amount: syncedMl, source: "ml", live: false, link, plusIva: false }, product); // ML price → IVA included
  }

  // 3. No ML price AT ALL (never synced / not an ML product) → Inventario is the
  //    legitimate last resort. Same no-link rule: quote it, but hand off if there
  //    is no purchase link.
  if (invPrice != null) {
    return noLinkResult({ amount: invPrice, source: "inventario", link, plusIva }, product);
  }

  // 4. sellable but no price anywhere → human handoff (never invent a price).
  const sellable = product.active !== false && product.sellable === true;
  if (sellable) {
    return {
      amount: null, source: null, handoff: true, link,
      handoffReason: `Sin precio registrado para ${product.name || "el producto"} — cotizar con un asesor`,
    };
  }

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

// The official store link. Prefer the CORE store (default POS — interchangeable),
// then fall back to the company's configured marketplaces (ML-preferring heuristic).
async function officialStoreUrl() {
  try {
    const def = await marketplace.getDefaultPos();
    if (def?.defaultUrl) return def.defaultUrl;
  } catch { /* fall through to marketplaces list */ }
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

// DETERMINISTIC ALT-LINK ENFORCEMENT — when the turn quoted a product routed to an
// alternate marketplace, the customer must be sent to THAT store, never Mercado
// Libre. The model (or the grounding verifier) sometimes re-emits a raw ML URL it
// saw earlier in the conversation; this rewrites every ML URL in the reply to the
// tracked alt-store link. Caller gates this on the TURN's own quoted product, so a
// non-routed measure's ML link is never touched.
// @param {string} text
// @param {{altLink:string, psid?:string, sandbox?:boolean, productName?:string, productId?:string}} opts
// @returns {Promise<string>}
async function enforceAltMarketplaceLink(text, opts = {}) {
  if (!text || !opts.altLink) return text;
  if (!/mercadolibre\.com/i.test(text)) return text; // nothing to rewrite
  const tracked =
    (await trackedLink(opts.altLink, {
      psid: opts.psid,
      sandbox: opts.sandbox,
      productName: opts.productName,
      productId: opts.productId,
    })) || opts.altLink;
  return text.replace(/https?:\/\/[^\s)]*mercadolibre\.com[^\s)]*/gi, tracked);
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

// DETERMINISTIC MEASURE CLAMP — the measure analog of clampPrices. The model
// resolves the RIGHT product (price + link correct) but sometimes mistypes the
// W×L label in its sentence (e.g. resolves 8x4 / $989 / the 8x4 link, but writes
// "La de 7x4..."). A measure, like a price, is not the model's to author. When the
// turn quoted ONE measure, any divergent W×L token in the reply is rewritten to it.
//
// SAFE BY DESIGN: caller passes a canonical measure ONLY on a single-measure exact
// quote (not multi-measure, not a nearest-substitution) — otherwise this is a
// no-op. URLs are masked first so a measure inside a link is never touched.
//
// @param {string} text
// @param {string} canonical - the measure to rewrite TO, in the customer's order ("8x4")
// @param {Array<[number,number]>} allowedPairs - sorted [a,b] measures legit this turn
// @returns {{ text: string, changed: boolean }}
function clampMeasures(text, canonical, allowedPairs = []) {
  if (!text || !canonical) return { text, changed: false };
  const norm = (a, b) => [Math.min(a, b), Math.max(a, b)];
  const allowed = (allowedPairs || [])
    .filter((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
    .map((p) => norm(+p[0], +p[1]));
  if (!allowed.length) return { text, changed: false };
  const eq = (x, y) => Math.abs(x[0] - y[0]) < 0.05 && Math.abs(x[1] - y[1]) < 0.05;

  // Mask URLs so a measure inside a link (…6mx4m…) is never rewritten.
  const urls = [];
  let masked = text.replace(/https?:\/\/\S+/gi, (u) => { urls.push(u); return `@@U${urls.length - 1}@@`; });

  let changed = false;
  masked = masked.replace(
    /\b(\d{1,3}(?:\.\d+)?)\s*[x×]\s*(\d{1,3}(?:\.\d+)?)(\s*(?:mts?\b|metros\b|m\b))?/gi,
    (mtch, a, b, suf) => {
      const pair = norm(parseFloat(a), parseFloat(b));
      if (allowed.some((p) => eq(p, pair))) return mtch;
      changed = true;
      return `${canonical}${suf || ""}`;
    }
  );
  const out = masked.replace(/@@U(\d+)@@/g, (_, i) => urls[+i] || "");
  return { text: out, changed };
}

// One place that turns a resolved price into the text customers see. Before
// this, twenty-odd call sites each wrote `$${pi.amount}${pi.plusIva ? " + IVA"
// : ""}` by hand, so a new tax shape had to be added in twenty places or it
// silently printed the wrong thing in nineteen of them.
function fmtMoney(pi) {
  if (!pi || pi.amount == null) return "";
  // Cents get both digits or none: a gross price printed as "$4222.4" reads like
  // a typo next to the asesor's "$4,222.40". Whole pesos stay bare, which is how
  // every other price in the bot is written.
  const n = Number(pi.amount);
  const amt = Number.isFinite(n) && Math.round(n * 100) % 100 !== 0 ? n.toFixed(2) : String(pi.amount);
  if (pi.plusIva) return `$${amt} + IVA`;
  if (pi.ivaIncluded) return `$${amt} (IVA incluido)`;
  return `$${amt}`;
}


// ─────────────────────────────────────────────────────────────────────────────
// COLOR CHOICE COMES AFTER THE PRICE, INVENTORY-WIDE (2026-10-23, client's rule).
// "¿La quieres en negro o en blanco?" was the entire reply to a price question. When a
// product's colors are the same size at the same price, making the customer pick one
// before they can learn the cost buys nothing, so we quote once and hand them the colors
// with their links. 61 sibling sets in the catalog share a parent and a size; 54 of them
// are priced identically, so this is the ordinary case rather than the exception.
//
// Equality is COMPUTED here at quote time and never assumed. Six confeccionada sizes
// genuinely do price by color (6x4 m is $649 beige / $729 negro / $1320 verde), and the
// live ML listings disagree with the price sheet more often than the sheet disagrees with
// itself (ground cover 4x10 m is $690.80 negro against $933.90 blanco). When the prices
// differ, each color is listed with its own number so the customer chooses knowing both.
// A hardcoded "igual en negro y en blanco" would quietly start lying the day one of those
// listings moves.
const COLOR_LEAF_NAME = /^\s*(?:color\s+)?(beige|negro|negra|blanco|blanca|verde|gris)\s*$/i;

// `resolve(doc)` → a price info object, and `link(pi, doc)` → a buy URL. Both are supplied
// by the caller so this stays free of the engine's per-ad marketplace options and psid.
async function colorChoiceForProduct(product, { resolve, link, self = null } = {}) {
  try {
    if (!product || !product.parentId || typeof resolve !== "function") return null;
    const PF = require("../../models/ProductFamily");
    const sibs = await PF.find({ parentId: product.parentId, sellable: true, active: { $ne: false } }).lean();
    const colors = sibs.filter((d) => COLOR_LEAF_NAME.test(String(d.name || "")));
    if (colors.length < 2) return null;
    // A parent can hold colors AND sizes, so keep only the siblings of THIS size. If the
    // size field is empty on all of them (ground cover leaves are named just "Negro"),
    // the parent already IS the size node and every color sibling belongs.
    const sizeKey = (d) => String(d.size || "").trim().toLowerCase();
    const mine = sizeKey(product);
    const sameSize = colors.filter((d) => sizeKey(d) === mine);
    const set = sameSize.length >= 2 ? sameSize : colors;
    if (set.length < 2) return null;

    const variants = [];
    for (const d of set) {
      const pi =
        self && String(d._id) === String(product._id)
          ? self
          : await Promise.resolve(resolve(d)).catch(() => null);
      if (!pi || pi.amount == null) continue;
      // Promise.resolve: a caller's link() may return null synchronously — full rolls carry
      // no buy link by rule — and `.catch` on that plain null threw, which this function's
      // own try/catch swallowed, so the color choice silently vanished from every reply.
      const url =
        typeof link === "function" ? await Promise.resolve(link(pi, d)).catch(() => null) : null;
      variants.push({
        id: String(d._id),
        label: String(d.name || "").replace(/^\s*color\s+/i, "").trim() || String(d.name || ""),
        pi,
        url: url || null,
      });
    }
    if (variants.length < 2) return null;
    const amounts = new Set(variants.map((v) => Number(v.pi.amount)));
    return { variants, allSame: amounts.size === 1, labels: variants.map((v) => v.label) };
  } catch (e) {
    console.error("⚠️ color choice failed:", e.message);
    return null;
  }
}

// Spanish list: "beige, negro y verde" for a statement, "beige, negro o verde" for a
// question. A choice joined with "y" reads as being offered all of them at once —
// "¿Lo quieres en negro y blanco?" asks nothing.
function joinEs(items, conj = "y") {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  return `${a.slice(0, -1).join(", ")} ${conj} ${a[a.length - 1]}`;
}

// Renders the color half of a quote. `allSame` → the price is said ONCE and the colors
// are named, each with its own link (never one link reused for every color: that bug
// shipped the same URL for Beige and Verde). Otherwise every color carries its price.
function colorChoiceText(cc) {
  if (!cc || !cc.variants || cc.variants.length < 2) return { suffix: "", lines: "", ask: "" };
  const discOf = (pi) =>
    pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount
      ? `, rebajado de $${Math.round(pi.originalPrice)}`
      : "";
  if (cc.allSame) {
    const lines = cc.variants.filter((v) => v.url).map((v) => `• ${v.label}: ${v.url}`);
    return {
      suffix: `, igual en ${joinEs(cc.labels.map((l) => l.toLowerCase()))}`,
      lines: lines.length ? lines.join("\n") : "",
      ask: "",
    };
  }
  // PRICES DIFFER ⇒ ASK WHICH COLOR (the client's rule, stated exactly: "if prices differ
  // we ask them but if they don't we share the price"). Asking is only pointless when the
  // answer cannot change the number — that was the original complaint, a color question
  // standing in for the price of a full roll that costs the same either way. Here the
  // color IS the price, so the question earns its turn. `lines` stays available for the
  // callers that would rather show every number than ask.
  return {
    suffix: "",
    // The caller composes ONE sentence from `colorsOr` + `ask`; the colors are named once.
    colorsOr: joinEs(cc.labels.map((l) => l.toLowerCase()), "o"),
    ask: `con precio distinto en cada color. ¿Cuál prefieres?`,
    lines: cc.variants
      .map((v) => `• ${v.label}: ${fmtMoney(v.pi)}${discOf(v.pi)}${v.url ? ` — ${v.url}` : ""}`)
      .join("\n"),
  };
}

module.exports = {
  isFullRoll,
  resolveIsFullRoll,
  colorChoiceForProduct, colorChoiceText,
  fmtMoney, resolvePrice, mlLinkOf, trackedLink, sanitizeMarketplaceLinks, enforceAltMarketplaceLink, clampPrices, clampMeasures, isGenericMlUrl, officialStoreUrl };
