// ai/workflow/bordeOrder.js
//
// ONE place that decides what the numbers in a borde message MEAN.
//
// WHY THIS FILE EXISTS — read before changing anything here.
// The borde flow used to read numbers in SEVEN different places, each with its own
// regex and its own guards, all of them ultimately falling back to the same rule:
// "the first 1-3 digit number in the message is the quantity". That rule is wrong, and
// it produced the SAME CLASS OF BUG five separate times:
//
//   5f09ec1   "6x6"                        → 6 piezas → mayoreo
//   cccfda7   "tres por 8"                 → 8 piezas → mayoreo
//   52e28c4   "al 90%"                     → 90 piezas
//   64c3126   "el de 18 m" (answering "¿cuántos?") → 18 rollos → mayoreo
//   2026-10-23 "uno de 6 y uno de 18"      → 6 rollos de 18 → mayoreo
//   2026-10-23 "las dos versiones"          → 2 rollos de 18
//
// That LAST one got past the rewrite below. The rule "a spelled-out number is
// never a presentation, so it is a count wherever it appears" is false: a
// customer comparing "las dos versiones" is counting our OPTIONS, not ordering
// rolls. A number is only a quantity of rolls when nothing else in the sentence
// claims it — so a number bound to a noun that is not a roll (versiones,
// opciones, medidas, colores, años…) is now stripped before any count is read.
//
// Every one of those was fixed by adding a guard at ONE call site, and the next shape
// slipped past it at a DIFFERENT call site. The lesson: what a number means is a
// property of the MESSAGE, not of the gate that happens to look at it. So the message
// is read ONCE, here, and every gate consumes the same interpretation.
//
// A COUNT is never inferred from a bare digit. It must be earned:
//   - an explicit unit word ("3 rollos", "2 piezas"), or
//   - the "N de L m" order shape ("3 de 18 m", "uno de 6"), or
//   - a spelled-out number ("dos"), which nobody uses to mean a length, or
//   - a bare number ONLY when we just asked "¿cuántos?" AND the message gives no other
//     reading (no catalogue length, no unit, no zip, no phone).
//
// Anything carrying cm/mm is a MEASUREMENT and can never be a count. A number followed
// by a length unit that matches the catalogue is a LENGTH. Five digits are a C.P. and
// ten are a phone — never either.

const BORDE_LENS = ["6", "9", "18", "54"];

const WORD_NUM = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const WORD_NUM_RE = new RegExp(`\\b(${Object.keys(WORD_NUM).join("|")})\\b`, "i");

const COUNT_UNIT = "(?:rollos?|piezas?|pzas?|pz|tramos?|unidades?|paquetes?)";
// Nouns that a number can modify WITHOUT being an order quantity. "las dos
// versiones", "los dos colores", "5 años de garantía", "tres veces" — each of
// these counts something that is not a roll we can sell.
const NON_COUNT_NOUN =
  "(?:versi(?:[oó]n|ones)|opci(?:[oó]n|ones)|alternativas?|medidas?|colores?|color|" +
  "tipos?|presentaci(?:[oó]n|ones)|variantes?|modelos?|grosores?|grosor|calidad(?:es)?|" +
  "anchos?|largos?|v(?:ez|eces)|a[nñ]os?|meses?|semanas?|d[ií]as?|horas?|jardines?|" +
  "metros\\s+cuadrados|m2)";
const LEN_UNIT = "(?:m|mts?|metros?|mtrs?)";
const SMALL_UNIT = "(?:cm|mm|cent[ií]metros?|mil[ií]metros?)";

const numOf = (tok) => (/^\d+$/.test(tok) ? parseInt(tok, 10) : WORD_NUM[String(tok).toLowerCase()] ?? null);

/**
 * Read one customer message in the borde flow.
 *
 * @param {string} raw            the message
 * @param {object} [opts]
 * @param {string} [opts.pendingLength]  the presentation we are mid-conversation about
 *                                       (we asked its version, or asked "¿cuántos?")
 * @param {boolean} [opts.expectCount]   we asked "¿cuántos rollos?" on the previous turn
 * @returns {{
 *   pairs: Array<{len: string, qty: number}>,
 *   lengths: string[],
 *   count: number|null,
 *   countIsExplicit: boolean,
 *   measurement: boolean,
 *   hasWxL: boolean,
 *   zipLike: boolean,
 *   phoneLike: boolean,
 *   pivotsFrom: boolean,
 * }}
 */
