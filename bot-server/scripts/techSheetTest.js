// scripts/techSheetTest.js
//
// `node scripts/techSheetTest.js` — no DB, no LLM, no network.
//
// asksTechSheet decides whether the customer is asking for the ficha técnica (or for a
// figure that only lives on it). Get it wrong in one direction and a technical question
// gets a price list for the second time (psid 28508399788837176, "No respondió lo que se
// preguntó"); wrong in the other and the gate hijacks answers that already work — the
// borde's "grosores" are its two VERSIONS, and the shade % and the garantía are answered
// from knowledge.
//
// The claim half is the catalog bug one document down: the bot has been offering a ficha
// técnica in prose for a year with nothing attached.

const {
  asksTechSheet,
  techSheetReply,
  claimsTechSheet,
  stripTechSheetClaim,
} = require("../utils/techSheet");

const ASKS = [
  // ── the data sheet, asked for by name ─────────────────────────────────────
  { why: "the reported message", msg: "Quiero características de ese ground cover . Grosor", expect: true },
  { why: "bare, as three customers have written it", msg: "Ficha técnica", expect: true },
  { why: "unaccented", msg: "ficha tecnica de su malla", expect: true },
  { why: "plural", msg: "tienen fichas tecnicas?", expect: true },
  { why: "hoja técnica", msg: "me pasas la hoja tecnica", expect: true },
  { why: "datos técnicos", msg: "necesito los datos tecnicos del material", expect: true },
  { why: "especificaciones", msg: "cuales son las especificaciones", expect: true },
  { why: "especificaciones técnicas", msg: "especificaciones tecnicas por favor", expect: true },
  { why: "características alone", msg: "que caracteristicas tiene", expect: true },
  { why: "a real message from 2026-04-26", msg: "Sí, cuál es su resistencia y/o ficha técnica del producto", expect: true },

  // ── a figure that only the sheet carries ──────────────────────────────────
  { why: "grosor", msg: "cual es el grosor?", expect: true },
  { why: "calibre", msg: "que calibre maneja", expect: true },
  { why: "gramaje", msg: "cuanto gramaje tiene", expect: true },
  { why: "micras", msg: "de cuantas micras es", expect: true },
  { why: "densidad de hilos", msg: "densidad de hilos", expect: true },
  { why: "polímero", msg: "que polimero usan", expect: true },
  { why: "HDPE by name", msg: "es hdpe?", expect: true },
  { why: "tipo de tejido", msg: "que tipo de tejido es", expect: true },
  { why: "protección UV", msg: "tiene proteccion uv?", expect: true },
  { why: "material", msg: "de que material esta hecha", expect: true },
  { why: "composición", msg: "cual es la composicion", expect: true },

  // ── NOT the sheet: these must reach the answers that already work ─────────
  { why: "GARANTÍA is a knowledge answer, not a spec sheet", msg: "que garantia tiene?", expect: false },
  { why: "the shade % is owned by the flows and company knowledge", msg: "que porcentaje de sombra tiene", expect: false },
  { why: "a price ask", msg: "cuanto cuesta el rollo de 2x100", expect: false },
  { why: "a measure ask", msg: "que medidas manejan?", expect: false },
  { why: "a bare measure", msg: "4x100", expect: false },
  { why: "colors", msg: "en que colores hay", expect: false },
  { why: "shipping", msg: "cuanto cuesta el envio a oaxaca", expect: false },
  { why: "the ad's own CTA", msg: "¡Hola! Quiero más información", expect: false },
  { why: "a greeting", msg: "buenas tardes", expect: false },
  { why: "empty", msg: "", expect: false },
];

const CLAIMS = [
  { why: "the sentence the bot has been writing for a year", txt: "Con gusto, también te paso la ficha técnica.", claim: true },
  { why: "first person plural variant", txt: "Le comparto ficha técnica del cover.", claim: true },
  { why: "adjunto", txt: "Adjunto la ficha técnica para que la revises.", claim: true },
  { why: "datos técnicos", txt: "Te mando los datos técnicos en un momento.", claim: true },
  { why: "AN OFFER IS NOT A PROMISE — the customer still has to answer", txt: "¿Te comparto la ficha técnica?", claim: false },
  { why: "naming it is not sending it", txt: "La ficha técnica indica 105 gr/m².", claim: false },
  { why: "the catalog is another document", txt: "Te comparto nuestro catálogo 📄", claim: false },
];

let pass = 0;
let fail = 0;
const ok = (label) => { pass++; console.log(`✅ ${label}`); };
const bad = (label, detail) => { fail++; console.log(`❌ ${label}\n   ${detail}`); };

console.log(`\n════════ FICHA TÉCNICA — asksTechSheet (${ASKS.length} cases) ════════\n`);
for (const c of ASKS) {
  const got = asksTechSheet(c.msg);
  if (got === c.expect) ok(`${c.expect ? "ficha" : "otro "} ${JSON.stringify(c.msg).slice(0, 56)}`);
  else bad(JSON.stringify(c.msg), `expected ${c.expect}, got ${got} — why: ${c.why}`);
}

console.log(`\n════════ the claim must be backed (${CLAIMS.length} cases) ════════\n`);
for (const c of CLAIMS) {
  const got = claimsTechSheet(c.txt);
  if (got === c.claim) ok(`${c.claim ? "claim" : "no   "} ${JSON.stringify(c.txt).slice(0, 56)}`);
  else bad(JSON.stringify(c.txt), `expected ${c.claim}, got ${got} — why: ${c.why}`);
}

// The strip keeps everything else the turn delivered — a reply that promises the ficha
// usually answers something real alongside it (the catalog bug, 2026-11-04).
const mixed =
  "El rollo de 2 x 100 m cuesta $2111.20 con IVA incluido. También te paso la ficha técnica. ¿Qué medida necesitas?";
const stripped = stripTechSheetClaim(mixed);
const stripChecks = [
  ["keeps the price", /2111\.20/.test(stripped)],
  ["keeps the question", /¿Qué medida necesitas\?/.test(stripped)],
  ["drops the promise", !/ficha\s+t[eé]cnica/i.test(stripped)],
  ["no dangling conjunction", !/\b(También|Y|E)\s*$/.test(stripped.trim())],
];
console.log(`\n════════ stripTechSheetClaim ════════\n`);
for (const [label, good] of stripChecks) good ? ok(`strip: ${label}`) : bad(`strip: ${label}`, stripped);

// The reply itself must promise nothing we can't back and must quote no figure: the
// numbers live in the PDF, and a retyped spec is a spec we can get wrong.
const reply = techSheetReply("la malla antimaleza (Ground Cover)");
const replyChecks = [
  ["says it is sharing the sheet", claimsTechSheet(reply)],
  ["names the product", /antimaleza/i.test(reply)],
  ["quotes no figure", !/\d/.test(reply)],
  ["quotes no price", !/\$/.test(reply)],
  ["never says asesor to the customer", !/\basesor/i.test(reply)],
  ["keeps the conversation moving", /\?/.test(reply)],
];
console.log(`\n════════ techSheetReply ════════\n`);
for (const [label, good] of replyChecks) good ? ok(`reply: ${label}`) : bad(`reply: ${label}`, reply);

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
