// ai/workflow/tools.js
//
// Tool registry for the workflow engine. Each tool has an Anthropic tool
// definition (schema the model sees) and an execute() the runtime runs when the
// model calls it. A node only gets the tools listed in its `toolsAllowed`;
// anything else is stripped before the request (never exposed to the model).
//
// In Phase 1 the executors are lightweight: they record the intent on the state
// and return a confirmation string. Wiring them to the existing helpers
// (ML links, handoff trigger, lead capture, location stats) happens hands-on
// later — kept behind this single seam so the engine doesn't change.

// Full ancestry path of a ProductFamily ("Root > ... > Family"), cached. Used to
// describe a flow's realm to the scope classifier: a bare leaf name like
// "Rectangular" isn't recognizable as a product, but "Malla Sombra Raschel >
// 90% > Confeccionada con Refuerzo > Rectangular" is — so the flow becomes
// summonable from cold-start / any other flow.
const _pathCache = new Map();
async function familyFullPath(PF, id) {
  const key = String(id);
  if (_pathCache.has(key)) return _pathCache.get(key);
  const path = [];
  let cur = await PF.findById(key).select("name parentId").lean();
  let guard = 0;
  while (cur && guard++ < 12) {
    if (cur.name) path.unshift(cur.name);
    if (!cur.parentId) break;
    cur = await PF.findById(cur.parentId).select("name parentId").lean();
  }
  const out = path.join(" > ");
  _pathCache.set(key, out);
  return out;
}

// Normalize a measure/product query to comparable dimension tokens.
// Spelled Spanish numbers → digits, applied BEFORE measure parsing so "tres por ocho"
// / "una de tres por 8" parse exactly like "3 por 8" (otherwise a worded side leaks its
// number through as a bogus quantity). Routed through the SINGLE SOURCE OF TRUTH
// converter in ai/utils/spanishNumbers — the workflow engine had rolled its own
// digit-only regex and skipped it, which is why this bug resurfaced here after the
// shared parsers had already solved it. Keep this delegating; never re-implement.
const { convertSpanishNumbers } = require("../utils/spanishNumbers");
const wordsToDigits = (t) => convertSpanishNumbers(String(t || ""));

