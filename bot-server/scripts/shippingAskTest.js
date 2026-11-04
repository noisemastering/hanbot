// scripts/shippingAskTest.js
//
// `node scripts/shippingAskTest.js` — no DB, no LLM, no network.
//
// The three shipping questions, over utils/shippingAsk.js. Both flows' shipping gates
// read their triggers from there; before that they each had their own copy and neither
// knew the word "entrega", so "Y modo de entrega" and "Es entrega a domicilio ??" got
// the borde's §B catch-all nudge twice (wa:5217774678321, 2026-11-04).

const { asksShipCost, asksShipTime, asksShipHow } = require("../utils/shippingAsk");

// [message, cost, time, how]
const CASES = [
  // ── the reported misses ───────────────────────────────────────────────────
  ["Y modo de entrega", false, false, true, "the reported message — no envío word at all"],
  ["Es entrega a domicilio ??", false, false, true, "the second reported message"],
  ["¿Hacen entregas a domicilio?", false, false, true, "the plain form"],
  ["Me lo mandan hasta mi casa?", false, false, true, "to the door"],
  ["¿Cómo es la entrega?", false, false, true, "how, with no cost or time word"],
  ["forma de envio", false, false, true, "forma de envío is the same question"],

  // ── cost ──────────────────────────────────────────────────────────────────
  ["Gastos de Envío", true, false, false, "names the cost by itself (the 3rd try, 2026-10-30)"],
  ["Incluye envío ? Estoy en puerto escondido Oax ?", true, false, false, "the original report"],
  ["¿Cuál es el costo de envío?", true, false, false, "the commonest phrasing"],
  ["cuanto cuesta el flete", true, false, false, "flete alone is the cost"],
  ["el costo de la entrega cuanto es", true, false, false, "cost OF THE DELIVERY, spelled out"],
  ["¿el envío es gratis?", true, false, false, "gratis is a cost question"],
  ["manejan paqueteria?", true, false, false, "carrier question → the money answer"],

  // ── time ──────────────────────────────────────────────────────────────────
  ["¿Cuánto tarda el envío?", true, true, false, "both: it carries cuánto AND tarda, each half gets answered"],
  ["en cuanto tiempo de entrega", false, true, false, "TIME, not cost — 'cuánto' must not make this a price question"],
  ["cuantos dias tarda en llegar", false, true, false, "días"],
  ["¿cuándo me llega el pedido?", false, true, false, "cuándo llega"],
  // Deliberately NOT ours: "en cuánto tiempo" with no shipping noun in the sentence is
  // only a delivery question from CONTEXT (he had just been quoted, and named a city).
  // The noun guard is load-bearing — without it "¿cuánto tiempo de garantía?" would be
  // answered with delivery times — so this one is left to the model, which answered it
  // correctly in the real conversation ("Generalmente llega en 2 días hábiles").
  ["En cuanto tiempo soy de acapulco", false, false, false, "no shipping noun — context only"],
  ["¿cuánto tiempo de garantía tiene?", false, false, false, "GARANTÍA, not shipping — the noun guard earns its keep here"],

  // ── not a shipping question at all ────────────────────────────────────────
  ["quiero 18 m", false, false, false, "a length"],
  ["Me das lista de precios", false, false, false, "the price list"],
  ["La altura del material ??", false, false, false, "the unit question"],
  ["¿es contra entrega?", false, false, false, "CONTRA ENTREGA IS A PAYMENT QUESTION — the payment gate owns it"],
  ["el pago es contra entrega o como", false, false, false, "same, and it must not be read as delivery"],
  ["¡Hola! Quiero más información", false, false, false, "the ad's own CTA"],
  ["", false, false, false, "empty"],
];

let pass = 0, fail = 0;
console.log(`\n════════ SHIPPING ASK — ${CASES.length} cases ════════\n`);
for (const [msg, c, t, h, why] of CASES) {
  const got = [asksShipCost(msg), asksShipTime(msg), asksShipHow(msg)];
  const want = [c, t, h];
  if (got.every((v, i) => v === want[i])) {
    pass++;
    const tags = ["cost", "time", "how"].filter((_, i) => got[i]).join("+") || "none";
    console.log(`✅ ${tags.padEnd(9)} ${JSON.stringify(msg).slice(0, 52)}`);
  } else {
    fail++;
    console.log(`❌ ${JSON.stringify(msg)}\n   want cost/time/how = ${want.join("/")}, got ${got.join("/")}\n   why: ${why}`);
  }
}
console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
