// scripts/courtesyTest.js
//
// `node scripts/courtesyTest.js` — no DB, no LLM, no network.
//
// "Is there anything in this message besides politeness?" Two places ask it and both
// read utils/courtesy.js: the deferral gate (a sign-off gets an acknowledgement, not
// another sales question) and the pending-handoff resume (a thank-you must not raise an
// alert, but a reply that DOES say something must not be closed down either).
//
// Too WIDE is the expensive direction: "Gracias, ¿me pasas el link?" and "me llamo
// Nubia Cervantes" are real replies, and treating them as sign-offs loses the sale.

const { isThanksOnly, isWordlessReply, isCourtesyOnly } = require("../utils/courtesy");

const CASES = [
  // ── nothing in it ─────────────────────────────────────────────────────────
  ["Ok gracias", true, "the reported sign-off (wa:5217443178473)"],
  ["Muy amable", true, "the second one, two minutes later"],
  ["Gracias por tu atención", true, "psid 9864541876987642 — answered the data ask with this"],
  ["gracias por la informacion", true, "every word is courtesy"],
  ["Mil gracias, muy amables", true, "accents and punctuation are normalised away"],
  ["Grax", true, "the shorthand"],
  ["😏", true, "psid 9842980679120728 — the whole reply"],
  ["👍", true, "a reaction"],
  ["...", true, "punctuation only"],

  // ── something in it: must NOT be read as a sign-off ───────────────────────
  ["Gracias, ¿me pasas el link?", false, "A THANKS PLUS A REQUEST IS A REQUEST"],
  ["gracias y cuanto cuesta el de 18", false, "a thanks plus a question"],
  ["me llamo Nubia Cervantes", false, "ANSWERING OUR ASK — closing this down loses the lead"],
  ["Marcial Mejia López 5561713855 cp 55770", false, "the full data answer"],
  ["72760", false, "a CP is an answer"],
  ["4423521646", false, "a phone is an answer"],
  ["sí", false, "CONFIRMS something we asked — never a sign-off"],
  ["claro", false, "same"],
  ["ok", false, "a bare ok has no thanks in it — it confirms"],
  ["colonia Centro", false, "a colonia is an answer"],
  ["el de 54", false, "a length"],
  ["Esau", false, "a bare name reply to our ask"],
  ["", false, "empty"],
  ["   ", false, "whitespace"],
];

let pass = 0, fail = 0;
console.log(`\n════════ COURTESY-ONLY — ${CASES.length} cases ════════\n`);
for (const [msg, want, why] of CASES) {
  const got = isCourtesyOnly(msg);
  if (got === want) {
    pass++;
    console.log(`✅ ${want ? "nothing " : "content"} ${JSON.stringify(msg).slice(0, 48)}`);
  } else {
    fail++;
    console.log(`❌ ${JSON.stringify(msg)}\n   isCourtesyOnly → ${got}, expected ${want}\n   why: ${why}`);
  }
}

// The two halves, so a future edit can't quietly merge them.
const HALVES = [
  ["Ok gracias", isThanksOnly, true, "a thank-you"],
  ["😏", isThanksOnly, false, "an emoji is not a THANK-YOU, it is wordless"],
  ["😏", isWordlessReply, true, "…and that is what makes it courtesy-only"],
  ["Ok gracias", isWordlessReply, false, "words"],
  ["72760", isWordlessReply, false, "DIGITS ARE CONTENT — a CP must never read as wordless"],
];
for (const [msg, fn, want, why] of HALVES) {
  const got = fn(msg);
  if (got === want) { pass++; console.log(`✅ ${fn.name}(${JSON.stringify(msg)}) = ${got}`); }
  else { fail++; console.log(`❌ ${fn.name}(${JSON.stringify(msg)}) = ${got}, expected ${want}\n   why: ${why}`); }
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
