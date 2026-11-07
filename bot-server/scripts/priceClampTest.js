// scripts/priceClampTest.js
//
// `node scripts/priceClampTest.js` — no DB, no LLM, no network.
//
// A LINE TOTAL IS NOT AN INVENTED PRICE (2026-11-06, psid 25041287378833944, "El precio
// que supo de 2 mallas esta mal"). Alejandro asked three times what 2 pieces of 6x4
// would cost and was told $649 — the UNIT price — each time, until Noemí answered $1298
// by hand. The model had the arithmetic right; the clamp rewrote it, because $1,298
// matched nothing in that turn's allow-set {649, 1356}.
//
// Both directions are load-bearing: arithmetic on a price the engine resolved must pass
// (it is the same price, counted), and a price that matches no product and no multiple
// of one must still be rewritten — that is the hallucinated-price bug the clamp exists
// for (the "7x4 → $3450" report).

const { clampPrices } = require("../ai/workflow/priceResolver");

// The 6x4 beige promo as it resolved on 2026-11-05: unit price + its list price.
const PROMO = [649, 1356];
// A turn that also resolved the 5x5 (a mixed order).
const TWO = [649, 1356, 739];

const CASES = [
  // ── must PASS: arithmetic on resolved prices ──────────────────────────────
  { why: "THE REPORTED SENTENCE — 649 x 2", amounts: PROMO, text: "Cada pieza te queda en $649 y por 2 piezas serían $1,298.", keep: true },
  { why: "the same without the thousands comma", amounts: PROMO, text: "Si compras 2, el total sería $1298.", keep: true },
  { why: "x3", amounts: PROMO, text: "3 piezas serían $1947.", keep: true },
  { why: "x10", amounts: PROMO, text: "10 piezas salen en $6490.", keep: true },
  { why: "the unit price itself", amounts: PROMO, text: "Está en $649.", keep: true },
  { why: "the LIST price it is discounted from", amounts: PROMO, text: "Rebajada de $1356 a $649.", keep: true },
  { why: "a MIXED order: 649 + 739", amounts: TWO, text: "Una de 6x4 y una de 5x5 serían $1388.", keep: true },
  { why: "a mixed order with a multiple: 649x2 + 739", amounts: TWO, text: "Dos de 6x4 y una de 5x5: $2037.", keep: true },
  { why: "ML rounding (804.3 quoted as 804)", amounts: [804.3], text: "Son $804.", keep: true },
  { why: "a borde volume line: 1699 x 10", amounts: [1699], text: "10 rollos de 54 m = $16990.", keep: true },
  { why: "pesos spelled out, as a multiple", amounts: PROMO, text: "Serían 1298 pesos por las dos.", keep: true },

  // ── must STILL be rewritten: not any product, not a multiple ──────────────
  { why: "a hallucinated price (the original bug)", amounts: PROMO, text: "La de 4x6 está en $2000.", keep: false },
  { why: "a neighbour's price the model reached for", amounts: PROMO, text: "Esa medida está en $3450.", keep: false },
  { why: "just below a real multiple — still not ours", amounts: PROMO, text: "Dos piezas serían $1250.", keep: false },
  { why: "pesos spelled out, invented", amounts: PROMO, text: "Son 999 pesos.", keep: false },

  // ── no price resolved → never touch anything ─────────────────────────────
  { why: "nothing resolved: a range reply is left alone", amounts: [], text: "Manejamos desde 2x2 m hasta 7x10 m, precios desde $244.", keep: true },
];

let pass = 0, fail = 0;
console.log(`\n════════ PRICE CLAMP — ${CASES.length} cases ════════\n`);
for (const c of CASES) {
  const r = clampPrices(c.text, c.amounts, c.amounts[0] || null);
  const kept = !r.changed;
  if (kept === c.keep) { pass++; console.log(`✅ ${c.keep ? "kept   " : "rewrote"} ${c.text.slice(0, 54)}`); }
  else { fail++; console.log(`❌ ${c.text}\n   expected ${c.keep ? "KEPT" : "REWRITTEN"}, got "${r.text}"\n   why: ${c.why}`); }
}

// The rewrite must still produce the resolved price, not a number of its own.
{
  const r = clampPrices("La de 4x6 está en $2000.", PROMO, 649);
  /\$649/.test(r.text) && !/2000/.test(r.text)
    ? (pass++, console.log("✅ a rewritten price becomes the RESOLVED one"))
    : (fail++, console.log(`❌ rewrite target: ${r.text}`));
}
// And it must never invent a total of its own: with nothing resolved it does nothing.
{
  const r = clampPrices("Dos piezas serían $1298.", [], null);
  !r.changed ? (pass++, console.log("✅ empty allow-set is a no-op")) : (fail++, console.log(`❌ ${r.text}`));
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
