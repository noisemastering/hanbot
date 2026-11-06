// scripts/repeatGuardTest.js
//
// `node scripts/repeatGuardTest.js` — no DB, no LLM, no network.
//
// The user's rule, 2026-11-06: "the bot must not repeat the same answer even if the
// client asks the same question, it must at least make clear that it already mentioned
// it and/or change the wording for the next response, if the client asks the same
// question a third time it should escalate if it's a good prospect or stop replying if
// he's just trolling."
//
// The ladder is counted per ANSWER, not per turn, so the same answer coming back later
// in the conversation still counts — that is the case the old consecutive-only guard
// could not see.

const { answerKey, bumpAnswer, restate, isGoodProspect } = require("../utils/repeatGuard");

let pass = 0;
let fail = 0;
const ok = (l) => { pass++; console.log(`✅ ${l}`); };
const bad = (l, d) => { fail++; console.log(`❌ ${l}\n   ${d}`); };

const NUDGE = "¡Gracias! Ya te pasé los precios de los rollos de 6 m, 9 m, 18 m, 54 m. ¿Cuál te sirve y cuántos necesitas? 😊";

console.log("\n════════ the ladder ════════\n");
{
  const state = {};
  const n1 = bumpAnswer(state, NUDGE);
  const n2 = bumpAnswer(state, NUDGE);
  const n3 = bumpAnswer(state, NUDGE);
  n1 === 1 ? ok("1st time → 1") : bad("1st time", n1);
  n2 === 2 ? ok("2nd time → 2 (restate)") : bad("2nd time", n2);
  n3 === 3 ? ok("3rd time → 3 (escalate or stop)") : bad("3rd time", n3);
}
{
  // NON-CONSECUTIVE: the same answer five turns later is still the same answer.
  const state = {};
  bumpAnswer(state, NUDGE);
  bumpAnswer(state, "El rollo de 18 m está en $709. ¿Cuántos rollos necesitas? 😊");
  bumpAnswer(state, "Son metros LINEALES, no metros cuadrados: el borde mide 13 cm de alto.");
  const again = bumpAnswer(state, NUDGE);
  again === 2 ? ok("the same answer later in the chat counts (non-consecutive)") : bad("non-consecutive", again);
}
{
  // Emojis and punctuation don't make an answer new.
  const state = {};
  bumpAnswer(state, NUDGE);
  const v = bumpAnswer(state, NUDGE.replace(/😊/g, "🙌").replace(/!/g, ""));
  v === 2 ? ok("emoji/punctuation changes are the SAME answer") : bad("emoji variance", v);
  // …but a different price IS a different answer.
  const QUOTE = "El rollo de 18 m está en $709. ¿Cuántos rollos necesitas? 😊";
  bumpAnswer(state, QUOTE);
  const w = bumpAnswer(state, QUOTE.replace("709", "1699"));
  w === 1 ? ok("a different number is a different answer") : bad("number variance", w);
}
{
  const state = {};
  const short = "¡Claro! 😊";
  bumpAnswer(state, short);
  const again = bumpAnswer(state, short);
  answerKey(short) === null && again === 1
    ? ok("a very short reply is not laddered (¡Claro! is not 'the same answer')")
    : bad("short reply", `${answerKey(short)} / ${again}`);
}
{
  // The ledger cannot grow without bound on a long conversation.
  const state = {};
  for (let i = 0; i < 60; i++) bumpAnswer(state, `Una respuesta distinta número ${i} con suficiente texto.`);
  Object.keys(state.answerCounts).length <= 24
    ? ok(`the ledger stays bounded (${Object.keys(state.answerCounts).length} keys)`)
    : bad("ledger unbounded", Object.keys(state.answerCounts).length);
}

console.log("\n════════ restate (2nd time) ════════\n");
{
  const r = restate(NUDGE);
  const checks = [
    ["says we already said it", /como te comentaba/i.test(r)],
    ["is NOT the same bytes", r !== NUDGE],
    ["keeps every length", ["6 m", "9 m", "18 m", "54 m"].every((x) => r.includes(x))],
    ["keeps the question", /¿Cuál te sirve/.test(r)],
    ["drops the now-wrong '¡Gracias!' opener", !/^¡Gracias/.test(r)],
    ["invents no price", !/\$/.test(r)],
  ];
  for (const [l, good] of checks) good ? ok(`restate: ${l}`) : bad(`restate: ${l}`, r);
  const quote = "El rollo de 18 m está en $709. Aquí lo compras: https://agente.hanlob.com.mx/r/93fa47c9";
  const rq = restate(quote);
  rq.includes("$709") && rq.includes("/r/93fa47c9")
    ? ok("restate: never touches the price or the tracked link")
    : bad("restate: price/link", rq);
}

console.log("\n════════ good prospect vs troll (3rd time) ════════\n");
const PROSPECTS = [
  ["the reported customer: quoted, picked a length, link shared", { bordeQuoted: [6, 9, 18, 54], activeProductId: "x", zipAsked: true }, true],
  ["gave a phone", { lead: { phone: "4421234567" } }, true],
  ["gave a CP", { location: { zip: "76286" } }, true],
  ["was quoted a measure", { lastQuotes: [{ w: 4, l: 6 }] }, true],
  ["asked for mayoreo volume", { lead: { wholesaleQty: 20 } }, true],
  ["already bought", { purchased: true }, true],
  ["nothing at all — a troll gets no alert", {}, false],
  ["A NAME IS NOT A PROSPECT (the platform gives us one free)", { lead: { name: "Ernesto Gómez" } }, false],
];
for (const [label, state, expect] of PROSPECTS) {
  const got = isGoodProspect({ state });
  got === expect ? ok(`${expect ? "prospect" : "troll   "} ${label}`) : bad(label, `expected ${expect}, got ${got}`);
}
{
  const got = isGoodProspect({ state: {}, convo: { zipcode: "76286" } });
  got ? ok("prospect the CP of whom is only on the Conversation") : bad("convo zipcode", got);
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
