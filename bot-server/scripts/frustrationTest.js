// scripts/frustrationTest.js
//
// `node scripts/frustrationTest.js` — no DB, no LLM, no network.
//
// Every message in the first block is one a real customer sent while the bot answered
// with the same paragraph (psid 28881861821437120). Miss one and the catch-all nudge
// fires again; fire on the wrong one and we escalate a customer who was answering us.

const { frustrationOf, frustrationAnswer } = require("../utils/frustration");

const CASES = [
  // ── the reported conversation, verbatim ───────────────────────────────────
  { msg: "Ya te dije lo que quiero 😀... Tu dijiste la longitud de los rollos", expect: "said_already" },
  { msg: "Aquí me preguntaste y te respondí", expect: "said_already" },
  { msg: "También ya te contesté", expect: "said_already" },
  { msg: "Ya te dije los datos", expect: "said_already" },
  { msg: "Ya para de mmr", expect: "angry" },

  // ── the same thing, other ways ────────────────────────────────────────────
  { msg: "ya te lo dije", expect: "said_already" },
  { msg: "ya te respondí eso", expect: "said_already" },
  { msg: "ya te mandé mi código postal", expect: "said_already" },
  { msg: "eso ya te lo dije", expect: "said_already" },
  { msg: "ya te había dicho que quiero el grueso", expect: "said_already" },
  { msg: "no me estás entendiendo", expect: "angry" },
  { msg: "estoy hablando con un robot?", expect: "angry" },
  { msg: "puras vueltas", expect: "angry" },
  { msg: "que mal servicio", expect: "angry" },
  { msg: "ya basta ya", expect: "angry" },
  { msg: "no lees lo que te escribo", expect: "angry" },

  // ── NOT frustration: these must reach the normal answer ───────────────────
  { msg: "El de 18 metros", expect: false },
  { msg: "Uno o dos", expect: false },
  { msg: "Aquí está el dato", expect: false, why: "he is HANDING US the data, not complaining" },
  { msg: "ya lo vi gracias", expect: false, why: "a sign-off: courtesy owns it" },
  { msg: "ya quedó, gracias", expect: false },
  { msg: "ya te compré uno", expect: false, why: "'already bought' is good news" },
  { msg: "voy a checarlo y te digo", expect: false, why: "a deferral: that gate owns it" },
  { msg: "me dices el precio?", expect: false },
  { msg: "", expect: false },
];

let pass = 0;
let fail = 0;
console.log(`\n════════ FRUSTRATION — ${CASES.length} cases ════════\n`);
for (const c of CASES) {
  const got = frustrationOf(c.msg);
  if (got === c.expect) { pass++; console.log(`✅ ${String(c.expect || "ok").padEnd(13)} ${JSON.stringify(c.msg).slice(0, 52)}`); }
  else { fail++; console.log(`❌ ${JSON.stringify(c.msg)}\n   expected ${c.expect}, got ${got}${c.why ? `\n   why: ${c.why}` : ""}`); }
}

// A message that RESTATES the answer is answered, not escalated — the customer is
// finally giving us what we kept asking for, and losing it would be the same bug twice.
const withData = [
  "ya te dije que quiero el de 18 metros",
  "ya te mandé mi cp, es el 76286",
];
console.log(`\n════════ carriesNewData stands down ════════\n`);
for (const m of withData) {
  const esc = frustrationOf(m, { carriesNewData: true });
  const bare = frustrationOf(m);
  if (esc === false && bare === "said_already") { pass++; console.log(`✅ answered, not escalated: ${JSON.stringify(m).slice(0, 48)}`); }
  else { fail++; console.log(`❌ ${JSON.stringify(m)} → withData=${esc}, bare=${bare}`); }
}
// An insult is escalated even if a number rides along: nothing in it is worth parsing.
const angryWithData = frustrationOf("ya para de mmr, son 18 metros", { carriesNewData: true });
if (angryWithData === "angry") { pass++; console.log("✅ an insult escalates even with data in it"); }
else { fail++; console.log(`❌ insult+data → ${angryWithData}`); }

console.log(`\n════════ frustrationAnswer ════════\n`);
for (const kind of ["said_already", "angry"]) {
  const a = frustrationAnswer(kind);
  const checks = [
    ["apologises", /disculpa|perd[oó]n|tienes raz[oó]n/i.test(a)],
    ["says a person takes over", /persona del equipo/i.test(a)],
    ["asks for NOTHING", !/\?/.test(a)],
    ["never says asesor to the customer", !/\basesor/i.test(a)],
    ["quotes no price and no measure", !/\$|\d/.test(a)],
    ["promises no time", !/minutos?|horas?|enseguida|en seguida|ma[nñ]ana/i.test(a)],
  ];
  for (const [label, good] of checks) {
    if (good) { pass++; console.log(`✅ ${kind}: ${label}`); }
    else { fail++; console.log(`❌ ${kind}: ${label}\n   ${a}`); }
  }
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
