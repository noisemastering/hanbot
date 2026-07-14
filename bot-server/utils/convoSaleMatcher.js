// utils/convoSaleMatcher.js
//
// Conversation → Sale attribution. For a conversation that exposes identity/intent
// (name, zip, city, item asked for), find the best matching paid ml_sales order by
// cross-referencing against the sale's ship-to (zip/city/receiver), buyer (nickname/
// name) and purchased item, then score with the SAME tiered rubric as the existing
// click-based conversionCorrelation (so the Conversions view stays consistent).
//
// Precise item matching: a conversation's ProductFamily (leaf/root) is matched to a
// sale item via ProductFamily.mlItemIds, expanded up the ancestor chain — so a leaf
// interest still matches an item mapped at an ancestor node. (Loose "product root
// name appears in title" is recorded as an informational flag, NOT used to attribute.)

const { normalizeName, normalizeCity, poiMatchesProduct } = require("./conversionCorrelation");

const normZip = (z) => String(z || "").replace(/\D/g, "") || null;
// State name → comparable key (lowercase, no accents). Many MX municipalities share
// a name across states (Juárez Chihuahua vs Juárez Nuevo León), so city matching
// and a hard cross-state guard both hinge on this.
const normState = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim() || null;
// Mexico City local day (UTC-6) — clicks and sales are compared on the local calendar day.
const mxDay = (d) => new Date(new Date(d).getTime() - 6 * 3600e3).toISOString().slice(0, 10);

