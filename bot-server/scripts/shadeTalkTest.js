#!/usr/bin/env node
// scripts/shadeTalkTest.js
//
// GROUND COVER HAS NO SHADE PERCENTAGE (reported 2026-10-28 from the sandbox, alta:
// "habla de malla sombra cuando el anuncio es de ground cover"). The bot offered
// "35%, 50%, 70%, 80%, 90%" for a 4 x 100 m antimaleza roll — Raschel's percentages,
// a different product, and a question the customer cannot answer.
//
// The guard runs on ground cover replies only, so these cases are about the two things
// that can go wrong with it: leaving the error in, and eating a correct sentence.
//
// Fast: no DB, no LLM, no network. Run: node scripts/shadeTalkTest.js

const { stripShadeTalk } = require("../utils/shadeTalk");

let pass = 0;
const fails = [];
function ok(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}\n     want: ${JSON.stringify(want)}\n     got:  ${JSON.stringify(got)}`);
}

// 1. The reported reply. The shade sentence goes; the turn keeps a question it CAN ask.
{
  const out = stripShadeTalk(
    "¡Claro! Ese rollo de 4 x 100 m lo manejamos en varios porcentajes de sombra (35%, 50%, 70%, 80%, 90%). ¿Cuál necesitas? 😊"
  );
  ok("the shade offer is gone", /sombra|%/.test(out), false);
  ok("and the turn still asks the right thing", /2 m o 4 m de ancho/.test(out), true);
}

// 2. A PRICE SURVIVES. The guard works sentence by sentence precisely so a reply that
//    quotes correctly and then asks the wrong question keeps its number.
{
  const out = stripShadeTalk(
    "El ground cover de 4 x 100 m está en $4222.40 (IVA incluido). ¿Qué porcentaje de sombra necesitas?"
  );
  ok("the price survives", /\$4222\.40/.test(out), true);
  ok("the shade question does not", /sombra/.test(out), false);
  ok("and a question is put back", /\?/.test(out), true);
}

// 3. A reply with no shade talk is returned untouched — byte for byte, because this
//    runs on every ground cover reply.
{
  const clean = "El rollo de 2 × 100 m está en $2111.20 (IVA incluido), en negro y blanco. ¿Cuál prefieres?";
  ok("untouched when there is nothing to strip", stripShadeTalk(clean), clean);
  const opener = "¡Precios de promoción! 🌱\n• 2 × 100 m: $2111.20 (IVA incluido)\n• 4 × 100 m: $4222.40 (IVA incluido)";
  ok("the campaign opener is untouched", stripShadeTalk(opener), opener);
}

// 4. A SINGLE PERCENTAGE IS NOT SHADE TALK. "90% de los pedidos" and a flow-switched
//    answer about malla sombra both contain one, and eating them would be its own bug.
{
  const one = "La malla sombra de 90% la manejamos aparte, dime si te interesa.";
  ok("one percentage is left alone", stripShadeTalk(one), one);
}

// 5. …but RECITING THE LIST is, however it is punctuated: that list only exists for
//    Raschel.
{
  ok("the list is caught with commas", /sombra|%/.test(stripShadeTalk("Lo tenemos en 35%, 50%, 70%. ¿Cuál quieres?")), false);
  ok("the list is caught with y", /%/.test(stripShadeTalk("Hay de 80% y 90%. ¿Cuál quieres?")), false);
}

// 6. Nothing in, nothing out.
ok("null", stripShadeTalk(null), null);
ok("empty", stripShadeTalk(""), "");
ok("only shade talk leaves the ask", stripShadeTalk("¿Qué porcentaje de sombra necesitas?"),
  "¿Qué medida necesitas: 2 m o 4 m de ancho? 😊");

const total = pass + fails.length;
if (fails.length) {
  console.log(`\n❌ ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  • ${f}\n`);
}
console.log(`${pass}/${total} pass`);
process.exit(fails.length ? 1 : 0);
