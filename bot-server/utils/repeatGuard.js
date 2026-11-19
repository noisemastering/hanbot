// utils/repeatGuard.js
//
// THE BOT MUST NEVER SAY THE SAME THING TWICE AS IF IT WERE THE FIRST TIME
// (the user's rule, 2026-11-06, after psid 28881861821437120):
//
//   "the bot must not repeat the same answer even if the client asks the same question,
//    it must at least make clear that it already mentioned it and/or change the wording
//    for the next response, if the client asks the same question a third time it should
//    escalate if it's a good prospect or stop replying if he's just trolling"
//
// Ernesto got one identical paragraph FIVE times in nine minutes ("¡Gracias! Ya te pasé
// los precios de los rollos de 6 m, 9 m, 18 m, 54 m…"), including as the answer to "Ya
// para de mmr". The old guard did fire — it just appended a fixed line, and since the
// engine stores the BARE reply in history, every later turn compared bare-to-bare,
// matched again, and produced the identical appended text. A remedy that produces the
// same bytes is not a remedy.
//
// So this is a LADDER, counted per distinct answer (keyed by the answer's own text, so
// it also catches the same answer coming back later in the conversation, not only on
// consecutive turns):
//
//   1st time  → send it.
//   2nd time  → say so and reword: "Como te comentaba" + the answer. Never silent, never
//               identical bytes.
//   3rd time  → the bot is out of ideas. A GOOD PROSPECT gets a person; a troll gets
//               nothing, because answering is what he is playing with.
//
// "Good prospect" is read off what the conversation already produced — a quote, a
// measure, a CP, a phone, a clicked link. Deliberately NOT the same predicate as
// `worthAlerting` (utils/coldLead.js): that one decides whether to wake a salesperson
// for a SILENT lead, where only a phone or an email counts. Here the customer is in
// front of us and the question is whether there is a sale to rescue, so being quoted a
// price counts for a great deal.
//
// Tests: node scripts/repeatGuardTest.js

const MAX_KEYS = 24; // a conversation's answer ledger; oldest dropped first

const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s ]+/g, " ")
    .replace(/[^a-z0-9ñ$.,:%/ ]/g, "") // emojis and punctuation don't make an answer new
    .trim();

/**
 * A stable key for an answer. Short, so the ledger stays small on the conversation.
 * @param {string} text
 * @returns {string|null}
 */
function answerKey(text) {
  const n = norm(text);
  if (n.length < 20) return null; // too short to be "the same answer" meaningfully
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return `a${(h >>> 0).toString(36)}`;
}

/**
 * Count this answer on the conversation's ledger and return how many times it has now
 * been produced (1 = first time). Mutates `state.answerCounts`, which the caller
 * persists with the rest of the workflow state.
 *
 * @param {object} state the workflow state (mutated)
 * @param {string} text the reply the engine produced
 * @returns {number}
 */
function bumpAnswer(state, text) {
  const key = answerKey(text);
  if (!key || !state) return 1;
  const counts = state.answerCounts && typeof state.answerCounts === "object" ? { ...state.answerCounts } : {};
  counts[key] = (counts[key] || 0) + 1;
  const keys = Object.keys(counts);
  if (keys.length > MAX_KEYS) for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete counts[k];
  state.answerCounts = counts;
  return counts[key];
}

/**
 * The second-time wording: make it plain we already said this, and don't hand back the
 * same bytes. It leads with the acknowledgement rather than rewriting the answer, so
 * nothing about the facts — prices, measures, links — can drift in the rephrasing.
 *
 * @param {string} text
 * @returns {string}
 */
function restate(text) {
  const body = String(text || "")
    .replace(/^\s*(?:¡?(?:gracias|claro|perfecto|con gusto)!?[.,…]?\s*)+/i, "")
    .trim();
  return `Como te comentaba 👇\n\n${body || String(text || "").trim()}`;
}

/**
 * Is there a sale here worth a person's time? Read off what the conversation produced,
 * not off how polite the customer was.
 *
 * @param {object} c
 * @param {object} [c.state] the workflow state (quotes, lead, location, product)
 * @param {object} [c.convo] the Conversation document (its zipcode, when the engine's
 *        state doesn't carry one)
 * @returns {boolean}
 */
function isGoodProspect({ state, convo } = {}) {
  const s = state || {};
  const c = convo || {};
  const lead = s.lead || {};
  const loc = s.location || {};
  return !!(
    lead.phone ||
    lead.email ||
    lead.wholesaleQty ||
    loc.zip ||
    loc.zipcode ||
    c.zipcode ||
    (Array.isArray(s.lastQuotes) && s.lastQuotes.length) ||
    (Array.isArray(s.bordeQuoted) && s.bordeQuoted.length) ||
    s.activeProductId ||
    s.rollRecommendation ||
    s.gcWidth ||
    s.purchased ||
    // A buy link went out: `zipAsked` is armed by the engine's own deterministic CP ask,
    // which fires only on a turn that shared a tracked link (ai/index.js).
    s.zipAsked ||
    s.techSheetSent
  );
}

