// scripts/wireMeshTest.js
//
// `node scripts/wireMeshTest.js` — no DB, no LLM, no network.
//
// asksWireMesh decides whether the customer is asking for a product we do not make.
// Get it wrong in one direction and a real malla sombra customer is told we don't sell
// what he wants; wrong in the other and he gets a price list for the fourth time while
// an asesora answers it by hand (wa:5213311303031).

const { asksWireMesh, wireMeshAnswer } = require("../utils/wireMesh");

const CASES = [
  // ── WIRE / RIGID: we do not make these ────────────────────────────────────
  { why: "the reported message — no wire word at all, the USE gives it away",
    msg: "La maya donde sercan alas cabras?", expect: true },
  { why: "same thing spelled correctly", msg: "la malla donde cercan a las cabras", expect: true },
  { why: "named outright", msg: "¿venden malla de alambre?", expect: true },
  { why: "ciclónica", msg: "necesito malla ciclonica para mi terreno", expect: true },
  { why: "accented ciclónica still matches", msg: "malla ciclónica", expect: true },
  { why: "electrosoldada", msg: "tienen malla electrosoldada", expect: true },
  { why: "hexagonal", msg: "busco malla hexagonal", expect: true },
  { why: "tela de gallinero", msg: "ocupo malla de gallinero", expect: true },
  { why: "borreguera", msg: "malla borreguera precio", expect: true },
  { why: "alambre de púas", msg: "alambre de puas", expect: true },
  { why: "púas accented", msg: "alambre de púas por rollo", expect: true },
  { why: "rigid, in our own words", msg: "buscan una malla rigida?", expect: true },
  { why: "metálica", msg: "malla metálica galvanizada", expect: true },
  { why: "reja", msg: "quiero una reja para el jardin", expect: true },
  { why: "fencing + livestock, no wire word", msg: "algo para cercar borregos", expect: true },
  { why: "corral + animals", msg: "para un corral de gallinas", expect: true },

  // ── NOT wire: these must reach the normal answer ──────────────────────────
  { why: "CERCAR ALONE IS NOT EVIDENCE — our flexible mesh really can close off an area",
    msg: "¿la malla sombra sirve para cercar mi terreno?", expect: false },
  { why: "delimit without livestock is exactly what the borde separador is for",
    msg: "quiero delimitar mi jardin", expect: false },
  { why: "plain shade cloth", msg: "precio de malla sombra 90%", expect: false },
  { why: "ground cover", msg: "cuanto cuesta el ground cover 2x100", expect: false },
  { why: "borde separador", msg: "el borde de 18 m cuanto es", expect: false },
  { why: "animals with no fencing word — shade FOR the animals is our product",
    msg: "quiero sombra para mis vacas", expect: false },
  { why: "a measure alone", msg: "3x4", expect: false },
  { why: "empty", msg: "", expect: false },
  { why: "a greeting", msg: "¡Hola! Quiero más información", expect: false },
];

let pass = 0;
let fail = 0;
console.log("\n════════ WIRE / RIGID MESH — " + CASES.length + " cases ════════\n");
for (const c of CASES) {
  const got = asksWireMesh(c.msg);
  if (got === c.expect) {
    pass++;
    console.log(`✅ ${c.expect ? "wire " : "ours "} ${JSON.stringify(c.msg).slice(0, 52)}`);
  } else {
    fail++;
    console.log(`❌ ${JSON.stringify(c.msg)}\n   expected ${c.expect}, got ${got}\n   why: ${c.why}`);
  }
}

// The answer itself must promise nothing we can't back: no price, no measure, no
// catalogue link (the global catalogue is currently the distributor price list).
const ans = wireMeshAnswer();
const checks = [
  ["names no price", !/\$|\d+\s*pesos/i.test(ans)],
  ["names no measure", !/\d+\s*[x×]\s*\d+|\d+\s*m\b/i.test(ans)],
  ["promises no catalogue", !/cat[aá]logo|pdf|http/i.test(ans)],
  ["never says asesor to the customer", !/\basesor/i.test(ans)],
  ["says we don't make it", /no manejamos/i.test(ans)],
  ["offers the way out", /barrera|delimitar/i.test(ans)],
];
for (const [label, ok] of checks) {
  if (ok) { pass++; console.log(`✅ answer: ${label}`); }
  else { fail++; console.log(`❌ answer: ${label}\n   ${ans}`); }
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