// "4x3", "4 x 3 m", "4 por 3", "tres por 8", "de 4x3 metros" → ["3","4"] (sorted).
function dimsOf(text) {
  if (!text) return null;
  // Strip metric units, including 'm'/'cm' glued to a digit ("6m" → "6",
  // "13cm" → "13" for the borde separador, whose height is in cm), AND the
  // descriptive words customers put between the numbers and the separator
  // ("13 de largo x 3 de ancho", "13 metros de largo por 3 de ancho") — without
  // this, the number isn't adjacent to the x/por and the match fails.
  // cm goes first so it's stripped before the bare 'm' rules.
  const m = wordsToDigits(String(text).toLowerCase())
    .replace(/(\d),(\d)/g, "$1.$2") // Mexican decimal comma "3,5" → "3.5" (else "3,5 x 3,5" misparses to 3x5)
    .replace(/(\d)\s*(?:cms?\b|cent[ií]metros?\b|m\b|mts?\b|metros?\b)/g, "$1 ")
    .replace(/\bcms?\.?\b|\bcent[ií]metros?\b|\bmts?\.?\b|\bmetros?\b|\bm\b/g, " ")
    .replace(/\b(?:de\s+)?(?:largo|ancho|alto|altura|fondo|lado)\b/g, " ") // "13 de largo x 3 de ancho" → "13 x 3"
    .replace(/\b(?:largo|ancho|alto|altura|fondo)\s+de\b/g, " ")      // "largo de 13 x ancho de 3"
    .replace(/(\d+)\s*(?:y\s*medi[oa]|i\s*medi[oa]|imedi[oa]|y\s*1\/2)\b/g, "$1.5") // "3 imedio"/"3 y medio" → "3.5"
    .match(/(\d+(?:\.\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  // Sort numerically so "6x4" and "4x6" compare equal regardless of order.
  return [m[1], m[2]].map(Number).sort((a, b) => a - b);
}

// Remove every W×L MEASURE from a message so any number that REMAINS is a genuine
// quantity/count — never a dimension. Mirrors dimsOf()'s unit normalization so VERBOSE
// forms ("6 metros por 6m", "13 metros de largo por 3 de ancho") are stripped whole,
// not just the compact "6x6". This is the single fix for the recurring "parsed the
// width as a piece count" bug: quantity extractors must strip measures THIS way (a naive
// `\d+(?:x|por)\d+` misses the unit word between the number and the separator, leaking
// the dimension's first number through as a bogus quantity → false "mayoreo").
function stripMeasures(text) {
  if (!text) return "";
  return wordsToDigits(String(text).toLowerCase())
    .replace(/(\d),(\d)/g, "$1.$2") // Mexican decimal comma
    .replace(/(\d{2,3})\s*(?:%|por\s*ciento|porciento)/g, " ") // shade % ("90%", "90 por ciento") is a SHADE spec, never a quantity — strip it like a measure so its number can't leak in as a bogus piece count
    .replace(/(\d)\s*(?:cms?\b|cent[ií]metros?\b|m\b|mts?\b|metros?\b)/g, "$1 ") // "6m"/"6 metros" → "6 "
    .replace(/\b(?:de\s+)?(?:largo|ancho|alto|altura|fondo|lado)\b/g, " ")
    .replace(/\b(?:largo|ancho|alto|altura|fondo)\s+de\b/g, " ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:\.\d+)?)/g, " "); // drop the W×L pair(s)
}

// THE single quantity extractor. Returns the piece/unit count in a message, or null.
// Every mayoreo/retail-qty decision MUST go through this — do NOT re-roll an inline
// `msg.match(/\d/)`, which is exactly how the "N piezas" false-mayoreo bug kept
// resurfacing (it was patched at one call site while four others matched raw numbers).
// Order of trust: (1) an EXPLICIT unit count ("15 rollos", "3 piezas"); else (2) a
// bare/worded number that SURVIVES stripMeasures — i.e. after both the W×L measure AND
// the shade % ("6 por 3 al 90 por ciento") are removed, so neither can leak in as qty.
const _QTY_WORDS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
function qtyFromText(text) {
  if (!text) return null;
  const explicit = parseRollQuantity(text);
  if (explicit != null) return explicit;
  const stripped = stripMeasures(text); // measures + shade gone; words already → digits
  const bare = stripped.match(/\b(\d{1,3})\b/);
  if (bare) return parseInt(bare[1], 10);
  const word = stripped.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
  return word ? _QTY_WORDS[word[1]] : null;
}

// EXPLICIT order quantity ONLY — for UNPROMPTED mayoreo detection. In the manufactured
// realm a bare number is a DIMENSION or the FIXED 90% shade, never a piece count; so we
// only accept a count that carries an explicit signal: a unit word ("15 rollos", "3
// piezas") or an order verb + number ("quiero 20", "necesito 15"). "6x6 al 90 por
// ciento" → null. This is what stops the whack-a-mole: the gate never grabs a naked
// number, so no dimension/shade phrasing can ever masquerade as a quantity.
function orderedQty(text) {
  const explicit = parseRollQuantity(text); // "N rollos/piezas/unidades"
  if (explicit != null) return explicit;
  const s = stripMeasures(text); // measure + shade removed; words → digits
  const m = s.match(/\b(?:quiero|quisiera|necesito|ocupo|dame|d[aá]me|me\s+das|compro|comprar|llevo|llevar[ií]a?|me\s+gustar[ií]a|quisiéramos)\s+(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

// Explicit WHOLESALE request (intent), independent of any quantity. A human hearing
// this connects the customer to an asesor for a volume quote — it does NOT loop asking
// for a size already given. Negative-context guarded so "al menudeo"/"solo una" don't
// trip it.
function wantsWholesale(text) {
  const s = String(text || "").toLowerCase();
  if (/\bmenudeo\b|al\s+detalle|solo\s+una|nada\s+m[aá]s\s+una|nom[aá]s\s+una/.test(s)) return false;
  return /\b(mayoreo|al\s+por\s+mayor|por\s+volumen|medio\s+mayoreo|revendedor|revender|reventa|distribuidora?)\b/.test(s);
}

// ── TRIANGLE HARD RULE ──────────────────────────────────────────────────────
// A triangular net has THREE sides (attributes side1/side2/side3, no "width").
// BUSINESS RULE (hard as steel): NEVER offer, suggest, quote, or even surface a
// triangular product unless the customer EXPRESSLY asked for a triangle. These
// two helpers are the SINGLE source of truth — every place that selects a product
// runs candidates through isTriangularProduct() and only keeps triangles when
// queryWantsTriangle() is true. This is what stops the 4x4x4 velaria from leaking
// into a rectangular/length quote (it kept slipping through the length-only path
// because its enabledDimensions are side1/side2/side3, i.e. no "width").
function isTriangularProduct(node) {
  if (!node) return false;
  const ed = node.enabledDimensions;
  if (Array.isArray(ed) && ed.length &&
      (ed.includes("side3") || (ed.includes("side1") && ed.includes("side2") && !ed.includes("width")))) return true;
  const s = `${node.size || ""} ${node.name || ""}`;
  if (/triangul|velaria/i.test(s)) return true;
  // three numeric groups joined by x/×/* → "4x4x4", "4 x 4 x 4"
  if (/\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+/.test(s)) return true;
  return false;
}
function queryWantsTriangle(query, wantDims) {
  if (Array.isArray(wantDims) && wantDims.length >= 3) return true; // "3x3x3" parsed to 3 sides
  const s = String(query || "");
  return /triangul|tri[aá]ngulo|velaria/i.test(s) ||
    /\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+/.test(s);
}

// Find a sellable product in the flow's family subtrees that matches the
// customer's requested measure/name. Returns the ProductFamily doc or null.
// Score how strongly a candidate's ANCESTRY matches the words in the query.
// Used only to break a measure-tie between sibling variants (grueso/delgado):
// the variant word lives on a parent node, so a candidate whose ancestry word
// the customer typed wins. Generic words shared by every candidate's path
// (borde, separador, rollo, the length) add equally to all → cancel in the
// argmax, leaving only the distinguishing word to decide. Walks leaf→root.
const _norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
async function _ancestryKeywordScore(leaf, query, stopIds) {
  const PF = require("../../models/ProductFamily");
  const qWords = new Set(_norm(query).split(/[^a-z]+/).filter((w) => w.length >= 4));
  if (!qWords.size) return 0;
  const stop = new Set((stopIds || []).map(String));
  let score = 0;
  let cur = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    for (const w of _norm(cur.name).split(/[^a-z]+/)) if (w.length >= 4 && qWords.has(w)) score++;
    if (stop.has(String(cur._id)) || !cur.parentId) break;
    cur = await PF.findById(cur.parentId).select("_id name parentId").lean().catch(() => null);
  }
  return score;
}

// Shade percentage requested in the query ("90%", "90 %", "90 por ciento").
// Rolls of the SAME width×length exist under every shade family (35/50/70/80/90),
// so the measure alone can't disambiguate — the shade does.
function _shadeOf(s) {
  const m = String(s || "").match(/(\d{2,3})\s*(?:%|por\s*ciento|porciento)/i);
  return m ? m[1] : null;
}
// Does a candidate's ANCESTRY sit under the requested shade family (a node named
// "90%")? The shade node is ABOVE the flow's family node (families are the per-
// shade ".../90%/Rollo" nodes), so we climb the FULL ancestry to root — NOT
// stopping at the flow boundary — bounded by depth.
async function _ancestryHasShade(leaf, shade) {
  const PF = require("../../models/ProductFamily");
  const re = new RegExp(`\\b${shade}\\s*%`);
  let cur = leaf;
  for (let i = 0; i < 10 && cur; i++) {
    if (re.test(String(cur.name || ""))) return true;
    if (!cur.parentId) break;
    cur = await PF.findById(cur.parentId).select("_id name parentId").lean().catch(() => null);
  }
  return false;
}

// The shade % of a product, read from its ancestry (a node named "70%"). Null if
// the product carries no shade (e.g. ground cover, borde).
async function productShade(leaf) {
  const PF = require("../../models/ProductFamily");
  let cur = leaf;
  for (let i = 0; i < 10 && cur; i++) {
    const mm = String(cur.name || "").match(/(\d{2,3})\s*%/);
    if (mm) return mm[1];
    if (!cur.parentId) break;
    cur = await PF.findById(cur.parentId).select("_id name parentId").lean().catch(() => null);
  }
  return null;
}

// The shades (%) actually stocked for a given W×L measure within these families —
// so when a customer asks for a shade we don't carry IN THAT SIZE, we can offer
// the real alternatives instead of silently swapping.
async function availableShadesForMeasure(familyList, wantDims) {
  if (!wantDims) return [];
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id).map((f) => String(f.id));
  const queue = [...ids];
  const shades = new Set();
  let g = 0;
  while (queue.length && g++ < 500) {
    const kids = await PF.find({ parentId: queue.shift() })
      .select("name size sellable active parentId enabledDimensions").lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false && !isTriangularProduct(k)) {
        const d = dimsOf(k.size) || dimsOf(k.name);
        if (d && d[0] === wantDims[0] && d[1] === wantDims[1]) {
          const sh = await productShade(k);
          if (sh) shades.add(sh);
        }
      }
      queue.push(k._id);
    }
  }
  return [...shades].sort((a, b) => Number(a) - Number(b));
}

// Pick the right sibling VARIANT among candidates that all match the requested
// measure (e.g. grueso vs delgado "Rollo de 18 m"). The distinguishing word is
// on a parent node, so score each candidate's ancestry against the query words;
// a distinguishing keyword the customer typed wins. Tie (no variant word) →
// first candidate (the default presentation).
async function _pickVariant(hits, query, stopIds) {
  const scored = [];
  for (const c of hits) scored.push({ c, score: await _ancestryKeywordScore(c, query, stopIds) });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score > (scored[1] ? scored[1].score : 0)) return scored[0].c;
  return hits[0];
}

async function findProductInFamilies(query, familyList, wantDimsArg = null) {
  if (!query) return null;
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id)
    .map((f) => String(f.id));
  if (!ids.length) return null;

  // HARD TRIANGLE RULE: only keep triangular products if the customer EXPRESSLY
  // asked for a triangle. Applied at the SOURCE (candidate pool), so no downstream
  // branch — exact, length-only, or name fallback — can ever surface a triangle
  // for a normal 2-D/length request.
  const wantTri = queryWantsTriangle(query, wantDimsArg);

  // Gather all sellable descendants of the flow families (BFS, bounded).
  const queue = [...ids];
  const candidates = [];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const pid = queue.shift();
    const kids = await PF.find({ parentId: pid })
      .select("name size sellable active stock price mlPrice onlineStoreLinks parentId enabledDimensions")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false && (wantTri || !isTriangularProduct(k))) candidates.push(k);
      queue.push(k._id);
    }
    // also consider the family node itself if it's sellable
  }

  // Wanted dims come from the AI extractor for customer text (passed in); fall
  // back to dimsOf only if not provided. Candidate (catalog) sizes are still
  // parsed with dimsOf — they're clean, controlled "6x4m" strings.
  // Sort ascending to mirror dimsOf's order-insensitivity: the AI extractor passes
  // wantDimsArg in the SPOKEN order ("6x5" → [6,5]), but catalog sizes are compared
  // as [small,large] via dimsOf, so an unsorted [6,5] never matched a "6x5m" leaf.
  const _rawWant = wantDimsArg || dimsOf(query);
  const wantDims = _rawWant ? [..._rawWant].sort((a, b) => a - b) : null;
  // Is this a TRIANGULAR request? (explicit word, or a 3-part measure "3x3x3").
  // dimsOf collapses "3x3x3"→[3,3], so without this a triangle and a rectangle look
  // identical and a "triangular 3x3x3" ask wrongly resolves to the rectangular 3x3.
  const _triCount = (s) => (String(s || "").match(/\d+(?:\.\d+)?/g) || []).length >= 3;
  const qTriangular = /triangul|tri[aá]ngulo/i.test(String(query)) ||
    /\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+/.test(String(query));
  if (wantDims) {
    // Match the measure against the candidate's SIZE field first, then its
    // name. After a tree restructure the sellable leaf can be named for an
    // attribute ("Color Beige") with the measure living only in `size`
    // ("5x10m") — so name-only matching misses every size. Check both.
    let hits = candidates.filter((c) => {
      // A width×length request never matches a length-only product (borde).
      const ed = c.enabledDimensions;
      if (Array.isArray(ed) && ed.length > 0 && !ed.includes("width")) return false;
      // Shape gate: a triangular request matches ONLY triangular products, and a
      // normal W×L request NEVER matches a triangular one. If the flow has no
      // triangular product (triangles are a sibling family), a triangular ask
      // yields no hit → null → escalate to an asesor (never misquote a rectangle).
      const cTri = _triCount(c.size) || _triCount(c.name);
      if (qTriangular !== cTri) return false;
      const cd = dimsOf(c.size) || dimsOf(c.name);
      return cd && cd[0] === wantDims[0] && cd[1] === wantDims[1];
    });
    // Rolls: the SAME width×length exists under every shade family (35/50/70/80/90%);
    // if the query/context names a shade, keep only that shade's leaf so we don't
    // quote a random shade's price.
    if (hits.length > 1) {
      const shade = _shadeOf(query);
      if (shade) {
        const sf = [];
        for (const h of hits) if (await _ancestryHasShade(h, shade)) sf.push(h);
        if (sf.length) hits = sf;
      }
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return _pickVariant(hits, query, ids);
  }

  // LENGTH-ONLY products (borde separador): the customer picks only a length
  // ("18 m"), so dimsOf — which needs W×L — returns null and the block above is
  // skipped. Match a single length against length-only candidates (those whose
  // enabledDimensions has no "width"). Several lengths exist under BOTH "Grueso"
  // and "Delgado" with IDENTICAL leaf names ("Rollo de 18 m"); the VARIANT lives
  // on the PARENT, so disambiguate by the variant word the customer used, same
  // ancestry scoring as 2-D variants. No variant word → first match (default,
  // e.g. grueso).
  const lengthOnly = candidates.filter((c) => {
    const ed = c.enabledDimensions;
    return Array.isArray(ed) && ed.length > 0 && !ed.includes("width");
  });
  if (lengthOnly.length) {
    const qNums = (String(query).match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (qNums.length) {
      const lenOf = (c) => {
        const m = String(c.name || c.size || "").match(/(\d+(?:\.\d+)?)\s*m\b/i);
        return m ? Number(m[1]) : null;
      };
      const lhits = lengthOnly.filter((c) => {
        const L = lenOf(c);
        return L != null && qNums.includes(L);
      });
      if (lhits.length === 1) return lhits[0];
      if (lhits.length > 1) return _pickVariant(lhits, query, ids);
    }
  }
  // Fallback: loose name contains (e.g. a named variant, not a measure).
  const q = query.toLowerCase();
  return candidates.find((c) => (c.name || "").toLowerCase().includes(q)) || null;
}

// When a requested measure isn't in the catalog (e.g. 13x3, out of range),
// find the CLOSEST available measure so the bot can offer a real size and ask
// if the customer still wants the exact one — instead of inventing a size or
// saying "no manejamos decimales". Closeness = squared distance between the
// sorted dimension pairs (so 13x3 → nearest by both width and length).
// Returns the measure object from availableMeasuresForFamilies, or null.
async function closestAvailableMeasure(query, familyList, wantDimsArg = null) {
  const want = wantDimsArg || dimsOf(query);
  if (!want) return null;
  const measures = await availableMeasuresForFamilies(familyList);

  // A two-number (width × length) request — e.g. "4x50" — is by definition a
  // 2-D product (malla rollo / confeccionada). LENGTH-ONLY products (borde
  // separador: you choose only a length; the 13 cm is a fixed height spec, not a
  // width) are a different KIND of product and must never match. The catalog
  // tells us which is which via enabledDimensions (no "width" → length-only),
  // so this is a structural exclusion, not a numeric guess. This is why "4 m"
  // can never match "13 cm".
  const candidates = measures.filter((m) => m.dims && !m.lengthOnly);
  if (!candidates.length) return null; // no 2-D product in scope → don't offer a length-only one

  // Among real 2-D products, pick the closest by RELATIVE distance (squared
  // log-ratio) so scale is respected proportionally: "4x50" lands on "4x100",
  // not on a smaller piece that's near in raw units.
  let best = null;
  let bestDist = Infinity;
  for (const m of candidates) {
    const dw = Math.log(m.dims[0] / want[0]);
    const dl = Math.log(m.dims[1] / want[1]);
    const d = dw * dw + dl * dl;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

// Given a resolved product leaf, return its sibling VARIANTS — the other
// sellable+active products under the same parent that share the same size.
// In a size→color tree, those siblings ARE the available colors for that size.
// Purely structural (no color-word matching): a "variant" = same parent + same
// size. If the leaf has no same-size siblings (e.g. it's a plain size leaf
// directly under a size list), returns just itself → caller sees no choice.
// Returns [{ id, name, label, price, mlPrice, link, sellable, active }].
async function availableVariantsForProduct(productDoc) {
  const PF = require("../../models/ProductFamily");
  if (!productDoc || !productDoc.parentId || !productDoc.size) return [];
  const siblings = await PF.find({ parentId: productDoc.parentId, sellable: true, active: { $ne: false } })
    .select("name size sellable active stock price mlPrice onlineStoreLinks")
    .lean();
  const sizeKey = String(productDoc.size).toLowerCase();
  const variants = siblings.filter((s) => String(s.size || "").toLowerCase() === sizeKey);
  if (variants.length <= 1) return []; // no real variant choice for this size
  return variants.map((v) => ({
    id: String(v._id),
    name: v.name,
    // cosmetic: "Color Beige" → "Beige" for customer-facing display
    label: (v.name || "").replace(/^\s*color\s+/i, "").trim() || v.name,
    price: v.price,
    mlPrice: v.mlPrice,
    link: (v.onlineStoreLinks || []).find((l) => l?.url && /mercadolibre/i.test(l.url))?.url || null,
  }));
}

// Walk DOWN the flow's family tree and return every distinct available measure
// (sellable + active descendants), so the bot can answer "¿qué medidas
// manejas?" with real data. You configure ONLY the family on the flow — this
// discovers all the sizes/lengths under it automatically (no per-product
// selection). Color/variant leaves that share a size collapse to ONE measure.
// Returns measures sorted small→large by area: [{ label, size, price, dims }].
async function availableMeasuresForFamilies(familyList) {
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id)
    .map((f) => String(f.id));
  if (!ids.length) return [];

  const queue = [...ids];
  const leaves = [];
  let guard = 0;
  while (queue.length && guard++ < 800) {
    const pid = queue.shift();
    const kids = await PF.find({ parentId: pid })
      .select("name size sellable active stock price parentId enabledDimensions")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false) leaves.push(k);
      queue.push(k._id);
    }
  }

  // For each sellable leaf, decide what the customer-facing MEASURE is:
  //   - If the leaf's PARENT is a size-group (has its own size, e.g. the
  //     "6m x 4m" node whose children are color leaves) → the measure is the
  //     PARENT (label "6m x 4m"); color variants collapse into it.
  //   - Else the leaf IS the product (e.g. borde's "Rollo de 6 m" sitting
  //     directly under the family) → the measure is the leaf, labelled by its
  //     own NAME (length-focused, not the raw "13x6m" size).
  // Keyed by the measure node's id; keep the cheapest price seen.
  const parentCache = new Map();
  const getParent = async (pid) => {
    const key = String(pid);
    if (parentCache.has(key)) return parentCache.get(key);
    const doc = await PF.findById(pid).select("name size").lean();
    parentCache.set(key, doc);
    return doc;
  };

  // A TRIANGULAR net has three sides ("2 m x 2 m x 2 m"). Per business rule, we
  // do NOT list or suggest triangular nets proactively — only quote them if the
  // customer explicitly asks. Uses the robust isTriangularProduct (which reads
  // enabledDimensions side1/side2/side3), so a triangle whose size string doesn't
  // obviously show 3 numbers is still kept out of the proactive measures list and
  // the "closest measure" suggestions.
  const byMeasure = new Map();
  for (const leaf of leaves) {
    const parent = leaf.parentId ? await getParent(leaf.parentId) : null;
    const node = parent && parent.size ? parent : leaf; // size-group → parent, else leaf
    if (isTriangularProduct(leaf) || isTriangularProduct(node)) continue; // skip triangular (don't suggest unless asked)
    const key = String(node._id);
    const price = numericOrNull(leaf.price);
    // Length-only product (e.g. borde separador: you choose only a length; its
    // height/thickness are fixed specs, NOT a width). The catalog says so via
    // enabledDimensions — no "width" enabled. Such products must never match a
    // width×length request like "4x50".
    const ed = leaf.enabledDimensions;
    const lengthOnly = Array.isArray(ed) && ed.length > 0 && !ed.includes("width");
    const existing = byMeasure.get(key);
    if (!existing) {
      byMeasure.set(key, {
        label: (node.name || node.size || "").trim(),
        size: node.size || null,
        price,
        dims: dimsOf(node.size) || dimsOf(node.name),
        lengthOnly,
      });
    } else {
      if (price != null && (existing.price == null || price < existing.price)) existing.price = price;
      // If any contributing variant has a width, the measure is NOT length-only.
      existing.lengthOnly = existing.lengthOnly && lengthOnly;
    }
  }

  const list = [...byMeasure.values()];
  // Sort small → large by area (dims product); measures without dims go last.
  list.sort((a, b) => {
    const aa = a.dims ? a.dims[0] * a.dims[1] : Infinity;
    const bb = b.dims ? b.dims[0] * b.dims[1] : Infinity;
    return aa - bb;
  });
  return list;
}