// ── THE CUSTOMER'S OWN REPEATS (2026-11-18, psid 28809731695389746) ─────────────────
//
// The ladder above counts OUR answers. Pepa wrote "Bay" fourteen times in five days
// and got a reply to nearly every one, because the model worded its greeting a little
// differently each time — so every answer was "new" and the ladder never climbed. Short
// answers have no key at all, and the deferral gate is exempt on purpose, so today's
// "Quedo al pendiente. 🙌" could repeat for ever too.
//
// The directive is about what the CUSTOMER does ("if the client asks the same question
// a third time…"), so the same message arriving a third time is counted directly, on
// `state.msgCounts`, whatever we happened to answer:
//
//   1st, 2nd time → the turn goes on as usual (the answer ladder still restates).
//   3rd time      → a GOOD PROSPECT who is ASKING something gets a person; anything
//                   else gets silence.
//
// What is NOT a repeat, because repeating it is normal:
//   • a message with a digit — it carries data (a measure, a CP, a phone, a count);
//   • a confirmation or a refusal ("sí", "ok", "no") — it answers whatever we asked;
//   • a greeting or the ad's own prefilled opener ("¡Hola! Quiero más información") —
//     that is what every new visit starts with, and Meta writes it, not the customer.
//
// A message that asks NOTHING is remembered for a week; one that asks something only
// for a day, so a customer who asks the price again next week is simply answered.

const MSG_WINDOW_ASK_MS = 24 * 60 * 60 * 1000;
const MSG_WINDOW_EMPTY_MS = 7 * 24 * 60 * 60 * 1000;

// Fallback only, for a turn the reader could not read: a CLOSED set of words that make
// a message a confirmation or an opener. It confirms; it does not interpret.
const ROUTINE = new Set(
  ("si no ok okey okay oka claro va sale vale simon nel hola ola buen buenos buenas dia dias " +
   "tarde tardes noche noches info informacion quiero mas obtener me interesa").split(" ")
);

const msgNorm = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A stable key for a CUSTOMER message, from its TEXT alone — never from the reading,
 * which is not stable: the same "Bay" came back as a greeting on the first turn and as
 * a goodbye on the next, and a count that depends on it skips arrivals.
 * @param {string} text
 * @returns {string|null} null when the message carries data or no words at all
 */
function messageKey(text) {
  const n = msgNorm(text);
  if (!n || /\d/.test(n) || !/[a-zñ]/.test(n)) return null;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return `m${(h >>> 0).toString(36)}`;
}

/**
 * Is repeating THIS message normal? Judged on the arrival in hand, so every arrival is
 * still counted and only the verdict is withheld.
 * @param {string} text
 * @param {{asks:string[], signals:string[]}|null} [reading]
 * @returns {boolean}
 */
function isRoutineMessage(text, reading) {
  const n = msgNorm(text);
  if (n && n.split(" ").every((w) => ROUTINE.has(w))) return true;
  if (!reading) return false;
  const sig = new Set(reading.signals || []);
  if (sig.has("afirma") || sig.has("saludo") || sig.has("info_general")) return true;
  // "no gracias" said three times is a goodbye, not an answer to us.
  return sig.has("niega") && !sig.has("cortesia");
}

/**
 * Count this customer message and return how many times it has now arrived inside its
 * window (1 = first time; 1 as well when it is not countable). Mutates
 * `state.msgCounts`.
 * @param {object} state the workflow state (mutated)
 * @param {string} text the customer's message
 * @param {{asks:string[], signals:string[]}|null} [reading]
 * @param {number} [now]
 * @returns {number}
 */
function bumpMessage(state, text, reading, now = Date.now()) {
  const key = messageKey(text);
  if (!key || !state) return 1;
  const asksSomething = !!(reading && Array.isArray(reading.asks) && reading.asks.length);
  const windowMs = asksSomething ? MSG_WINDOW_ASK_MS : MSG_WINDOW_EMPTY_MS;
  const counts = state.msgCounts && typeof state.msgCounts === "object" ? { ...state.msgCounts } : {};
  const prev = counts[key];
  const fresh = prev && now - new Date(prev.at).getTime() <= windowMs;
  counts[key] = { n: fresh ? prev.n + 1 : 1, at: new Date(now).toISOString() };
  const keys = Object.keys(counts);
  if (keys.length > MAX_KEYS) {
    keys.sort((a, b) => new Date(counts[a].at) - new Date(counts[b].at));
    for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete counts[k];
  }
  state.msgCounts = counts;
  return counts[key].n;
}

/**
 * What the Nth arrival of the same customer message gets.
 * @returns {"send"|"escalate"|"silence"}
 */
function repeatedMessageAction({ times, text, reading, good, alreadyEscalated } = {}) {
  if (!(times >= 3)) return "send";
  if (isRoutineMessage(text, reading)) return "send";
  // Only a QUESTION can be something we failed to answer. A goodbye, a thank-you or
  // noise said three times is not a sale to rescue, however much was quoted earlier.
  const asksSomething = !!(reading && Array.isArray(reading.asks) && reading.asks.length);
  if (good && asksSomething && !alreadyEscalated) return "escalate";
  return "silence";
}

module.exports = {
  answerKey, bumpAnswer, restate, isGoodProspect, MAX_KEYS,
  messageKey, isRoutineMessage, bumpMessage, repeatedMessageAction,
};
