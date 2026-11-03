// utils/customSize.js
//
// A CUSTOM SIZE IS A HAND-OFF, AND "CLOSE ENOUGH" IS MEASURED PER SIDE (2026-11-02,
// psid 29059373267045334, reported "debió pasar a un humano y no lo hizo").
//
// Nubia asked for **6.20 x 18 m confeccionada, al 90%, en una sola pieza** and was
// offered "la de 7m x 10m, en $3450" with a buy link — 70 m² against the 112 m² she
// asked for — then, when she insisted ("ya te la dije como 3 veces y la ocupo en una
// sola pieza a medida la q te di"), "la de 5m x 6m". Our catalogue tops out at 7x10,
// so there was nothing to offer: it was a sobre-medida order from the first message.
//
// Two rules, both the user's, both owned here so the gate and the prompt can't drift:
//
//   1. CLOSENESS IS PER LINEAR DIMENSION, NOT BY AREA. "If the person is asking for
//      6.2x18 you offer either 7x15 or 6x20 or whatever is close enough by linear
//      dimensions." Each side of the candidate has to be within TOL of the side the
//      customer asked for; a size that matches on area while missing the length by
//      8 m is not a near miss, it is a different product.
//   2. ANYTHING WE WOULD HAVE TO FABRICATE IS HANDED OFF. "Absolutely anything that
//      is a custom size must be handed off, this is like a basic basic rule" — and
//      explicitly so when the customer asks for those specific measures. Offering the
//      nearest ready size is still right (never dead-end a customer on a size), but
//      it is an ALTERNATIVE, not the answer: a specialist still quotes the piece.
//
// The one carve-out: a FRACTIONAL measure whose ceiled sides ARE a catalogue size
// (4.5x4.5 → 5x5) is not a custom size, it is rounding up to a stock piece — we never
// undersize — so that still sells itself with its link.
//
// Tests: node scripts/customSizeTest.js

// How far off a single side may be and still count as "close enough". 0.25 keeps the
// sizes the client asked us to offer in reach (8x10 → 7x10, 6x12 → 6x10, 10x10 → 8x8)
// and puts 6.2x18 → 7x10 out of it, which is the reported bug.
const TOL = 0.25;

/**
 * Is `dims` close enough to `want` on EVERY side?
 * Both are [small, large] pairs in metres.
 */
function withinLinearTolerance(want, dims, tol = TOL) {
  if (!Array.isArray(want) || !Array.isArray(dims)) return false;
  if (want.length < 2 || dims.length < 2) return false;
  for (let i = 0; i < 2; i++) {
    const w = Number(want[i]);
    const d = Number(dims[i]);
    if (!(w > 0) || !(d > 0)) return false;
    if (d < w * (1 - tol) || d > w * (1 + tol)) return false;
  }
  return true;
}

/**
 * The closest catalogue measure to `want`, judged SIDE BY SIDE, or null when nothing
 * is close enough — null is a real answer here: it means sobre medida.
 *
 * Ranking is the sum of squared log-ratios per side (relative, so a metre off on a
 * 2 m side counts more than a metre off on a 10 m one). Ties go to the LARGER piece:
 * we would rather hand over a little more malla than a little less.
 *
 * @param {number[]} want       [small, large] in metres
 * @param {object[]} measures   from availableMeasuresForFamilies: { dims, size, label, lengthOnly }
 * @param {object} [opts]       { tol }
 */
function closestByLinear(want, measures, opts = {}) {
  const tol = Number.isFinite(opts.tol) ? opts.tol : TOL;
  if (!Array.isArray(want) || want.length < 2) return null;
  const w = [Number(want[0]), Number(want[1])].sort((a, b) => a - b);
  if (!(w[0] > 0) || !(w[1] > 0)) return null;

  // A two-number request is by definition a 2-D product; a length-only one (the borde
  // separador's 13 cm height is a spec, not a width) is a different KIND of product.
  const candidates = (Array.isArray(measures) ? measures : []).filter(
    (m) => m && Array.isArray(m.dims) && m.dims.length >= 2 && !m.lengthOnly
  );

  let best = null;
  let bestDist = Infinity;
  let bestArea = 0;
  for (const m of candidates) {
    const d0 = [Number(m.dims[0]), Number(m.dims[1])].sort((a, b) => a - b);
    if (!withinLinearTolerance(w, d0, tol)) continue;
    const dw = Math.log(d0[0] / w[0]);
    const dl = Math.log(d0[1] / w[1]);
    const dist = dw * dw + dl * dl;
    const area = d0[0] * d0[1];
    if (dist < bestDist || (dist === bestDist && area > bestArea)) {
      bestDist = dist;
      bestArea = area;
      best = m;
    }
  }
  return best;
}

// The customer saying the measure they gave is the measure they need. This is the
// second half of rule 2: even where a catalogue size IS close enough, someone who
// asks for THAT piece gets a person. "a medida" / "una sola pieza" / "exacta" is how
// they say it; "la q te di" is how Nubia said it after three tries.
const EXACT_ASK =
  /\b(?:a\s+(?:la\s+)?medida|sobre\s+medida|sobremedida|medidas?\s+exactas?|exactamente\s+esa|justo\s+esa\s+medida|esa\s+medida\s+(?:exacta|específica|especifica)|una\s+sola\s+pieza|en\s+una\s+(?:sola\s+)?pieza|de\s+una\s+pieza|completa\s+de\s+una\s+pieza|la\s+que\s+te\s+(?:di|pas[eé]|dije)|la\s+q\s+te\s+(?:di|pas[eé]|dije))\b/i;

/**
 * Did the customer ask for the exact measure they named (i.e. a made-to-measure piece)?
 * @param {string} text the message as they wrote it
 */
function asksExactCustomSize(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return EXACT_ASK.test(t);
}

module.exports = { TOL, withinLinearTolerance, closestByLinear, asksExactCustomSize };