function numericOrNull(p) {
  if (p == null) return null;
  const n = typeof p === "number" ? p : parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// AI-based product-scope classifier. Replaces the old stopword + name-regex
// matcher (which misrouted on attribute words). Given the customer's message
// and the catalog of active flows, decides which flow handles the product they
// asked about — or that the message names no product at all.
//
// Returns { verdict, targetFlow, productName }:
//   - "no_product"  → message doesn't name a concrete product (greeting, color,
//                     filler, "qué hago"). Don't switch, don't deny.
//   - "current"     → product belongs to the flow they're already in.
//   - "other_flow"  → belongs to a DIFFERENT active flow (targetFlow = its name).
//   - "needs_human" → Hanlob sells it but no active flow covers it → human.
//   - "not_sold"    → genuinely not our category (toldo, lona, geomembrana…).
// On any error: "no_product" (safest — no false switch, no false denial).
// One classification call. reasoning=false → cheap gpt-4o-mini (fast, ~free).
// reasoning='high'|'low' → gpt-5.4-mini with reasoning_effort (it thinks before
// deciding). Reasoning models reject temperature:0 and split
// max_completion_tokens between thinking and the JSON output, so we drop
// temperature and give a big budget (reasoning can otherwise starve the JSON).
// Returns the parsed {verdict,targetFlow,productName} or null on empty/parse fail.
async function _classifyScopeOnce(client, systemContent, query, reasoning) {
  const reqParams = reasoning
    ? { model: "gpt-5.4-mini", reasoning_effort: reasoning, max_completion_tokens: 4000 }
    : { model: "gpt-4o-mini", temperature: 0, max_tokens: 120 };
  const res = await client.chat.completions.create({
    ...reqParams,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: query },
    ],
  });
  const raw = res.choices?.[0]?.message?.content;
  if (!raw || !raw.trim()) {
    console.warn("⚠️ classifyScope: empty content (reasoning may have starved output)");
    return null;
  }
  const parsed = JSON.parse(raw);
  const valid = ["no_product", "current", "other_flow", "needs_human", "not_sold"];
  return {
    verdict: valid.includes(parsed.verdict) ? parsed.verdict : "no_product",
    targetFlow: parsed.targetFlow || null,
    productName: parsed.productName || null,
  };
}

