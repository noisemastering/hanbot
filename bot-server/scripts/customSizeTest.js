// scripts/customSizeTest.js
//
// `node scripts/customSizeTest.js` — no DB, no LLM, no network.
//
// Two rules over utils/customSize.js:
//   1. "Close enough" is measured PER SIDE, never by area. Get it wrong and a 6.20 x
//      18 m order is answered with a 7x10 m piece and a buy link (psid
//      29059373267045334) — 70 m² against 112 m².
//   2. Anything we'd have to fabricate goes to a specialist, and asking for the exact
//      measure ("a medida", "una sola pieza", "la q te di") is a hand-off every time.

const { closestByLinear, withinLinearTolerance, asksExactCustomSize, TOL } = require("../utils/customSize");

// The real reforzada catalogue (2026-11-02) — it tops out at 7x10.
const REFORZADA = [
  [2,2],[2,3],[2,4],[3,3],[2,5],[3,4],[2,6],[2,7],[3,5],[4,4],[3,6],[4,5],[2,10],
  [3,7],[4,6],[3,8],[5,5],[4,7],[5,6],[4,8],[5,7],[4,9],[6,6],[4,10],[5,8],[6,7],
  [4,11],[5,9],[6,8],[7,7],[5,10],[6,9],[5,11],[7,8],[6,10],[7,9],[8,8],[7,10],
].map((d) => ({ dims: d, size: `${d[0]}x${d[1]}m` }));
const SIN_REF = [[2,2],[2,3],[2,4],[3,3],[2,5],[3,4],[2,6],[3,5],[4,4],[3,6],[4,5],[4,6],[5,5],[5,6]]
  .map((d) => ({ dims: d, size: `${d[0]}x${d[1]}m` }));

const near = [
  // ── THE REPORTED CASE: nothing in the catalogue is close on BOTH sides ─────
  { why: "6.2x18 m — the longest piece we make is 7x10; a null here IS the answer",
    want: [6.2, 18], cat: REFORZADA, expect: null },
  { why: "same request, ceiled by the gate before it gets here",
    want: [7, 18], cat: REFORZADA, expect: null },
  { why: "sin refuerzo tops out at 5x6 — even further away",
    want: [6.2, 18], cat: SIN_REF, expect: null },
  { why: "a 7x15 would have been a fair offer if we made one",
    want: [6.2, 18], cat: [{ dims: [7, 15] }, { dims: [7, 10] }], expect: [7, 15] },
  { why: "6x20 beats 7x15 on both sides, and ties go to the larger piece",
    want: [6.2, 18], cat: [{ dims: [7, 15] }, { dims: [6, 20] }], expect: [6, 20] },

  // ── Genuinely near misses: these must still be offered (the client's own cases) ──
  { why: "8x10 → 7x10, the case that made the nearest-size rule exist",
    want: [8, 10], cat: REFORZADA, expect: [7, 10] },
  { why: "6x12 → 6x10", want: [6, 12], cat: REFORZADA, expect: [6, 10] },
  { why: "10x10 → 8x8", want: [10, 10], cat: REFORZADA, expect: [8, 8] },
  { why: "4.5x4.5 ceiled to 5x5 is rounding, not a custom size",
    want: [5, 5], cat: REFORZADA, expect: [5, 5] },
  { why: "13x3 — the width is wildly out of range, so nothing is close",
    want: [13, 3], cat: REFORZADA, expect: null },

  // ── Never an area match that misses a side ────────────────────────────────
  { why: "AREA WOULD SAY 5x8 (40 m² vs 40 m²); the sides say no",
    want: [2, 20], cat: [{ dims: [5, 8] }, { dims: [4, 10] }], expect: null },
  { why: "a length-only product (borde: 13 cm height) can never match a W×L",
    want: [4, 6], cat: [{ dims: [13, 6], lengthOnly: true }], expect: null },
  { why: "no candidates at all", want: [4, 6], cat: [], expect: null },
  { why: "a junk measure can't resolve", want: [0, 6], cat: REFORZADA, expect: null },
];

let pass = 0, fail = 0;
console.log(`\n════════ CUSTOM SIZE — tolerance ±${Math.round(TOL * 100)}% per side ════════\n`);
for (const c of near) {
  const got = closestByLinear(c.want, c.cat);
  const gd = got && got.dims ? [Number(got.dims[0]), Number(got.dims[1])] : null;
  const ok = c.expect === null ? gd === null : gd && gd[0] === c.expect[0] && gd[1] === c.expect[1];
  if (ok) { pass++; console.log(`✅ ${c.want.join("x")} → ${gd ? gd.join("x") : "SOBRE MEDIDA (handoff)"}`); }
  else { fail++; console.log(`❌ ${c.want.join("x")} → ${gd ? gd.join("x") : "null"}, expected ${c.expect ? c.expect.join("x") : "null"}\n   why: ${c.why}`); }
}

// The tolerance itself, per side.
const tol = [
  { why: "both sides inside", want: [6, 10], dims: [7, 9], expect: true },
  { why: "length 44% short — the reported bug", want: [7, 18], dims: [7, 10], expect: false },
  { why: "width way over", want: [3, 6], dims: [6, 6], expect: false },
  { why: "exactly at the floor still counts", want: [10, 10], dims: [7.5, 10], expect: true },
  { why: "just past the ceiling does not", want: [4, 4], dims: [4, 5.1], expect: false },
];
for (const c of tol) {
  const got = withinLinearTolerance(c.want, c.dims);
  if (got === c.expect) { pass++; console.log(`✅ tol ${c.want.join("x")} vs ${c.dims.join("x")} → ${got}`); }
  else { fail++; console.log(`❌ tol ${c.want.join("x")} vs ${c.dims.join("x")} → ${got}, expected ${c.expect}\n   why: ${c.why}`); }
}

// Asking for the exact measure is a hand-off, whatever else is in the message.
const asks = [
  { why: "the reported wording", msg: "No pa ya te la dije como 3 veces y la ocupo en una sola pieza a medida la q te di", expect: true },
  { why: "a medida", msg: "la quiero a medida", expect: true },
  { why: "a la medida", msg: "¿la hacen a la medida?", expect: true },
  { why: "sobre medida", msg: "necesito sobre medida 6.2x18", expect: true },
  { why: "medida exacta", msg: "ocupo la medida exacta", expect: true },
  { why: "una sola pieza", msg: "que sea en una sola pieza por favor", expect: true },
  { why: "de una pieza", msg: "la necesito de una pieza", expect: true },
  { why: "the measure she already gave", msg: "si, la que te di", expect: true },
  { why: "a plain measure is NOT an insistence — the nearest size may still be offered",
    msg: "6.20*18 metros", expect: false },
  { why: "a plain price ask", msg: "cuanto cuesta la de 4x6", expect: false },
  { why: "confirming our offer", msg: "si esa me sirve", expect: false },
  { why: "shade %, nothing to do with it", msg: "en 90% sombra", expect: false },
  { why: "empty", msg: "", expect: false },
];
for (const c of asks) {
  const got = asksExactCustomSize(c.msg);
  if (got === c.expect) { pass++; console.log(`✅ ${c.expect ? "exact" : "normal"} ${JSON.stringify(c.msg).slice(0, 56)}`); }
  else { fail++; console.log(`❌ ${JSON.stringify(c.msg)}\n   expected ${c.expect}, got ${got}\n   why: ${c.why}`); }
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
