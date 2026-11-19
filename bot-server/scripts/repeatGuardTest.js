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

console.log("\n════════ the customer's own repeats (2026-11-18) ════════\n");
{
  const { messageKey, isRoutineMessage, bumpMessage, repeatedMessageAction } = require("../utils/repeatGuard");
  const H = 60 * 60 * 1000;
  const BYE = { asks: [], signals: ["cortesia"] };
  const PRICE = { asks: ["precio"], signals: [] };
  const eq = (l, got, want) => (got === want ? ok(l) : bad(l, `expected ${want}, got ${got}`));

  // Pepa: "Bay" over and over, whatever we answered.
  {
    const st = {};
    const t0 = Date.parse("2026-11-14T03:51:00Z");
    eq("Bay 1st → 1", bumpMessage(st, "Bay", BYE, t0), 1);
    eq("Bay 2nd (12 h later) → 2", bumpMessage(st, "Bay", BYE, t0 + 12 * H), 2);
    eq("Bay 3rd → 3", bumpMessage(st, "bay.", BYE, t0 + 14 * H), 3);
    eq("Bay four days later still counts (asks nothing ⇒ a week)", bumpMessage(st, "Bay", BYE, t0 + 110 * H), 4);
    eq("a different message is not a repeat", bumpMessage(st, "Estoy henferma me atropellaron", { asks: [], signals: [] }, t0 + 111 * H), 1);
    eq("Bay after 8 quiet days starts over", bumpMessage(st, "Bay", BYE, t0 + 110 * H + 8 * 24 * H), 1);
  }
  // A question is remembered for a day only.
  {
    const st = {};
    eq("precio 1st", bumpMessage(st, "precio", PRICE, 0), 1);
    eq("precio 2nd same day", bumpMessage(st, "Precio", PRICE, 2 * H), 2);
    eq("precio two days later starts over", bumpMessage(st, "precio", PRICE, 50 * H), 1);
  }
  // What is never counted: data, or no words.
  eq("a message with a digit carries data", messageKey("el de 18 m"), null);
  eq("a bare CP", messageKey("76286"), null);
  eq("an emoji alone", messageKey("👍"), null);
  // The count is by TEXT: a reading that changes between turns must not skip one.
  {
    const st = {};
    bumpMessage(st, "Bay", { asks: [], signals: ["saludo"] }, 0);
    bumpMessage(st, "Bay", BYE, H);
    eq("Bay read as a greeting once still counts", bumpMessage(st, "Bay", BYE, 2 * H), 3);
  }
  // What may repeat freely.
  const routine = (l, text, reading, want) => eq(l, isRoutineMessage(text, reading), want);
  routine("'sí' answers whatever we asked", "sí", { asks: [], signals: ["afirma"] }, true);
  routine("'no' too", "nel pastel", { asks: [], signals: ["niega"] }, true);
  routine("a greeting opens every visit", "Qué onda", { asks: [], signals: ["saludo"] }, true);
  routine("the ad's own opener", "¡Hola! Quiero más información", { asks: [], signals: ["saludo", "info_general"] }, true);
  routine("'ok gracias' confirms", "ok gracias", { asks: [], signals: ["afirma", "cortesia"] }, true);
  routine("'no gracias' is a closing, so it is not routine", "no gracias", { asks: [], signals: ["niega", "cortesia"] }, false);
  routine("'Bay' is not routine", "Bay", BYE, false);
  routine("no reading: 'ok' is routine", "Ok", null, true);
  routine("no reading: the ad opener is routine", "Hola, quiero más información", null, true);
  routine("no reading: 'Bay' is not", "Bay", null, false);
  routine("'sí' misread once is still routine (closed vocabulary)", "sí", { asks: [], signals: [] }, true);

  // What the 3rd arrival gets.
  eq("2nd time → send", repeatedMessageAction({ times: 2, reading: BYE, good: true }), "send");
  eq("3rd goodbye, nothing to rescue → silence", repeatedMessageAction({ times: 3, reading: BYE, good: false }), "silence");
  eq("3rd goodbye from someone we quoted → still silence, no alert", repeatedMessageAction({ times: 3, reading: BYE, good: true }), "silence");
  eq("3rd identical QUESTION from a good prospect → a person", repeatedMessageAction({ times: 3, reading: PRICE, good: true }), "escalate");
  eq("…once: after that, silence", repeatedMessageAction({ times: 4, reading: PRICE, good: true, alreadyEscalated: true }), "silence");
  eq("3rd identical question, nothing to rescue → silence", repeatedMessageAction({ times: 3, reading: PRICE, good: false }), "silence");
  eq("reader down, 3rd time → silence (never an alert on a guess)", repeatedMessageAction({ times: 3, text: "Bay", reading: null, good: true }), "silence");
  eq("10th 'sí' → send", repeatedMessageAction({ times: 10, text: "sí", reading: { asks: [], signals: ["afirma"] }, good: true }), "send");
  eq("5th 'Hola' → send", repeatedMessageAction({ times: 5, text: "Hola", reading: { asks: [], signals: ["saludo"] }, good: false }), "send");
}

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