async function aiClassifyProductScope(query, currentFlowName, flowCatalog, currentIsColdStart = false) {
  const { getClient } = require("./llmClient");
  const flowsDesc = (flowCatalog || [])
    .map(
      (f) =>
        `- "${f.name}"${f.isCurrent ? " (FLUJO ACTUAL)" : ""}${f.isColdStart ? " (TRIAGE / ARRANQUE EN FRÍO)" : ""}: ${
          f.families && f.families.length ? f.families.join(", ") : "(sin familias)"
        }${f.desc ? ` — ${f.desc}` : ""}`
    )
    .join("\n");

  const systemContent = `Eres un clasificador de alcance de producto para Hanlob (fabricante mexicano de malla sombra).

Tu trabajo: decidir a qué FLUJO de venta pertenece el producto que pide el cliente, o si no aplica. NO interpretes colores, saludos ni preguntas tipo "qué hago" como productos.

FLUJOS ACTIVOS Y LO QUE VENDE CADA UNO:
${flowsDesc || "(ninguno)"}

${currentFlowName ? `El cliente está actualmente en el flujo: "${currentFlowName}".` : ""}
${currentIsColdStart ? `\n⚠️ EL FLUJO ACTUAL ES DE TRIAGE (ARRANQUE EN FRÍO). Su único trabajo es enrutar al cliente al flujo especialista correcto. NUNCA devuelvas "current" para este flujo: aunque sus familias abarcan toda la categoría, NO atiende productos directamente. Si un flujo especialista maneja lo que pide el cliente, devuelve SIEMPRE "other_flow" apuntando a ese especialista. Solo usa needs_human / not_sold cuando ningún especialista aplique.` : ""}

REGLAS:
- "no_product": el mensaje NO nombra un producto concreto. Saludos, agradecimientos, un color suelto (beige/negro/verde…), o preguntas como "¿qué hago?", "me interesa", "info" → no_product. Los COLORES son ATRIBUTOS, nunca productos.
- IMPORTANTE — una PREGUNTA o PETICIÓN que SÍ nombra un producto sigue nombrando ese producto: "¿tienen X?", "¿venden X?", "¿manejan X?", "¿hay X?", "busco X", "quiero X", "necesito X", "me das precio de X" → EXTRAE X y clasifícalo normalmente (NUNCA lo marques no_product solo por venir como pregunta). Ej.: "¿venden sujetadores plásticos?" nombra el producto "sujetadores plásticos".
- "current": el producto pertenece al FLUJO ACTUAL (misma categoría que ya está atendiendo). ${currentIsColdStart ? "NO USES ESTE VALOR — el flujo actual es de triage." : ""}
- "other_flow": pertenece claramente a OTRO flujo activo distinto del actual (un especialista). Pon su nombre EXACTO en targetFlow.
- "needs_human": es malla sombra o algo que Hanlob fabrica, pero ningún flujo activo lo cubre.
- MONOFILAMENTO ⇒ needs_human: la malla sombra de MONOFILAMENTO es un producto DISTINTO de la Raschel; los flujos activos venden RASCHEL, no monofilamento. Si el cliente pide EXPLÍCITAMENTE "monofilamento" (aunque dé una medida de rollo como 4.2x100 que también exista en Raschel), devuelve needs_human — la fabricamos pero NO hay flujo activo que la atienda; NUNCA la enrutes (other_flow) al flujo de Rollo/Raschel como si fuera lo mismo.
- GROUND COVER = MALLA ANTIMALEZA (MISMO PRODUCTO): "antimaleza", "malla antimaleza", "malla anti-maleza / anti malezas", "malla para el suelo/piso contra (la) maleza / hierba / pasto", "ground cover" son EXACTAMENTE el mismo producto: la familia GROUND COVER. Enrútalo SIEMPRE al flujo que vende Ground Cover. NUNCA lo confundas con "malla sombra" (para dar sombra) ni con un rollo Raschel — aunque diga "malla ... para el suelo", si menciona maleza/antimaleza es GROUND COVER, no malla sombra.
- "not_sold": algo que Hanlob NO vende (toldo, lona IMPERMEABLE / a prueba de agua / para la lluvia, geomembrana, plástico agrícola, etc.).
- SINÓNIMO "LONA": muchísimos clientes dicen "lona"/"lonas" para referirse a la MALLA SOMBRA. Con contexto de SOMBRA ("al 90%", "de sombra", "% de sombra") o una medida, "lona" ES malla sombra → clasifícala como malla sombra (NUNCA not_sold). SOLO es not_sold la "lona IMPERMEABLE / a prueba de agua / para la lluvia" o el "toldo".

INTERPRETA POR MEDIDAS/PRESENTACIÓN: una medida de DOS dimensiones (ANCHO x LARGO) — "6x8", "3x3", "tres x tres", "4 por 5", "6 de ancho y 8" — es POR SÍ SOLA un producto concreto: malla sombra CONFECCIONADA → enruta (other_flow) al flujo que vende malla sombra confeccionada, AUNQUE el cliente NO escriba la palabra "malla". NUNCA marques una medida de DOS dimensiones como no_product. El borde separador y los rollos se venden por UN SOLO largo lineal; una medida de DOS lados NUNCA es borde separador. Una "malla sombra" en ROLLO o "por metro" → flujo de rollo. Nombrar "malla sombra" + una medida SÍ es nombrar un producto concreto: NUNCA lo marques como no_product.
Responde SOLO JSON: {"verdict":"no_product|current|other_flow|needs_human|not_sold","targetFlow":"<nombre exacto del flujo o null>","productName":"<el producto que pidió o null>"}`;

  // FLOW_SWITCH_REASONING modes:
  //   off  → cheap classifier only (gpt-4o-mini). No reasoning anywhere.
  //   auto → cheap classify first; only if it lands on a CONSEQUENTIAL verdict
  //          (other_flow / needs_human) re-run with reasoning to CONFIRM before
  //          acting. Reasoning fires only on the rare switch decisions, not on
  //          the ~95% of messages that are no_product/current. (Recommended.)
  //   high|low → reasoning on EVERY classification (most expensive).
  const mode = (process.env.FLOW_SWITCH_REASONING || "off").toLowerCase();
  const CONSEQUENTIAL = new Set(["other_flow", "needs_human"]);

  try {
    const client = getClient();

    if (mode === "high" || mode === "low") {
      const r = await _classifyScopeOnce(client, systemContent, query, mode);
      return r || { verdict: "no_product", targetFlow: null, productName: null };
    }

    // Fast pass first (off and auto both start here).
    const cheap = await _classifyScopeOnce(client, systemContent, query, false);
    const base = cheap || { verdict: "no_product", targetFlow: null, productName: null };

    if (mode === "auto" && CONSEQUENTIAL.has(base.verdict)) {
      // The cheap pass thinks a switch/handoff is warranted — confirm with
      // reasoning before acting (this is where false switches were costly).
      console.log(`🧠 [scope] cheap verdict "${base.verdict}" — confirming with reasoning`);
      try {
        const reasoned = await _classifyScopeOnce(client, systemContent, query, "high");
        if (reasoned) return reasoned;
      } catch (e) {
        console.error("⚠️ scope reasoning confirm failed, using cheap verdict:", e.message);
      }
    }
    return base;
  } catch (err) {
    console.error("❌ aiClassifyProductScope error:", err.message);
    return { verdict: "no_product", targetFlow: null, productName: null };
  }
}

