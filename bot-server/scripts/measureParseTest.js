// scripts/measureParseTest.js — deterministic, no DB, no LLM, no network.
//   node scripts/measureParseTest.js
//
// dimsOf() is the ONE place that decides whether a message contains a W×L
// measure. When it returns null the deterministic measure gate never fires and
// the model improvises — which is how "Cuánto cuesta la de cuatro por cien" got
// answered with "¿La quieres en negro o en blanco?" instead of a price
// (reported 2026-10-23, psid 40648382988093683): "cien" was missing from the
// Spanish number map, so 4x100 was invisible to every gate.
//
// The percent cases are not padding. "cuatro por cien" is 4x100 and "cuatro por
// ciento" is 4 PERCENT; the shade spec must never become a roll measure. Any
// future addition to NUMBER_MAP has to keep that line intact.

const { dimsOf, stripMeasures, qtyFromText } = require("../ai/workflow/tools");

const DIMS = [
  // spelled-out measures customers actually send
  ["Cuánto cuesta la de cuatro por cien", [4, 100]],
  ["la de dos por cien", [2, 100]],
  ["cuatro por cien metros", [4, 100]],
  ["dos por cincuenta", [2, 50]],
  ["cuatro por veinticinco", [4, 25]],
  ["seis por cuatro", [4, 6]],
  ["tres por ocho metros", [3, 8]],
  // digits, and mixed
  ["4x100", [4, 100]],
  ["cuatro por 100", [4, 100]],
  ["de 4 por 100", [4, 100]],
  ["quiero una malla de 6x6", [6, 6]],
  // a SHADE percentage is never a measure
  ["cuatro por ciento", null],
  ["al noventa por ciento", null],
  ["cien por ciento", null],
  ["al 90% por favor", null],
  // no measure at all
  ["¿cuánto cuesta?", null],
  ["precio del borde de 18 m", null],
];

// A measure's numbers must never leak out as a piece count.
const QTY = [
  ["Cuánto cuesta la de cuatro por cien", null],
  ["cuatro por cien", null],
  ["al noventa por ciento", null],
  ["quiero 3 piezas de 6x4", 3],
];

let pass = 0;
const fails = [];

for (const [msg, want] of DIMS) {
  const got = dimsOf(msg);
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`dimsOf(${JSON.stringify(msg)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
for (const [msg, want] of QTY) {
  const got = qtyFromText(stripMeasures(msg));
  if (JSON.stringify(got ?? null) === JSON.stringify(want)) pass++;
  else fails.push(`qty(${JSON.stringify(msg)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const total = DIMS.length + QTY.length;
console.log(`\n════════ MEASURE PARSING — ${total} cases ════════\n`);
for (const f of fails) console.log(`❌ ${f}`);
if (fails.length) console.log("");
console.log(`${pass}/${total} pass${fails.length ? `, ${fails.length} FAIL` : ""}\n`);
process.exit(fails.length ? 1 : 0);