// Words a real customer NAME never contains — used to REJECT phrases the extractor
// mistook for a name (e.g. "que tome bien las medidas", "quiero la cotización"). Soft
// connectors (de/del/la/los/las/y) are intentionally NOT here so real names like
// "María del Carmen" / "José de los Santos" still pass.
const NAME_NON_WORDS = new Set([
  "que", "tome", "toma", "tomen", "tomar", "bien", "mal", "muy", "medidas", "medida", "favor",
  "porfavor", "gracias", "hola", "buenas", "buenos", "dias", "tardes", "noches", "precio", "precios",
  "cotizacion", "cotizaciones", "cotizar", "cotice", "envio", "envios", "enviar", "enviame", "mandame",
  "manden", "mande", "pongan", "instalador", "instalen", "instale", "quiero", "necesito", "ocupo",
  "busco", "podria", "podrias", "puede", "puedes", "cuanto", "cuanta", "cuesta", "vale", "valen",
  "gustaria", "informacion", "info", "disponible", "disponibles", "color", "colores", "metros", "metro",
  "malla", "sombra", "rollo", "borde", "compro", "compre", "pague", "tengo", "tiene", "hacer", "dame",
  "den", "ver", "checa", "revisa", "confirma", "si", "no", "pero", "como", "cuando", "donde", "porque",
  "para", "con", "sin", "por", "es", "esta", "este", "eso", "esa",
]);
// Does this string plausibly LOOK like a person's name? Names are 1-5 alphabetic tokens
// and never contain the phrase/request words above. Blocks garbage extractions from being
// used (or displayed) as a name in correlation.
function looksLikeName(s) {
  const n = normalizeName(s);
  if (!n) return false;
  const toks = n.split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 5) return false;
  if (toks.some((t) => NAME_NON_WORDS.has(t))) return false;
  if (toks.some((t) => !/^[a-zñ'.-]{2,}$/.test(t))) return false; // alphabetic tokens, ≥2 chars
  return true;
}

// True only when the convo's first name plausibly IS the ML username. Requires ≥4 chars
// (so short common substrings like "que"→"enrique", "ana"→"juanana" don't false-match)
// AND that the firstName appears at a word/segment boundary in the nickname.
function nameInNickname(firstName, nickname) {
  if (!firstName || !nickname || firstName.length < 4) return false;
  const nk = normalizeName(nickname) || "";
  // Segment the nickname on non-letters (JOSE_ENRIQUE, jose.perez, jose123) and require
  // the firstName to START one of those segments — not merely appear somewhere inside.
  return nk.split(/[^a-zñ]+/).filter(Boolean).some((seg) => seg.startsWith(firstName));
}

function tokensOf(name) {
  return (normalizeName(name) || "").split(/\s+/).filter((t) => t.length >= 3);
}

// convo names (array) vs one sale name string → true if ≥2 shared tokens, or a
// single shared token AND the convo name is a substring of the sale name.
function nameMatches(convoNames, saleName) {
  if (!saleName) return false;
  const st = new Set(tokensOf(saleName));
  const nSale = normalizeName(saleName);
  for (const cn of convoNames) {
    const ct = tokensOf(cn);
    if (!ct.length) continue;
    const shared = ct.filter((t) => st.has(t));
    if (shared.length >= 2) return true;
    if (shared.length >= 1 && nSale.includes(normalizeName(cn))) return true;
  }
  return false;
}

/**
 * Build the lookup maps needed to match (call once, reuse across conversations).
 * @returns {Promise<{itemToFamilies: Map<string,Set<string>>, cityIndex: Map<string,string[]>, userLoc: Map<string,object>}>}
 */
async function buildContext() {
  const ProductFamily = require("../models/ProductFamily");
  const MLSale = require("../models/MLSale");
  const User = require("../models/User");

  // parent chain for ancestor expansion
  const all = await ProductFamily.find({}).select("_id parentId mlItemIds").lean();
  const parentOf = new Map();
  for (const f of all) parentOf.set(String(f._id), f.parentId ? String(f.parentId) : null);
  const ancestors = (fid) => {
    const chain = [];
    let cur = fid,
      guard = 0;
    while (cur && guard++ < 16) {
      chain.push(cur);
      cur = parentOf.get(cur) || null;
    }
    return chain;
  };
  // itemId → { this family + all its ancestors }
  const itemToFamilies = new Map();
  // family id → the EXACT mlItemIds listed ON that node (a specific listing) — used
  // for orphan exact-item matching (no ancestors: "same item", not "same family").
  const famOwnItems = new Map();
  for (const f of all) {
    if (!Array.isArray(f.mlItemIds) || !f.mlItemIds.length) continue;
    famOwnItems.set(String(f._id), f.mlItemIds.map(String));
    const fam = ancestors(String(f._id));
    for (const itemId of f.mlItemIds) {
      const key = String(itemId);
      const set = itemToFamilies.get(key) || new Set();
      fam.forEach((x) => set.add(x));
      itemToFamilies.set(key, set);
    }
  }

  // normalizedCity → [stored ML city names] (so a no-zip convo can query by city)
  const cities = await MLSale.distinct("shipping.city");
  const cityIndex = new Map();
  for (const c of cities) {
    if (!c) continue;
    const nc = normalizeCity(c);
    if (!nc) continue;
    const arr = cityIndex.get(nc) || [];
    arr.push(c);
    cityIndex.set(nc, arr);
  }

  // psid/unifiedId → User.location
  const users = await User.find({ "location.zipcode": { $exists: true } })
    .select("psid unifiedId location")
    .lean()
    .catch(() => []);
  const userLoc = new Map();
  for (const u of users) {
    const loc = u.location || {};
    if (u.psid) userLoc.set(String(u.psid), loc);
    if (u.unifiedId) userLoc.set(String(u.unifiedId), loc);
  }

  // zip → city. A captured zip INHERENTLY names a city (approved criterion): when a
  // convo gave a zip but no city, derive the city from it so a same-city sale to a
  // DIFFERENT zip still matches at the city tier.
  const ZipCode = require("../models/ZipCode");
  const zipToCity = new Map();
  const zipToState = new Map(); // zip → state, so a convo's state can gate city matches
  const zips = await ZipCode.find({}).select("code city municipality state").lean().catch(() => []);
  for (const z of zips) {
    const c = z.city || z.municipality;
    const key = z.code ? String(z.code).replace(/\D/g, "").padStart(5, "0") : null;
    if (key && c) zipToCity.set(key, c);
    if (key && z.state) zipToState.set(key, z.state);
  }

  // psid → set of Mexico-local DAYS on which they CLICKED a tracked link (approved
  // criterion): a convo must have a clicked link to be eligible, and the sale must
  // fall on the SAME day as a click. Kills "clicked 2 months ago → today's sale".
  const ClickLog = require("../models/ClickLog");
  const psidClickDays = new Map(); // day-level gate (GATE 2)
  const psidClickTimes = new Map(); // exact click timestamps (ms) → per-tier time window
  // psid → sizes of the products they CLICKED. The clicked link is the AUTHORITATIVE
  // POI (they picked that exact product), so it feeds the item match directly — a
  // click→buy of the same size is the SAME product even if the chat never named it.
  const psidClickSizes = new Map();
  const clicks = await ClickLog.find({ clicked: true, clickedAt: { $ne: null } }).select("psid clickedAt productName").lean().catch(() => []);
  for (const c of clicks) {
    const key = String(c.psid);
    if (!psidClickDays.has(key)) psidClickDays.set(key, new Set());
    psidClickDays.get(key).add(mxDay(c.clickedAt));
    if (!psidClickTimes.has(key)) psidClickTimes.set(key, []);
    psidClickTimes.get(key).push(new Date(c.clickedAt).getTime());
    const sz = parseTitleSize(c.productName);
    if (sz) { if (!psidClickSizes.has(key)) psidClickSizes.set(key, new Set()); psidClickSizes.get(key).add(sz); }
  }

  return { itemToFamilies, famOwnItems, cityIndex, userLoc, zipToCity, zipToState, psidClickDays, psidClickTimes, psidClickSizes, salesDayCache: new Map() };
}

// Gather a conversation's identity signals into a normalized shape.
function convoIdentity(convo, ctx) {
  const uloc = ctx.userLoc.get(String(convo.psid)) || {};
  const ai = convo.aiIdentity || {}; // AI-extracted from the chat text (fallback when fields are empty)
  const zip =
    [
      convo.zipCode,
      convo.zipcode,
      convo.customOrderZipcode,
      convo.humanSalesZipcode,
      convo.leadData && convo.leadData.zipcode,
      uloc.zipcode,
      ai.zip,
    ]
      .map(normZip)
      .find(Boolean) || null;

  // City: explicit fields first, else DERIVE from the captured zip (a zip names a city).
  const cityRaw =
    convo.city || uloc.city || (convo.leadData && convo.leadData.location) || ai.city ||
    (zip && ctx.zipToCity && ctx.zipToCity.get(zip)) || null;
  const city = normalizeCity(cityRaw);

  // State: the zip's state is authoritative (disambiguates same-named municipalities
  // across states); fall back to the AI-extracted state. Used to gate city matches.
  const state = normState((zip && ctx.zipToState && ctx.zipToState.get(zip)) || ai.state || convo.state || null);

  const names = [
    ...new Set(
      [
        convo.extractedName,
        convo.productSpecs && convo.productSpecs.customerName,
        convo.leadData && convo.leadData.name,
        convo.crmName,
        ai.name,
      ]
        .map(normalizeName)
        .filter(Boolean)
        .filter(looksLikeName) // drop phrases the extractor mistook for a name ("que tome bien…")
    ),
  ];
  const firstName = names.length ? names[0].split(/\s+/)[0] : null;

  const famIds = [
    ...new Set(
      [
        convo.productFamilyId,
        convo.productSpecs && convo.productSpecs.familyId,
        convo.poiRootId,
      ]
        .map((x) => (x ? String(x) : null))
        .filter(Boolean)
    ),
  ];
  const poiName = convo.poiRootName || convo.productInterest || null;

  // EXACT item ids the convo references (mlItemIds listed directly on its product
  // nodes) — for orphan exact-item matching. adMainProductId is the ad's specific product.
  const exactRefs = [
    convo.productFamilyId,
    convo.productSpecs && convo.productSpecs.familyId,
    convo.adMainProductId,
    convo.poiRootId,
  ]
    .map((x) => (x ? String(x) : null))
    .filter(Boolean);
  const exactItemIds = new Set();
  for (const r of exactRefs) {
    const ids = ctx.famOwnItems.get(r);
    if (ids) ids.forEach((i) => exactItemIds.add(i));
  }

  // Basket: every size the customer discussed (from itemsDiscussed backfill). Matched
  // to sales by SIZE (parsed from the sale's title), NOT item id — ML relists change
  // the id for the same product, so an id set goes stale; the size in the title doesn't.
  // Sizes DISCUSSED in the chat (from itemsDiscussed) — drives the display/day-split.
  const basketSizes = new Set((convo.itemsDiscussed || []).map((b) => b.askedAs).filter(Boolean));
  // POI from the CLICKED LINK (authoritative): the product they clicked is one they
  // wanted. Kept in a SEPARATE set — poiSizes = discussed ∪ clicked — used for the ITEM
  // MATCH + eligibility, so a click→buy of the same size is the SAME product even when
  // the chat never named it, WITHOUT polluting the discussed-sizes display/day-split.
  const clickSizes = new Set((ctx.psidClickSizes && ctx.psidClickSizes.get(String(convo.psid))) || []);
  const poiSizes = new Set([...basketSizes, ...clickSizes]);
  const convoIsRollo = /rollo/i.test(`${convo.productInterest || ""} ${convo.poiRootName || ""}`);

  return { zip, city, cityRaw, state, names, firstName, famIds, poiName, exactItemIds, basketSizes, clickSizes, poiSizes, convoIsRollo };
}

// Canonical "WxL" (min×max) parsed from an ML item title — stable across relists.
function parseTitleSize(title) {
  const m = String(title || "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (!(a >= 1 && a <= 16 && b >= 1 && b <= 16)) return null;
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}

// Extract every WxL size a message text mentions (customer's words), normalized to
// "min x max". Used to know which discussed sizes were raised on a given day.
function extractSizes(text) {
  const t = String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2");
  const out = new Set();
  const rx = /(\d{1,2}(?:\.\d)?)\s*(?:x|por|×|\*)\s*(\d{1,2}(?:\.\d)?)/g;
  let m;
  while ((m = rx.exec(t))) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a >= 1 && a <= 16 && b >= 1 && b <= 16) out.add(`${Math.min(a, b)}x${Math.max(a, b)}`);
  }
  return out;
}

// Identify WHICH of our products a sale is, from its TITLE (not its ML id, which
// changes on relist). Reads line, size, shade % and color out of the title into a
// canonical label, e.g. "Reforzada 2x4 90% Beige". This is how we know the bought
// product regardless of the volatile item id.
function resolveSaleProduct(title) {
  const t = String(title || "").toLowerCase();
  if (!t) return null;
  const size = parseTitleSize(title);
  const line =
    /sin\s*refuerzo|argolla/.test(t) ? "Sin refuerzo"
      : /reforzad|con\s*refuerzo/.test(t) ? "Reforzada"
      : /rollo|por\s*metro/.test(t) ? "Rollo"
      : /ground\s*cover|antimaleza/.test(t) ? "Ground cover"
      : /borde/.test(t) ? "Borde separador"
      : "Malla sombra";
  const shade = (t.match(/(\d{2})\s*%/) || [])[1];
  const color = (t.match(/\b(beige|negro|negra|verde|blanco|blanca|gris|azul|arena|terracota|cafe|café)\b/) || [])[1];
  const label = [line, size, shade ? `${shade}%` : null, color].filter(Boolean).join(" ");
  return { line, size, shade: shade || null, color: color || null, label };
}
const isRolloTitle = (t) => /rollo|por\s*metro/i.test(String(t || ""));

// "Same item" = the sale's exact PRODUCT (its SIZE) is one the customer discussed —
// NOT merely the same broad family. Every product is "malla sombra raschel", so a
// family match is meaningless (always true) and wrongly promoted city/different-size
// sales to the "+ item" tier. Match on the size (parsed from the sale title) against
// the sizes the customer discussed (basket). Different size ⇒ different product.
function itemMatch(sale, id) {
  // Match against poiSizes = discussed ∪ clicked-link (the clicked product is an
  // authoritative POI); falls back to basketSizes for older callers.
  const pool = id.poiSizes || id.basketSizes;
  if (!pool || !pool.size) return false;
  for (const it of sale.items || []) {
    const sz = parseTitleSize(it.title);
    if (sz && pool.has(sz)) return true;
  }
  return false;
}

// informational: product root name appears in an item title
function poiFuzzy(sale, poiName) {
  if (!poiName) return false;
  return (sale.items || []).some((it) => poiMatchesProduct(poiName, it.title));
}

const H10M = 10 / 60; // 10 minutes in hours
const H5M = 5 / 60; //  5 minutes in hours
const H1M = 1 / 60; //  1 minute in hours
const H30M = 30 / 60; // 30 minutes in hours

// Per-tier decay: the base% holds for `flat` hours (the flat window), then drops
// −10 points every `step` hours until it hits 0 (→ null, no correlation). `step: null`
// = a HARD window (base% until `flat`, then nothing). `g` = directional click→sale gap.
function decayScore(base, flat, step, g, dec = 10) {
  if (g <= flat) return base;
  if (step == null) return null; // hard time window expired
  // −1e-9 so an EXACT boundary (e.g. g = flat + k·step) lands on k steps, not k+1
  // (float error otherwise pushes ceil up one, e.g. 50% → 30% instead of 40% at 6 min).
  const pct = base - dec * Math.ceil((g - flat) / step - 1e-9);
  return pct > 0 ? pct : null;
}

// The tiering rubric (agreed 2026-07-11). Each tier = base% + flat window + decay.
// Nickname (buyer's ML username) is treated as a valid identity match with the name.
function classify(m) {
  const med = (pct) => (pct >= 70 ? "high" : pct >= 50 ? "medium" : "low");
  const g = m.gapHours == null ? Infinity : Math.abs(m.gapHours);
  const gTxt = m.gapHours == null ? "s/tiempo"
    : g < 1 ? `${Math.round(g * 60)}min` : `${Math.round(g * 10) / 10}h`;

  let pct = null, tier = "", vi = false, undisputed = false;

  if (m.itemMatch) {
    // SAME product (a size the customer discussed OR clicked). Rubric 2026-07-13:
    // identity (name/nickname) dominates; location alone is weak + fast-decaying; and
    // NO location AND NO name/nickname ⇒ NOT attributable (0%). Ordered top→down so
    // every tier is reachable (city+name is checked before the location-less identity
    // tier, otherwise a lone name would shadow it).
    if (m.zipMatch && m.nameMatch && m.nicknameMatch) { pct = decayScore(100, 2, 1, g); tier = "cp + nombre + usuario ML + item"; undisputed = pct === 100; }
    else if (m.nameMatch && m.nicknameMatch) { pct = decayScore(90, 2, 1, g); tier = "nombre + usuario ML + item"; }
    else if (m.zipMatch && m.nameMatch) { pct = decayScore(80, 1, H30M, g); tier = "cp + nombre + item"; }
    else if (m.cityMatch && m.nameMatch) { pct = decayScore(60, H10M, H5M, g); tier = "ciudad + nombre + item"; }
    else if (m.nameMatch || m.nicknameMatch) { pct = decayScore(70, 30, 30, g); tier = "nombre/usuario ML + item"; }
    else if (m.zipMatch) { pct = decayScore(50, H5M, H1M, g); tier = "cp + item"; }
    else if (m.cityMatch) { pct = decayScore(20, H1M, H1M, g); tier = "ciudad + item"; }
    // else → no zip, no city, no name/nickname → 0% (pct stays null → not attributed)
  } else {
    // DIFFERENT product (venta indirecta). Only a ZIP + strong signal attributes; the
    // "misma familia" tiers require the bought item to share the convo's product family.
    // Anything without a zip (or without name/nickname/family) ⇒ NOT attributable (0%).
    vi = true;
    if (m.zipMatch && m.nameMatch && m.nicknameMatch) { pct = decayScore(90, 2, 1, g); tier = "producto distinto · cp + nombre + usuario ML"; }
    else if (m.zipMatch && m.nameMatch && m.sameFamily) { pct = decayScore(80, 2, H30M, g); tier = "producto distinto, misma familia · cp + nombre"; }
    else if (m.zipMatch && m.sameFamily) { pct = decayScore(60, H5M, H1M, g, 20); tier = "producto distinto, misma familia · cp"; }
    // else → not attributable (0%)
  }

  if (pct == null) return null;
  return { pct, confidence: med(pct), undisputed, ventaIndirecta: vi, reason: `${tier} · ${gTxt} (${pct}%)` };
}

const ORPHAN_WINDOW_MS = 5 * 60000; // ±5 min

// Orphan (no location/name) → purchase of a size in the convo's BASKET within ±5 min.
// 60% tier. Matches by SIZE parsed from the sale title (id-independent → survives ML
// relists). Multi-item safe: if several matching sales fall in the window they must
// all belong to ONE buyer (same nickname/id) — otherwise it's genuinely ambiguous.
async function matchOrphanByBasket(convo, id, MLSale) {
  if (!id.basketSizes || !id.basketSizes.size) return null;
  const anchor = convo.lastMessageAt
    ? new Date(convo.lastMessageAt)
    : convo.createdAt
    ? new Date(convo.createdAt)
    : null;
  if (!anchor) return null;

  const cands = await MLSale.find({
    dateCreated: { $gte: new Date(anchor.getTime() - ORPHAN_WINDOW_MS), $lte: new Date(anchor.getTime() + ORPHAN_WINDOW_MS) },
  }).lean();

  // keep sales whose purchased item size is in the basket and product line matches
  const matching = cands.filter((s) =>
    (s.items || []).some((it) => {
      const sz = parseTitleSize(it.title);
      if (!sz || !id.basketSizes.has(sz)) return false;
      return id.convoIsRollo ? isRolloTitle(it.title) : !isRolloTitle(it.title);
    })
  );
  if (!matching.length) return null;

  // must resolve to a single buyer (multi-item purchases share one buyer)
  const buyerKey = (s) => String((s.buyer && (s.buyer.id || s.buyer.nickname)) || s._id);
  const buyers = new Set(matching.map(buyerKey));
  if (buyers.size !== 1) return null; // 0 or 2+ distinct buyers → ambiguous

  matching.sort((a, b) => Math.abs(new Date(a.dateCreated) - anchor) - Math.abs(new Date(b.dateCreated) - anchor));
  const s = matching[0];
  const gapMin = Math.round((new Date(s.dateCreated) - anchor) / 60000);
  const matchedSizes = [...new Set(matching.flatMap((x) => (x.items || []).map((it) => parseTitleSize(it.title)).filter((z) => z && id.basketSizes.has(z))))];
  return {
    _id: `${convo.psid}::${s._id}`,
    psid: convo.psid,
    conversationId: convo._id,
    orderId: s._id,
    certainty: 60,
    confidence: "medium",
    undisputed: false,
    ventaIndirecta: false,
    reason: `basket (${matchedSizes.join(", ")}) + ≤5 min, un solo comprador, sin ubicación ni nombre (60%)`,
    signals: { zip: false, city: false, name: false, nickname: false, item: true },
    matchDetails: {
      convoFamilyIds: id.famIds,
      basketSizes: [...id.basketSizes],
      matchedSizes,
      buyerOrdersInWindow: matching.length,
      saleItemIds: (s.items || []).map((it) => it.itemId).filter(Boolean),
      poiFuzzy: false,
      minutesConvoToSale: gapMin,
      gapHoursToSale: Math.round((Math.abs(gapMin) / 60) * 10) / 10,
    },
    sale: {
      orderId: s._id,
      dateCreated: s.dateCreated,
      status: s.status,
      totalAmount: s.totalAmount,
      itemTitle: (s.items && s.items[0] && s.items[0].title) || null,
      buyerNickname: (s.buyer && s.buyer.nickname) || null,
      shippingCity: (s.shipping && s.shipping.city) || null,
      shippingState: (s.shipping && s.shipping.state) || null,
      shippingZip: (s.shipping && s.shipping.zip) || null,
      receiverName: (s.shipping && s.shipping.receiverName) || null,
    },
    method: "convo_sale_orphan",
    matchedAt: new Date(),
  };
}

/**
 * Find the best sale match for one conversation. Returns a ConvoSaleMatch-shaped
 * object or null. Requires a ctx from buildContext().
 */
async function matchConversation(convo, ctx) {
  const MLSale = require("../models/MLSale");
  const id = convoIdentity(convo, ctx);

  // Need SOMETHING to tie a sale to: a location, a name, or a POI (discussed OR clicked).
  const hasPoi = !!(id.poiSizes && id.poiSizes.size);
  if (!id.zip && !id.city && !id.names.length && !hasPoi) return [];

  // GATE 1 (approved criterion): the conversation must have CLICKED a tracked link
  // to even be eligible for a sale. No clicked link → not considered.
  const clickDays = ctx.psidClickDays && ctx.psidClickDays.get(String(convo.psid));
  if (!clickDays || !clickDays.size) return [];

  // GATE 2 (approved criterion): the sale must fall on the SAME Mexico-local DAY as a
  // click. So candidates are bounded to the click days, and each sale's day must be one.
  const clickDayList = [...clickDays].sort();
  const minDay = new Date(clickDayList[0] + "T00:00:00Z");
  const maxDay = new Date(clickDayList[clickDayList.length - 1] + "T00:00:00Z");
  const timeBound = { dateCreated: { $gte: new Date(minDay.getTime()), $lte: new Date(maxDay.getTime() + 36 * 3600e3) } };

  const candidates = [];
  const seen = new Set();
  const add = (arr) => { for (const s of arr) { const k = String(s._id); if (!seen.has(k)) { seen.add(k); candidates.push(s); } } };
  if (id.zip) add(await MLSale.find({ "shipping.zip": id.zip, ...timeBound }).lean());
  if (id.city) {
    const stored = ctx.cityIndex.get(id.city) || [];
    if (stored.length) add(await MLSale.find({ "shipping.city": { $in: stored }, ...timeBound }).lean());
  }
  // NO-LOCATION lookup: the convo gave no zip/city but it clicked a link and has a
  // name or a discussed item — it can still attribute by item/name + time. Pull the
  // sales on the actual CLICK DAYS (bounded); the tight tier windows + directional
  // gate + item/name matching filter them down.
  if (!id.zip && !id.city && (id.names.length || hasPoi)) {
    const cache = ctx.salesDayCache; // shared across the run: each day fetched ONCE
    for (const d of clickDayList) {
      let daySales = cache && cache.get(d);
      if (!daySales) {
        const start = new Date(d + "T06:00:00Z").getTime(); // MX day start (UTC-6) in UTC
        daySales = await MLSale.find({ dateCreated: { $gte: new Date(start), $lt: new Date(start + 24 * 3600e3) } }).lean();
        if (cache) cache.set(d, daySales);
      }
      add(daySales);
    }
  }
  if (!candidates.length) return [];

  const clickTimes = (ctx.psidClickTimes && ctx.psidClickTimes.get(String(convo.psid))) || [];
  const convoFamSet = new Set(id.famIds); // families the convo discussed

  // Which discussed sizes were raised on which Mexico-local DAY (from the customer's
  // messages). Only needed when >1 size was discussed — so a match can separate the
  // size(s) talked about ON the sale's day from ones discussed on other days.
  let dayToSizes = null;
  if (id.basketSizes && id.basketSizes.size >= 2) {
    const Message = require("../models/Message");
    const msgs = await Message.find({ psid: convo.psid, senderType: "user" }).select("text timestamp createdAt").lean().catch(() => []);
    dayToSizes = new Map();
    for (const msg of msgs) {
      const when = msg.timestamp || msg.createdAt;
      if (!when) continue;
      const day = mxDay(when);
      let set = dayToSizes.get(day);
      for (const sz of extractSizes(msg.text)) {
        if (!id.basketSizes.has(sz)) continue;
        if (!set) { set = new Set(); dayToSizes.set(day, set); }
        set.add(sz);
      }
    }
  }

  // HIERARCHICAL rule: return ALL qualifying (order, tier) matches for this convo,
  // sorted best→worst, so the runner can claim them tier-by-tier. A convo whose
  // top-tier order is taken by a stronger convo can then fall back to a lower tier.
  const scored = [];
  for (const s of candidates) {
    const tSale = s.dateCreated ? new Date(s.dateCreated).getTime() : null;
    if (tSale == null) continue;
    // GATE 2 enforced: the sale's local day must be one of the click days.
    if (!clickDays.has(mxDay(s.dateCreated))) continue;

    // HARD CROSS-STATE GUARD: if the convo and the sale are in different states,
    // it's a different customer — never a match, even when the city NAME collides
    // (e.g. Juárez Chihuahua vs Juárez Nuevo León). The zip's state is authoritative.
    const saleState = normState(s.shipping && s.shipping.state);
    if (id.state && saleState && id.state !== saleState) continue;

    // TIME + DIRECTION (approved criterion): a sale can ONLY be caused by a click
    // that PRECEDED it — a click can't cause an earlier purchase. Take the latest
    // same-day click at/before the sale; if the sale predates every same-day click,
    // it is NOT attributable. gapHours is then the (always ≥0) sale−click distance,
    // and each tier enforces its own window on it in classify().
    const sd = mxDay(s.dateCreated);
    let nearestCt = null; // latest same-day click at/before the sale
    for (const ct of clickTimes) { if (mxDay(ct) === sd && ct <= tSale && (nearestCt == null || ct > nearestCt)) nearestCt = ct; }
    if (nearestCt == null) continue; // sale happened before any same-day click → skip
    const gapHours = (tSale - nearestCt) / 3600e3;

    // Same FAMILY: the sale's item (or an ancestor of it) is a family the convo discussed.
    let sameFamily = false;
    for (const it of s.items || []) {
      const fams = it.itemId && ctx.itemToFamilies.get(String(it.itemId));
      if (fams) for (const f of fams) if (convoFamSet.has(f)) { sameFamily = true; break; }
      if (sameFamily) break;
    }

    const receiver = (s.shipping && s.shipping.receiverName) || "";
    const buyerName = [s.buyer && s.buyer.firstName, s.buyer && s.buyer.lastName].filter(Boolean).join(" ");
    const nick = (s.buyer && s.buyer.nickname) || "";

    const m = {
      zipMatch: !!id.zip && normZip(s.shipping && s.shipping.zip) === id.zip,
      cityMatch: !!id.city && normalizeCity(s.shipping && s.shipping.city) === id.city,
      nameMatch: nameMatches(id.names, receiver) || nameMatches(id.names, buyerName),
      nicknameMatch: id.firstName ? nameInNickname(id.firstName, nick) : false,
      itemMatch: itemMatch(s, id),
      sameFamily,
      gapHours,
      minutes: nearestCt == null ? null : Math.round((tSale - nearestCt) / 60000),
    };

    const v = classify(m);
    if (!v) continue;

    const gd = m.gapHours == null ? Infinity : Math.abs(m.gapHours);
    scored.push({ s, m, v, gd });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b.v.pct - a.v.pct || a.gd - b.gd);
  return scored.map(({ s, m, v }) => buildMatchDoc(convo, id, s, m, v, dayToSizes));
}

// Build the persisted ConvoSaleMatch document for one (convo, sale) pairing.
function buildMatchDoc(convo, id, s, m, v, dayToSizes) {
  // Split the discussed sizes into those raised ON the sale's day vs other days.
  const allSizes = [...(id.basketSizes || [])];
  const saleDay = s.dateCreated ? mxDay(s.dateCreated) : null;
  let convoSizesOnDay = allSizes, convoSizesOther = [];
  if (dayToSizes && saleDay) {
    const onDaySet = dayToSizes.get(saleDay) || new Set();
    convoSizesOnDay = allSizes.filter((sz) => onDaySet.has(sz));
    convoSizesOther = allSizes.filter((sz) => !onDaySet.has(sz));
  }
  return {
    _id: `${convo.psid}::${s._id}`,
    psid: convo.psid,
    conversationId: convo._id,
    orderId: s._id,
    certainty: v.pct,
    confidence: v.confidence,
    undisputed: v.undisputed,
    ventaIndirecta: v.ventaIndirecta,
    reason: v.reason,
    signals: { zip: m.zipMatch, city: m.cityMatch, name: m.nameMatch, nickname: m.nicknameMatch, item: m.itemMatch },
    matchDetails: {
      convoName: id.names[0] || null,
      saleReceiverName: (s.shipping && s.shipping.receiverName) || null,
      saleBuyerName: [s.buyer && s.buyer.firstName, s.buyer && s.buyer.lastName].filter(Boolean).join(" ") || null,
      saleNickname: (s.buyer && s.buyer.nickname) || null,
      convoZip: id.zip,
      saleZip: (s.shipping && s.shipping.zip) || null,
      convoCity: id.cityRaw || null,
      saleCity: (s.shipping && s.shipping.city) || null,
      convoFamilyIds: id.famIds,
      convoSizes: allSizes, // all sizes the convo discussed
      convoSizesOnDay, // sizes discussed ON the sale's day (relevant to this attribution)
      convoSizesOther, // sizes discussed on OTHER days (not this day)
      convoProduct: id.poiName || null, // product line the convo was about (e.g. "malla sombra reforzada")
      // WHAT was bought on ML, resolved from the sale title against our catalog (id-independent).
      saleProduct: (resolveSaleProduct((s.items && s.items[0] && s.items[0].title)) || {}).label || null,
      saleItemIds: (s.items || []).map((it) => it.itemId).filter(Boolean),
      poiFuzzy: poiFuzzy(s, id.poiName),
      minutesConvoToSale: m.minutes,
      gapHoursToSale: m.gapHours == null ? null : Math.round(m.gapHours * 10) / 10,
    },
    sale: {
      orderId: s._id,
      dateCreated: s.dateCreated,
      status: s.status,
      totalAmount: s.totalAmount,
      itemTitle: (s.items && s.items[0] && s.items[0].title) || null,
      buyerNickname: (s.buyer && s.buyer.nickname) || null,
      buyerId: (s.buyer && s.buyer.id) || null,
      shippingCity: (s.shipping && s.shipping.city) || null,
      shippingState: (s.shipping && s.shipping.state) || null,
      shippingZip: (s.shipping && s.shipping.zip) || null,
      receiverName: (s.shipping && s.shipping.receiverName) || null,
    },
    method: "convo_sale",
    matchedAt: new Date(),
  };
}

module.exports = { buildContext, matchConversation, convoIdentity, classify, nameMatches, looksLikeName };