const REGISTRY = {
  share_product_link: {
    definition: {
      name: "share_product_link",
      description:
        "Share the tracked purchase link for the product the customer is interested in. Use only when you are ready to send them to buy.",
      input_schema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product or variant name to link" },
        },
        required: ["product"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_product_link", input });
      const { resolvePrice, trackedLink } = require("./priceResolver");
      const requested = (input.product || "").trim();

      // Resolve ONE measure/product → a customer-facing quote line, or null if it
      // can't be found. Sets handoff only for a sellable-but-priceless product.
      const quoteOne = async (q) => {
        let doc = await findProductInFamilies(q, ctx.families);
        if (!doc) {
          // Retry with just the numeric token so "18 mt" / "18 metros" still match
          // a length product named "Rollo de 18 m".
          const nums = String(q).match(/\d+(?:\.\d+)?/g) || [];
          if (nums.length === 1) doc = await findProductInFamilies(nums[0], ctx.families);
        }
        if (!doc) return { ok: false };
        const pInfo = await resolvePrice(doc);
        if (pInfo.soldOut) {
          // Active but out of stock → acknowledge AND hand off (capture the lead).
          ctx.handoffRequested = true;
          ctx.handoffReason = pInfo.handoffReason || `Producto AGOTADO: ${doc.name} — pasar con un asesor`;
          ctx.handoffPreface = ctx.handoffPreface || `Sí manejamos "${doc.name}", pero por el momento está agotada.`;
          return { ok: true, line: `"${doc.name}": SÍ la manejamos, pero está AGOTADA por el momento; el sistema la pasará con un asesor para darle seguimiento. NO compartas link de compra.` };
        }
        if (pInfo.handoff && pInfo.amount == null) {
          ctx.handoffRequested = true;
          ctx.handoffReason = pInfo.handoffReason || `Producto vendible sin precio: ${doc.name} — requiere cotización de un asesor`;
          return { ok: true, line: `"${doc.name}" no tiene precio en línea; para esa medida pasa con un asesor.` };
        }
        if (pInfo.link || pInfo.amount) {
          const link = await trackedLink(pInfo.link, {
            psid: ctx.psid,
            sandbox: ctx.sandbox,
            productName: doc.name,
            productId: String(doc._id),
          });
          const disc =
            pInfo.hasDiscount && Number(pInfo.originalPrice) > Number(pInfo.amount)
              ? ` (CON DESCUENTO, rebajado de $${Math.round(pInfo.originalPrice)})`
              : "";
          const price = pInfo.amount ? ` Precio: $${pInfo.amount}${pInfo.plusIva ? " + IVA" : ""}${disc}${pInfo.source === "ml" ? "" : " (inventario)"}.` : "";
          const linkPart = link ? `Link de compra: ${link}.` : "";
          // Price but NO purchase link → quote it AND hand off to close the sale.
          if (pInfo.quoteThenHandoff || (pInfo.handoff && !link)) {
            ctx.handoffRequested = true;
            ctx.handoffReason = pInfo.handoffReason || `Sin link de compra: ${doc.name} — concretar con un asesor`;
            ctx.handoffPreface = ctx.handoffPreface || `${doc.name} — $${pInfo.amount}${pInfo.plusIva ? " + IVA" : ""}.`;
            return { ok: true, line: `${doc.name} —${price} (sin link de compra en línea; el sistema lo pasará con un asesor para concretar la compra).` };
          }
          return { ok: true, line: `${doc.name} — ${linkPart}${price}`.trim() };
        }
        return { ok: false };
      };

      if (requested) {
        // MULTI-MEASURE: the customer may ask for several in one message ("6 y 18",
        // "6x4 y 8x5"). Split on word/punctuation separators — NOT on the "x"
        // inside a single measure — and quote EACH. Never escalate just because a
        // combined string didn't resolve as one product.
        const segments = requested
          .split(/\s*(?:,|;|\/|\+|\by\b|\bo\b|\band\b|\be\b)\s*/i)
          .map((s) => s.trim())
          .filter(Boolean);
        if (segments.length > 1) {
          const lines = [];
          const missing = [];
          for (const seg of segments) {
            const r = await quoteOne(seg);
            if (r.ok) lines.push(r.line);
            else missing.push(seg);
          }
          if (lines.length) {
            let out = `Comparte estas cotizaciones (una por medida, cada una con SU precio y SU link):\n` + lines.join("\n");
            if (missing.length)
              out += `\n(No encontré: ${missing.join(", ")} — pide solo esa(s) medida(s) exacta(s); NO digas que hubo un problema ni transfieras por esto.)`;
            return out;
          }
          // none resolved → fall through to single handling / clarify
        }

        const one = await quoteOne(requested);
        if (one.ok) return one.line;
        // Truly couldn't resolve. Guide the model to split / clarify — do NOT make
        // it announce a problem or transfer.
        return (
          `[INTERNO] No encontré "${requested}" como una sola medida de este flujo. ` +
          `Si el cliente pidió VARIAS medidas en un mensaje (p. ej. "6 y 18"), cotiza CADA UNA por separado ` +
          `(llama esta herramienta una vez por medida). NO digas que hubo un problema ni transfieras por esto; ` +
          `pide la medida exacta solo si de verdad no la entiendes. NO compartas el link del producto precargado ni inventes precio.`
        );
      }

      // No specific product named → use the preloaded one as a default shortcut.
      const pi = ctx.priceInfo;
      if (!pi) return "Pregunta al cliente qué medida necesita para poder cotizar.";
      const pName = ctx.product?.name;
      if (pi.soldOut) {
        // Active but out of stock → acknowledge AND hand off (capture the lead).
        ctx.handoffRequested = true;
        ctx.handoffReason = pi.handoffReason || `Producto AGOTADO: ${pName || "(producto del flujo)"} — pasar con un asesor`;
        ctx.handoffPreface = ctx.handoffPreface || `${pName ? `"${pName}"` : "Ese producto"} sí lo manejamos, pero por el momento está agotado.`;
        return `${pName ? `"${pName}"` : "Ese producto"} SÍ lo manejamos, pero está AGOTADO por el momento; el sistema lo pasará con un asesor. NO compartas link de compra. NUNCA digas que no lo vendemos.`;
      }
      if (pi.handoff && pi.amount == null) {
        ctx.handoffRequested = true;
        ctx.handoffReason = pi.handoffReason || `Producto vendible sin precio: ${pName || "(producto del flujo)"} — requiere cotización de un asesor`;
        return `${pName ? `"${pName}"` : "Ese producto"} no tiene precio disponible. NO inventes un precio: ofrece pasar con un asesor.`;
      }
      if (pi.link || pi.amount) {
        const link = await trackedLink(pi.link, {
          psid: ctx.psid,
          sandbox: ctx.sandbox,
          productName: pName,
          productId: ctx.product && ctx.product._id ? String(ctx.product._id) : null,
        });
        const disc =
          pi.hasDiscount && Number(pi.originalPrice) > Number(pi.amount)
            ? ` (CON DESCUENTO, rebajado de $${Math.round(pi.originalPrice)})`
            : "";
        const price = pi.amount ? ` Precio: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${disc}${pi.source === "ml" ? "" : " (inventario)"}.` : "";
        const linkPart = link ? `Link de compra: ${link}.` : "";
        // Price but NO purchase link → quote it AND hand off to close the sale.
        if (pi.quoteThenHandoff || (pi.handoff && !link)) {
          ctx.handoffRequested = true;
          ctx.handoffReason = pi.handoffReason || `Sin link de compra: ${pName || "(producto del flujo)"} — concretar con un asesor`;
          ctx.handoffPreface = ctx.handoffPreface || `${pName ? pName + " — " : ""}$${pi.amount}${pi.plusIva ? " + IVA" : ""}.`;
          return `${pName ? pName + " — " : ""}${price} (sin link de compra en línea; el sistema lo pasará con un asesor para concretar la compra).`.trim();
        }
        return `${pName ? pName + " — " : ""}${linkPart}${price}`.trim();
      }
      return ctx.sandbox
        ? "No hay producto resoluble en este test; asigna familia/productos en Setup."
        : "No pude resolver el link de compra. Pide la medida exacta al cliente.";
    },
  },

  share_store_link: {
    definition: {
      name: "share_store_link",
      description: "Share the company's official store link when no product-specific link applies.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_store_link", input });
      // Source the store link from the company's AVAILABLE MARKETPLACES (config),
      // never a hardcoded or per-ad URL. Prefer Mercado Libre, else any active one.
      let storeUrl = null;
      try {
        const { getBusinessInfo } = require("../../businessInfoManager");
        const biz = await getBusinessInfo();
        const mkts = (biz?.marketplaces || []).filter((m) => m && m.url && m.active !== false);
        const ml = mkts.find((m) => /mercado\s*libre|mercadolibre/i.test(m.name || "")) || mkts[0];
        if (ml?.url) storeUrl = ml.url;
      } catch {
        /* ignore — fall through */
      }
      if (!storeUrl) {
        return "[INTERNO] No hay tienda configurada en los marketplaces de la empresa. NO inventes un link; si el cliente quiere comprar, ofrece pasar con un asesor.";
      }
      const { trackedLink } = require("./priceResolver");
      const link = await trackedLink(storeUrl, {
        psid: ctx.psid,
        sandbox: ctx.sandbox,
        productName: "Tienda oficial",
      });
      return link || storeUrl;
    },
  },

  share_catalog: {
    definition: {
      name: "share_catalog",
      description:
        "Send the product catalog to the customer when they ask for it (lista de precios, catálogo, qué medidas/productos manejan). Sends it as a document/file in the chat — you don't need to paste a URL.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_catalog", input });
      const cat = ctx.catalog; // resolved from the tree: family climb → company general
      if (!cat || !cat.url) {
        return "[INTERNO] No hay catálogo disponible para este flujo. Ofrece de forma natural pasar con un asesor o pregunta qué medida busca.";
      }
      // Send the catalog PDF as a document attachment (replicates legacy
      // sendCatalog — arrives as a file bubble, not a link).
      ctx.catalogToSend = { url: cat.url, filename: "Catalogo_Hanlob.pdf" };
      return "[INTERNO] El catálogo en PDF se enviará como documento adjunto. Acompáñalo con una frase breve y natural (ej. 'Te comparto nuestro catálogo 📄'). NO pegues la URL en el texto.";
    },
  },

  request_handoff: {
    definition: {
      name: "request_handoff",
      description: "Hand the conversation to a human specialist. Use for hot leads, complaints, or anything you cannot resolve.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Why a human is needed" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "request_handoff", input });
      ctx.handoffRequested = true;
      ctx.handoffReason = input.reason || ctx.handoffReason || "El cliente necesita atención de un asesor";
      return "Handoff registrado: un asesor continuará la conversación.";
    },
  },

  capture_lead: {
    definition: {
      name: "capture_lead",
      description: "Record the customer's contact details (name, phone, and/or email) when they share them.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "capture_lead", input });
      ctx.lead = { ...(ctx.lead || {}), ...input };
      return "Datos de contacto guardados.";
    },
  },

  ask_location: {
    definition: {
      name: "ask_location",
      description: "Record the customer's city or zip code when they provide it (for shipping).",
      input_schema: {
        type: "object",
        properties: {
          city: { type: "string" },
          zip: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "ask_location", input });
      ctx.location = { ...(ctx.location || {}), ...input };
      return "Ubicación registrada.";
    },
  },

  check_product_scope: {
    definition: {
      name: "check_product_scope",
      description:
        "When the customer asks about a DIFFERENT product or variant (not the one this flow handles), call this with what they asked for. It tells you whether that product is within this flow's scope, handled by another flow, sold but needs a human, or not sold at all. Use the verdict to respond correctly — do NOT guess what we sell.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The product/variant the customer asked for, in their words" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "check_product_scope", input });
      const q = (input.query || "").trim();
      if (!q) return "Sin término de búsqueda.";

      const PF = require("../../models/ProductFamily");
      const WorkflowModel = require("../../models/Workflow");

      // This flow's realm = the UNION of its families' ids (multi-family).
      const flowFamilyIds = new Set(
        (Array.isArray(ctx.families) ? ctx.families : ctx.family ? [ctx.family] : [])
          .filter((f) => f && f.id)
          .map((f) => String(f.id))
      );

      // FAST PATH (dimension-only, no name matching): if the customer named a
      // MEASURE (e.g. "6x4" or "13 de largo x 3 de ancho") that exists as a
      // sellable product in THIS flow's families, it's in-scope. Dims extracted
      // by AI from the customer's text (any phrasing); catalog sizes parsed
      // deterministically inside findProductInFamilies.
      const { extractMeasure } = require("../utils/measureExtractor");
      const scopeDims = await extractMeasure(q).catch(() => null);
      const inFamilyByDims = await findProductInFamilies(
        q,
        Array.isArray(ctx.families) ? ctx.families : ctx.family ? [ctx.family] : [],
        scopeDims
      );
      // A TRIAGE (cold-start) flow must NOT claim a product just because its
      // broad realm contains it — its job is to route to the specialist. Skip
      // the fast path for cold-start so the AI classifier below picks the flow.
      if (inFamilyByDims && !ctx.isColdStart) {
        return `[INTERNO — no menciones nada de esto al cliente] "${inFamilyByDims.name}" sí lo manejas tú aquí. Atiéndelo con normalidad.`;
      }

      // Build the catalog of active flows for the AI classifier. The previous
      // implementation regex-matched the message words against ProductFamily
      // names, which misrouted on attribute words ("color beige" → the rollo
      // "Color Beige" leaf). Now an AI classifier decides which flow (if any)
      // handles the product, with NO keyword/regex matching.
      let workflows = [];
      try {
        workflows = await WorkflowModel.find({ active: true })
          .select("name family families isColdStart description")
          .lean();
      } catch {
        /* ignore */
      }

      const flowCatalog = await Promise.all(
        workflows.map(async (w) => {
          const fams = WorkflowModel.familyListOf(w) || [];
          const names = [];
          for (const f of fams) {
            // Full ancestry path so the classifier recognizes the product (a bare
            // "Rectangular" reads as nothing). Fall back to the stored name.
            const path = f.id ? await familyFullPath(PF, f.id) : "";
            names.push(path || f.name || "");
          }
          const isCurrent = fams.some((f) => flowFamilyIds.has(String(f.id)));
          return { id: String(w._id), name: w.name, families: names, desc: w.description || "", isCurrent, isColdStart: !!w.isColdStart };
        })
      );

      // Is the CURRENT flow the cold-start/triage flow? If so, it must always
      // route OUT to a specialist — never claim "current" — because its broad
      // family realm overlaps every specialist flow.
      const currentIsColdStart = flowCatalog.some((f) => f.isCurrent && f.isColdStart);

      const verdict = await aiClassifyProductScope(q, ctx.currentFlowName || null, flowCatalog, currentIsColdStart);

      // no_product → the message didn't name a concrete product (greeting,
      // color, filler). Don't switch, don't deny — just continue.
      if (verdict.verdict === "no_product") {
        return "[INTERNO — no menciones nada de esto al cliente] El mensaje no nombra un producto distinto; continúa la conversación normalmente sin cambiar de tema ni de flujo.";
      }

      // current → product belongs to this flow.
      // SAFETY: a cold-start/triage flow must never keep a product as "current"
      // — its job is to route out. If the classifier still said "current" here
      // (e.g. its broad realm overlapped a specialist), treat it as needs_human
      // so the customer gets a real asesor instead of a dead-end "no puedo
      // cotizar". Better than parking them on the triage node.
      if (verdict.verdict === "current") {
        if (currentIsColdStart) {
          ctx.handoffRequested = true;
          ctx.handoffReason = `Cliente en flujo de triage pidió "${q}"; no se pudo enrutar a un especialista — requiere asesor`;
          return `[INTERNO — no menciones flujos ni procesos internos] No pudiste enrutar este producto a un flujo especialista. Ofrece de forma natural pasarlo con un asesor que le cotiza (usa request_handoff). NUNCA digas que no puedes dar precios sin ofrecer el asesor.`;
        }
        return `[INTERNO — no menciones nada de esto al cliente] Eso sí lo manejas tú aquí. Atiéndelo con normalidad como parte de esta conversación.`;
      }

      // other_flow → belongs to a different active flow → surface switch target.
      if (verdict.verdict === "other_flow" && verdict.targetFlow) {
        // Exclude only the ACTUAL current flow (by name) — NOT by the family-overlap
        // `isCurrent` flag. A triage/cold-start flow shares families with its
        // specialists (e.g. cold-start carries the Ground Cover family), so a
        // specialist gets wrongly flagged isCurrent and the switch target was being
        // dropped → "ground cover" never routed out of cold-start.
        const other = flowCatalog.find(
          (f) => f.name === verdict.targetFlow && f.name !== (ctx.currentFlowName || "")
        );
        if (other) {
          ctx.scopeResult = {
            verdict: "other_flow",
            product: verdict.productName ? { kind: "product", name: verdict.productName } : null,
            toWorkflowId: other.id,
            toName: other.name,
          };
          return `[INTERNO — NUNCA menciones flujos, especialistas, ni que "se maneja en otro lado"; el cambio debe ser TRANSPARENTE para el cliente] Sí vendemos ${verdict.productName ? `"${verdict.productName}"` : "ese producto"}. Es otro producto de nuestro catálogo, así que confirma de forma natural que es lo que busca y, cuando lo confirme, usa la herramienta switch_flow para continuar atendiéndolo sobre ese producto SIN avisarle de ningún cambio. NO inventes datos de ese producto tú misma.`;
        }
      }

      // needs_human → sold but no active flow handles it → human.
      if (verdict.verdict === "needs_human") {
        ctx.handoffRequested = true;
        ctx.handoffReason = `Cliente pidió "${q}" — sí se vende pero no hay flujo; requiere asesor`;
        return `[INTERNO — no menciones flujos ni procesos internos] Sí lo vendemos, pero para cotizarlo necesitas a un asesor. De forma natural ofrece pasarlo con un asesor (usa request_handoff). NUNCA digas que no lo vendemos.`;
      }

      // not_sold → genuinely not our category.
      return `[INTERNO — no menciones nada de esto al cliente] No vendemos "${q}". Dile de forma amable y natural que no manejamos ese producto, sin tecnicismos.`;
    },
  },

  switch_flow: {
    definition: {
      name: "switch_flow",
      description:
        "Hand the conversation over to another flow that handles a product outside this flow's scope. Call this ONLY after check_product_scope returned an OTRO FLUJO verdict AND the customer confirmed they want that other product. The target flow takes over seamlessly (no greeting), keeping the conversation and any collected data.",
      input_schema: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "true only if the customer confirmed the switch" },
        },
        required: ["confirmed"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "switch_flow", input });
      const sr = ctx.scopeResult;
      if (!sr || sr.verdict !== "other_flow" || !sr.toWorkflowId) {
        return "No hay un flujo destino identificado. Usa primero check_product_scope.";
      }
      if (input.confirmed === false) {
        return "El cliente no confirmó el cambio. Continúa en este flujo.";
      }
      // Signal the orchestrator to hand over after this turn.
      ctx.switchTo = { toWorkflowId: sr.toWorkflowId, toName: sr.toName, product: sr.product };
      return `[INTERNO] Listo, continúa atendiendo al cliente sobre "${sr.product?.name || "ese producto"}" con normalidad. NO le menciones ningún cambio interno.`;
    },
  },

  note: {
    definition: {
      name: "note",
      description: "Attach an internal note about this conversation. NOT shown to the customer.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "note", input });
      ctx.notes.push(input.text);
      return "Nota guardada.";
    },
  },
};

