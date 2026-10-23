// scripts/bordeOrderTest.js — deterministic, no DB, no LLM, no network.
//   node scripts/bordeOrderTest.js
//
// Every case below is a real shape that reached production. The five marked REGRESSION
// are the ones that have each been "fixed" once already by patching a single call site
// (see the header of ai/workflow/bordeOrder.js). They live here now so the next one
// fails a test in a second instead of a sale in a week.

const { readBordeMessage } = require("../ai/workflow/bordeOrder");

const CASES = [
  // ── REGRESSIONS: a number that is NOT a piece count ────────────────────────────
  { why: "REGRESSION 5f09ec1 — a W×L side is not a count",
    msg: "quiero una malla de 6x6", expect: { count: null, pairs: [] } },
  { why: "REGRESSION cccfda7 — spelled W×L is not a count",
    msg: "tres por 8 metros", expect: { pairs: [] } },
  { why: "REGRESSION 52e28c4 — a shade % is not a count",
    msg: "al 90% por favor", expect: { count: null } },
  { why: "REGRESSION 64c3126 — a length pivot answering '¿cuántos?' is not a count",
    msg: "el de 18 m", opts: { pendingLength: "54", expectCount: true },
    expect: { count: null, lengths: ["18"], pivotsFrom: true } },
  { why: "REGRESSION 2026-10-23 — 'uno de 6 y uno de 18' is 1+1, never 6 of 18",
    msg: "¿Puede ser entonces uno de 6 y uno de 18?", opts: { pendingLength: "18" },
    expect: { pairs: [{ len: "6", qty: 1 }, { len: "18", qty: 1 }], pivotsFrom: true } },
  { why: "REGRESSION 2026-10-23 — 'las dos versiones' counts OUR options, not rolls (psid 29110445201977950)",
    msg: "en la diferencia de las dos versiones cual es la diferrencia base, el tiempo de durabilidad?",
    opts: { pendingLength: "18" }, expect: { count: null, pairs: [] } },
  { why: "a number bound to any non-roll noun is not a count",
    msg: "cuales son los dos colores?", opts: { pendingLength: "18" }, expect: { count: null } },
  { why: "'5 años de garantía' is not 5 rolls",
    msg: "¿tiene 5 años de garantía?", opts: { pendingLength: "18" }, expect: { count: null } },
  { why: "'las dos medidas' is not 2 rolls",
    msg: "me pasas las dos medidas?", opts: { pendingLength: "18" }, expect: { count: null } },
  { why: "'3 jardines' counts gardens, not rolls",
    msg: "tengo 3 jardines", opts: { pendingLength: "54" }, expect: { count: null } },
  { why: "but 'dos rollos' is still 2 — the noun rule must not eat real counts",
    msg: "quiero dos rollos", opts: { pendingLength: "18" },
    expect: { count: 2, countIsExplicit: true } },
  { why: "'las dos versiones' with a real order beside it keeps the order",
    msg: "de las dos versiones dame 3 rollos de 18", opts: { pendingLength: "18" },
    expect: { pairs: [{ len: "18", qty: 3 }], count: 3 } },

  { why: "REGRESSION 2026-10-23 — '10 cm de ancho' is a size, not 10 rolls",
    msg: "10 cm de ancho , me gusta que sobre , tengo varios jardines",
    opts: { pendingLength: "54" }, expect: { count: null, measurement: true } },

  // ── ORDERS: quantity + presentation in one message ─────────────────────────────
  { why: "3 pieces of 18 m", msg: "Quiero 3 piezas de 18 metros premium",
    expect: { pairs: [{ len: "18", qty: 3 }], count: 3, countIsExplicit: true } },
  { why: "2 rolls of 54 m", msg: "Necesito 2 rollos de 54 metros delgado",
    expect: { pairs: [{ len: "54", qty: 2 }], count: 2 } },
  { why: "no unit word", msg: "2 de 9", expect: { pairs: [{ len: "9", qty: 2 }] } },
  { why: "mixed order, both individual", msg: "necesito 1 de 54 y 2 de 18",
    expect: { pairs: [{ len: "54", qty: 1 }, { len: "18", qty: 2 }] } },
  { why: "same presentation twice adds up", msg: "2 de 18 y otros 3 de 18",
    expect: { pairs: [{ len: "18", qty: 5 }] } },
  { why: "50 rolls", msg: "50 rollos de 18", expect: { pairs: [{ len: "18", qty: 50 }], count: 50 } },

  // ── NOT orders ─────────────────────────────────────────────────────────────────
  { why: "a bare length ask is not an order", msg: "quiero 20 metros",
    expect: { pairs: [], count: null, lengths: [] } },
  { why: "'3 jardines de 18 m' is not 3 rolls", msg: "tengo 3 jardines de 18 metros",
    expect: { pairs: [] } },
  { why: "picking from the menu is a length, not a count", msg: "El de 18",
    expect: { pairs: [], count: null, lengths: ["18"] } },
  { why: "a price ask names a length only", msg: "precio del borde de 18 m",
    expect: { pairs: [], count: null } },
  { why: "'los de 18' is not a count", msg: "me interesan los de 18",
    expect: { pairs: [], count: null } },
  { why: "a C.P. is never a count", msg: "76137", expect: { count: null, zipLike: true } },
  { why: "a phone is never a count", msg: "mi tel es 4421234567",
    expect: { count: null, phoneLike: true } },
  { why: "name + phone + C.P. carries no count", msg: "Juan Pérez 4421234567 76137",
    expect: { count: null } },
  { why: "a pure greeting", msg: "Información", expect: { count: null, pairs: [], lengths: [] } },

  // ── COUNTS the bot must honour ─────────────────────────────────────────────────
  { why: "'uno' answering '¿cuántos?'", msg: "uno", opts: { pendingLength: "18", expectCount: true },
    expect: { count: 1, countIsExplicit: true, pivotsFrom: false } },
  { why: "a bare digit answering '¿cuántos?'", msg: "2", opts: { pendingLength: "18", expectCount: true },
    expect: { count: 2 } },
  { why: "'dos rollos' with no length", msg: "dos rollos", opts: { pendingLength: "18" },
    expect: { count: 2, countIsExplicit: true, pairs: [] } },
  { why: "a downsize", msg: "mejor solo uno", opts: { pendingLength: "18" },
    expect: { count: 1, countIsExplicit: true } },
  { why: "a downsize in digits", msg: "mejor 3", opts: { pendingLength: "54" },
    expect: { count: 3 } },
  { why: "'quiero 2' is explicit even without a unit word", msg: "quiero 2",
    opts: { pendingLength: "18", expectCount: true }, expect: { count: 2, countIsExplicit: true } },
  { why: "'quiero 54' asks for the roll, not 54 rolls", msg: "quiero 54 m",
    expect: { count: null, lengths: ["54"] } },

  // ── numbers vs catalogue lengths (the nearest-length path needs both) ──────────
  { why: "a length we do NOT carry is still a number the nearest-length path needs",
    msg: "Buen día, quiero 20 metros",
    expect: { numbers: ["20"], lengths: [], count: null, pairs: [] } },
  { why: "57 m: one number, no catalogue length",
    msg: "quiero 57 metros de borde", expect: { numbers: ["57"], lengths: [] } },
  { why: "a catalogue length appears in both lists",
    msg: "el de 18 m", expect: { numbers: ["18"], lengths: ["18"] } },
  { why: "a shade % never reaches the numbers list",
    msg: "al 90% por favor", expect: { numbers: [], count: null } },
  { why: "W×L sides never reach the numbers list",
    msg: "una malla de 6x6", expect: { numbers: [], lengths: [] } },

  // ── the pending presentation is unchanged ──────────────────────────────────────
  { why: "restating the same length is not a pivot", msg: "2 rollos de 18 m",
    opts: { pendingLength: "18" }, expect: { pivotsFrom: false, pairs: [{ len: "18", qty: 2 }] } },
  { why: "a different length IS a pivot", msg: "2 rollos de 54 m",
    opts: { pendingLength: "18" }, expect: { pivotsFrom: true } },
];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0;
const fails = [];

for (const c of CASES) {
  const got = readBordeMessage(c.msg, c.opts || {});
  const bad = [];
  for (const [k, want] of Object.entries(c.expect)) {
    if (!eq(got[k], want)) bad.push(`${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want)}`);
  }
  if (bad.length) fails.push({ ...c, bad, got });
  else pass++;
}

console.log(`\n════════ BORDE MESSAGE READER — ${CASES.length} cases ════════\n`);
for (const f of fails) {
  console.log(`❌ ${f.why}`);
  console.log(`   msg: ${JSON.stringify(f.msg)}${f.opts ? `  opts: ${JSON.stringify(f.opts)}` : ""}`);
  for (const b of f.bad) console.log(`   ${b}`);
  console.log("");
}
console.log(`${pass}/${CASES.length} pass${fails.length ? `, ${fails.length} FAIL` : ""}\n`);
process.exit(fails.length ? 1 : 0);