function readBordeMessage(raw, opts = {}) {
  const msg = String(raw || "");
  const pendingLength = opts.pendingLength == null ? null : String(opts.pendingLength);
  const expectCount = !!opts.expectCount;

  const out = {
    pairs: [], lengths: [], numbers: [], count: null, countIsExplicit: false,
    measurement: false, hasWxL: false, zipLike: false, phoneLike: false, pivotsFrom: false,
  };

  out.hasWxL = /\d+\s*[x×*]\s*\d+/.test(msg);
  out.zipLike = /\b\d{5}\b/.test(msg);
  out.phoneLike = /\d{10}/.test(msg.replace(/\D/g, ""));
  // A number glued to cm/mm is a size the customer is describing, never an order
  // quantity ("10 cm de ancho, me gusta que sobre" came back as 10 rollos). The rollo
  // flow has the same hole, so the rule lives in tools.js and both read it from there.
  out.measurement = require("./tools").hasUnitBoundNumber(msg);

  // W×L is a different product's shape; drop it before reading anything else, or its
  // sides come back as counts and lengths. A shade percentage goes too: "al 90%" was
  // read as 90 piezas (52e28c4), and the borde has no shade at all.
  const body = msg
    .replace(/\d+\s*[x×*]\s*\d+/g, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:%|por\s*ciento|porciento)/gi, " ");

  // 1) ORDER SHAPES, first and with priority: "3 piezas de 18 metros", "uno de 6",
  //    "2 de 9". The count sits immediately before the presentation, so "tengo 3
  //    jardines de 18 metros" is not an order and "quiero 20 metros" is not either.
  const pairRe = new RegExp(
    `\\b(\\d{1,3}|${Object.keys(WORD_NUM).join("|")})\\s*(?:${COUNT_UNIT}\\s*)?(?:de|del)\\s+(?:los?\\s+)?(\\d{1,3})\\s*(?:${LEN_UNIT}\\b)?`,
    "gi"
  );
  for (const m of body.matchAll(pairRe)) {
    const qty = numOf(m[1]);
    const len = m[2];
    if (!qty || qty < 1 || !BORDE_LENS.includes(len)) continue;
    const prev = out.pairs.find((p) => p.len === len);
    if (prev) prev.qty += qty;
    else out.pairs.push({ len, qty });
  }

  // 2) THE NUMBERS that survived the strip, in order of appearance, and which of them
  //    are catalogue lengths. `lengths` answers "which presentation(s) did they name?";
  //    `numbers` keeps the rest, because the nearest-length path needs the 20 in
  //    "quiero 20 metros" — a length we do NOT carry is still a length they asked for.
  for (const m of body.matchAll(/\b(\d{1,3})\b/g)) {
    if (!out.numbers.includes(m[1])) out.numbers.push(m[1]);
    if (BORDE_LENS.includes(m[1]) && !out.lengths.includes(m[1])) out.lengths.push(m[1]);
  }

  // 3) A COUNT, only when the message earns it.
  //
  // First take away every number that is already spoken for by a noun that is
  // not a roll: "las dos versiones" counts our options, "5 años" counts
  // warranty years. Only what survives can be a quantity. This body is used for
  // COUNT detection alone — pairs, lengths and numbers above still read the
  // whole message, because "2 de 18" and "el de 18 m" are unaffected.
  const countBody = body
    .replace(new RegExp(`\\b(?:\\d{1,3}|${Object.keys(WORD_NUM).join("|")})\\s+(?:${NON_COUNT_NOUN})\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:ambas|ambos)\\s+(?:${NON_COUNT_NOUN})\\b`, "gi"), " ");

  const explicitRe = new RegExp(`\\b(\\d{1,3}|${Object.keys(WORD_NUM).join("|")})\\s*${COUNT_UNIT}`, "i");
  const explicitPre = countBody.match(explicitRe);
  // "quiero 3" / "necesito dos" — an order verb immediately before the number is just
  // as explicit as the unit word, and far more common in chat.
  const verbRe = new RegExp(
    `\\b(?:quiero|necesito|dame|me\\s+das|ocupo|llevo|ll[eé]vame|mandame|m[aá]ndame|pon(?:me)?|ser[ií]an?|son|ser[aá]n)\\s+(?:solo\\s+|s[oó]lo\\s+|nom[aá]s\\s+|mejor\\s+)?(\\d{1,3}|${Object.keys(WORD_NUM).join("|")})\\b(?!\\s*(?:${LEN_UNIT}|${SMALL_UNIT})\\b)`,
    "i"
  );
  const verbPre = countBody.match(verbRe);

  // The borde is sold BY LENGTH ONLY — it has no width × length product. So a message
  // shaped like a W×L measure is not a borde order at all, and nothing in it may be
  // read as a count: "quiero una malla de 6x6" used to yield a count of 1 off "una".
  if (out.hasWxL) return out;

  if (out.pairs.length === 1) {
    // One presentation ordered → its quantity IS the count.
    out.count = out.pairs[0].qty;
    out.countIsExplicit = true;
  } else if (explicitPre) {
    out.count = numOf(explicitPre[1]);
    out.countIsExplicit = true;
  } else if (verbPre) {
    out.count = numOf(verbPre[1]);
    out.countIsExplicit = true;
  } else if (!out.measurement && !out.zipLike && !out.phoneLike) {
    // A spelled-out number is never a presentation ("dos" is not a length), so it is a
    // count wherever it appears. "solo uno", "mejor dos", "nomás 1".
    const w = countBody.match(WORD_NUM_RE);
    const bare = countBody.match(/\b(\d{1,3})\b/);
    const bareIsLength = bare && BORDE_LENS.includes(bare[1]);
    const unitAfterBare = bare && new RegExp(`${bare[1]}\\s*${LEN_UNIT}\\b`, "i").test(countBody);
    if (w) {
      out.count = WORD_NUM[w[1].toLowerCase()];
      out.countIsExplicit = true;
    } else if (bare && !unitAfterBare && (expectCount || !bareIsLength)) {
      // A bare digit is a count only when we asked for one, or when it cannot be one of
      // our presentations. Without this, the menu's own options came back as counts.
      out.count = parseInt(bare[1], 10);
      out.countIsExplicit = false;
    }
  }

  // 4) Does this message RE-SPECIFY the presentation we were mid-conversation about?
  //    Two lengths, or one that isn't the pending one, means they changed the order —
  //    so nothing in it may be read as the pending roll's quantity.
  if (pendingLength) {
    out.pivotsFrom =
      out.lengths.length >= 2 ||
      (out.lengths.length === 1 && out.lengths[0] !== pendingLength) ||
      out.pairs.some((p) => p.len !== pendingLength);
  }

  return out;
}

module.exports = { readBordeMessage, BORDE_LENS, WORD_NUM };