// Anthropic tool definitions for the given allowlist (unknown keys ignored).
function toolDefsFor(allowed = []) {
  return allowed.filter((k) => REGISTRY[k]).map((k) => REGISTRY[k].definition);
}

// Execute a tool the model called. Returns the tool_result content string.
async function runTool(name, input, ctx) {
  const tool = REGISTRY[name];
  if (!tool) return `Herramienta desconocida: ${name}`;
  try {
    return await tool.execute(input || {}, ctx);
  } catch (err) {
    return `Error ejecutando ${name}: ${err.message}`;
  }
}

// Recommend the ACTIVE roll whose total area (width × length) is closest to a
// target area (m²). Used when the customer asks for a non-standard roll measure
// (e.g. 5x20 → 100 m²): we confirm the area, then propose the nearest real roll.
// Tie-break: smallest width (so 100 m² → 2x50, not 4x25). Optional shade filter.
async function nearestRollByArea(targetArea, familyList, opts = {}) {
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id)
    .map((f) => String(f.id));
  if (!ids.length || !(targetArea > 0)) return null;
  const queue = [...ids];
  const cands = [];
  let g = 0;
  while (queue.length && g++ < 500) {
    const kids = await PF.find({ parentId: queue.shift() })
      .select("name size sellable active price mlPrice onlineStoreLinks parentId enabledDimensions")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false) {
        const d = dimsOf(k.size) || dimsOf(k.name);
        const ed = k.enabledDimensions;
        const isWL = !(Array.isArray(ed) && ed.length > 0 && !ed.includes("width"));
        if (d && isWL) cands.push({ leaf: k, dims: d, area: d[0] * d[1] });
      }
      queue.push(k._id);
    }
  }
  if (!cands.length) return null;
  let pool = cands;
  if (opts.shade) {
    const sf = [];
    for (const c of cands) if (await _ancestryHasShade(c.leaf, String(opts.shade))) sf.push(c);
    if (sf.length) pool = sf;
  }
  pool.sort(
    (a, b) => Math.abs(a.area - targetArea) - Math.abs(b.area - targetArea) || a.dims[0] - b.dims[0] || a.area - b.area
  );
  return pool[0]; // { leaf, dims, area }
}

// Parse an explicit ROLL quantity from a message: "3 rollos", "dos piezas",
// "5 unidades". Returns the integer or null. Conservative — requires a unit word
// so a MEASURE ("4x50", "50 metros") is never mistaken for a quantity. A bare
// number is handled by the caller only when it's clearly a quantity reply.
function parseRollQuantity(text) {
  const t = String(text || "").toLowerCase();
  let m = t.match(/(\d+)\s*(rollos?|piezas?|pzas?\.?|unidades?|tramos?)\b/);
  if (m) return parseInt(m[1], 10);
  const words = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  m = t.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(rollos?|piezas?|pzas?\.?|unidades?|tramos?)\b/);
  if (m) return words[m[1]];
  return null;
}

module.exports = { REGISTRY, toolDefsFor, runTool, dimsOf, stripMeasures, findProductInFamilies, availableVariantsForProduct, availableMeasuresForFamilies, closestAvailableMeasure, nearestRollByArea, parseRollQuantity, qtyFromText, orderedQty, wantsWholesale, productShade, availableShadesForMeasure };
