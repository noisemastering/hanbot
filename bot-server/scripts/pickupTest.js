// scripts/pickupTest.js
//
// `node scripts/pickupTest.js` — no DB, no LLM, no network.
//
// asksPickup decides whether the customer is telling us they will come and get it. Miss
// it and the payment gate answers a location question with Mercado Libre and then asks
// for a length the customer already gave (psid 28881861821437120 — Noemí had to come in
// and send the address). Over-fire it and a cash-on-delivery question gets the plant's
// address instead of the company answer, which is the one thing we must never muddle.

const { asksPickup, pickupAnswer } = require("../utils/pickup");

const CASES = [
  // ── coming to get it ──────────────────────────────────────────────────────
  { why: "the reported message", msg: "Yo lo paso a recoger y a pagar", expect: true },
  { why: "bare", msg: "paso a recoger", expect: true },
  { why: "first person present", msg: "yo lo recojo en la planta", expect: true },
  { why: "with the diminutive object", msg: "puedo ir a recogerlo?", expect: true },
  { why: "paso por él", msg: "mejor paso por el", expect: true },
  { why: "voy por mi pedido", msg: "voy por mi pedido el sabado", expect: true },
  { why: "pasar a la tienda", msg: "puedo pasar a la tienda?", expect: true },
  { why: "a la planta", msg: "se puede pasar a la planta por el material", expect: true },
  { why: "comprar en persona", msg: "quiero comprarlo en persona", expect: true },
  { why: "puedo ir a comprar", msg: "puedo ir a comprar directo?", expect: true },
  { why: "recoger en bodega", msg: "lo puedo recoger en su bodega", expect: true },

  // ── NOT pickup ────────────────────────────────────────────────────────────
  { why: "CASH ON DELIVERY is the other question, and paymentAnswer owns it",
    msg: "es pago contra entrega?", expect: false },
  { why: "pago al recibir is COD too", msg: "puedo pagar al recibir?", expect: false },
  { why: "Mercado Libre's pickup points are not our plant",
    msg: "lo mandan a un punto de entrega?", expect: false },
  { why: "a shipping question", msg: "cuanto cuesta el envio a oaxaca", expect: false },
  { why: "a plain payment question", msg: "como se paga?", expect: false },
  { why: "a price ask", msg: "cuanto cuesta el de 18 m", expect: false },
  { why: "a measure", msg: "18 metros", expect: false },
  { why: "a bare greeting", msg: "buenas tardes", expect: false },
  { why: "empty", msg: "", expect: false },
];

let pass = 0;
let fail = 0;
console.log(`\n════════ PICKUP — ${CASES.length} cases ════════\n`);
for (const c of CASES) {
  const got = asksPickup(c.msg);
  if (got === c.expect) { pass++; console.log(`✅ ${c.expect ? "pickup" : "otro  "} ${JSON.stringify(c.msg).slice(0, 48)}`); }
  else { fail++; console.log(`❌ ${JSON.stringify(c.msg)}\n   expected ${c.expect}, got ${got}\n   why: ${c.why}`); }
}

// The answer must carry the three facts and invent nothing. The address comes from
// CompanyInfo via locationBlock, so the wording must print whatever it is handed and
// never a literal of its own.
const loc = ["Estamos en Colón, Querétaro y hacemos envíos a toda la República. 📦", "📍 QRO 110 7380, El Arroyito", "🌐 https://maps.app.goo.gl/x"];
const ans = pickupAnswer({ locationLines: loc, hours: "Lunes a viernes de 8:00 a 18:00", knowWhatTheyWant: true });
const known = pickupAnswer({ locationLines: loc, knowWhatTheyWant: true });
const unknown = pickupAnswer({ locationLines: loc, knowWhatTheyWant: false });
const checks = [
  ["says yes", /claro que s[ií]/i.test(ans)],
  ["says they can pay there", /pagar\s+ah[ií]/i.test(ans)],
  ["prints the address it was handed", ans.includes("QRO 110 7380, El Arroyito")],
  ["prints the Maps link it was handed", ans.includes("https://maps.app.goo.gl/x")],
  ["prints the hours when given", /8:00 a 18:00/.test(ans)],
  ["no hours line when CompanyInfo has none", !/Horario/.test(known)],
  ["hardcodes NO address of its own", !/Navex|Tlacote|76137/.test(unknown)],
  ["never re-asks the measure once we know it", !/qu[eé] medida/i.test(known)],
  ["does ask for it when we don't", /qu[eé] medida/i.test(unknown)],
  ["never says asesor to the customer", !/\basesor/i.test(ans)],
  ["promises no date and no stock", !/reservad|apartad|ma[nñ]ana|hoy mismo/i.test(ans)],
];
console.log(`\n════════ pickupAnswer ════════\n`);
for (const [label, good] of checks) {
  if (good) { pass++; console.log(`✅ answer: ${label}`); }
  else { fail++; console.log(`❌ answer: ${label}\n   ${ans}`); }
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
