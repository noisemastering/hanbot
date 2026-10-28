#!/usr/bin/env node
// scripts/advisorWordTest.js
//
// THE CUSTOMER NEVER HEARS "ASESOR" (2026-10-28). The client's rule is written into
// seven of the nine flows' own node prompts — "no te refieras al asesor humano como
// 'asesor' o 'humano', puedes usar 'especialista' o 'supervisor'" — and every gate
// literal in the engine said "un asesor" anyway. The guard translates it at the
// engine's output chokepoint (ai/index.js), so these are the cases that decide whether
// it can break a reply while doing it.
//
// Fast: no DB, no LLM, no network. Run: node scripts/advisorWordTest.js

const { sayEspecialista } = require("../utils/advisorWord");

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}\n     got:  ${got}\n     want: ${want}`); }
}

// 1. The reply that started this: the payment answer said it twice.
eq("the handoff is named a especialista",
  sayEspecialista("El rollo completo de 100 m lo cierra un asesor y el asesor cotiza el envío."),
  "El rollo completo de 100 m lo cierra un especialista y el especialista cotiza el envío.");

// 2. Plural, and the possessive forms the mayoreo lines use.
eq("plural", sayEspecialista("Te paso con uno de nuestros asesores."), "Te paso con uno de nuestros especialistas.");
eq("tu asesor", sayEspecialista("lo calcula tu asesor."), "lo calcula tu especialista.");

// 3. THE PERSONA IS AN ASESORA and that is allowed — she introduces herself that way
//    in every flow's greeting node. Renaming her would rewrite the bot's own identity.
eq("the bot's own persona is untouched",
  sayEspecialista("Soy Karen, asesora de Hanlob."), "Soy Karen, asesora de Hanlob.");

// 4. THE ACCENT TRAP: a trailing \b matches inside "asesoría", because "í" is not a
//    regex word character. The first version of this guard produced "especialistaía".
eq("asesoría survives", sayEspecialista("Con gusto te doy asesoría."), "Con gusto te doy asesoría.");
eq("asesorarte survives", sayEspecialista("para asesorarte mejor"), "para asesorarte mejor");

// 5. Case is preserved — the knowledge entries shout it ("PASA CON UN ASESOR") and the
//    model echoes the shape it was given.
eq("caps", sayEspecialista("PASA CON UN ASESOR"), "PASA CON UN ESPECIALISTA");
eq("capitalised", sayEspecialista("El asesor te confirma."), "El especialista te confirma.");

// 6. "humano" is the other forbidden word, but only where it names the person.
eq("a human handoff", sayEspecialista("No escales a un humano por esto."), "No escales a un especialista por esto.");
eq("ordinary adjectives stay", sayEspecialista("Fue un error humano del trato humano."),
  "Fue un error humano del trato humano.");

// 7. A URL IS NEVER REWRITTEN — a tracked link or a listing slug carrying the string
//    would otherwise be turned into a dead one.
eq("urls are left alone",
  sayEspecialista("Aquí está: https://hanbot.app/r/asesor?u=asesor — te atiende un asesor."),
  "Aquí está: https://hanbot.app/r/asesor?u=asesor — te atiende un especialista.");

// 8. Nothing in, nothing out.
eq("null", sayEspecialista(null), null);
eq("empty", sayEspecialista(""), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
