// utils/frustration.js
//
// "YA TE DIJE LO QUE QUIERO" IS THE LAST WARNING WE GET (2026-11-06, psid
// 28881861821437120, "No respondió lo que se preguntó").
//
// Ernesto said it four different ways — "Ya te dije lo que quiero 😀... Tu dijiste la
// longitud de los rollos", "Aquí me preguntaste y te respondí", "También ya te
// contesté", "Ya te dije los datos" — and every one of them got the borde flow's
// catch-all nudge, three of them WORD FOR WORD. Then he wrote "Ya para de mmr" three
// times and got the same paragraph each time. Noemí took the conversation over 24
// minutes later.
//
// A customer telling us they ALREADY ANSWERED is not a question to parse: it is a
// report that the bot is not listening, and the only right move is to stop selling and
// put a person on it. Same family as §5C (a complaint about the attention goes straight
// to a person) — this is the form it takes when the complaint is about US, mid-sale.
//
// Two groups, and the difference matters:
//   SAID_ALREADY  — "ya te dije", "ya te contesté", "ya te di los datos". Only counts
//                   when the message brings NO new data: "ya te dije que quiero el de
//                   18 m" carries the answer, and the flow must still quote it.
//   ANGRY         — insults and "ya párale". Counts on its own, always. Nothing in a
//                   furious message is worth parsing for a measure.
//
// Tests: node scripts/frustrationTest.js

const END = "(?![a-záéíóúñ])";

const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// "I already told you / I already answered that."
const SAID_ALREADY = new RegExp(
  "(" +
    "ya\\s+(?:te\\s+|le\\s+)?(?:lo\\s+|los\\s+|las\\s+)?(?:dije|dijimos|conteste|contestamos|respondi|respondimos|mande|mandamos|di|dimos|puse|pasamos|pase)" + END + "|" +
    "(?:te|le)\\s+(?:lo\\s+)?(?:dije|conteste|respondi|mande)\\s+ya" + END + "|" +
    "ya\\s+(?:te\\s+)?(?:lo\\s+)?(?:habia|hab[ií]a)\\s+(?:dicho|contestado|respondido|mandado)|" +
    "aqui\\s+(?:me|te)\\s+(?:lo\\s+)?(?:pregunt\\w+|dij\\w+).{0,20}(?:respond|contest)\\w+|" +
    "tambien\\s+ya\\s+(?:te\\s+)?(?:conteste|respondi|dije)|" +
    "eso\\s+ya\\s+(?:te\\s+)?(?:lo\\s+)?(?:dije|conteste|respondi)|" +
    "(?:es|esa|ese)\\s+(?:el|la)?\\s*dato\\s+que\\s+(?:ya\\s+)?(?:te\\s+)?di" +
  ")",
  "i"
);

// Angry, insulting, or telling us to stop. "Ya para de mmr" is "ya párale de mamar" —
// the customer's own words, and the third time he wrote it the bot answered with the
// price list again.
const ANGRY = new RegExp(
  "(" +
    "\\bya\\s+par[ae]l?e?\\s+de\\b|\\bya\\s+para\\s+de\\b|\\bbasta\\s+ya\\b|\\bya\\s+estuvo\\b|" +
    "\\bmmr\\b|\\bmamar\\b|\\bchinga\\w*|\\bpendej\\w*|\\bestupid\\w*|\\bimbecil\\w*|\\bidiota\\w*|" +
    "\\bno\\s+(?:me\\s+)?(?:entiendes|entiende|estas\\s+entendiendo|sirves|sirve)\\b|" +
    "\\beres\\s+(?:un\\s+)?(?:robot|bot|maquina)\\b|\\bhabl(?:o|ando|as|e)\\s+con\\s+(?:un[ao]?\\s+)?(?:robot|bot|maquina)\\b|" +
    "\\bno\\s+(?:lees|leiste|leyeron|leen)\\b|" +
    "\\bqu[ée]\\s+mal\\s+servicio\\b|\\bp[eé]simo\\s+servicio\\b|" +
    "\\bme\\s+estas\\s+(?:dando\\s+vueltas|marean\\w*)\\b|\\bpuras\\s+vueltas\\b" +
  ")",
  "i"
);

/**
 * Is the customer telling us we are not listening, or losing their temper?
 *
 * @param {string} text the message, as they wrote it
 * @param {object} [o]
 * @param {boolean} [o.carriesNewData] true when the message also brings a measure, a
 *        quantity or other data the flow can act on — then "ya te dije que quiero 18 m"
 *        is answered, not escalated. Ignored for an outright insult.
 * @returns {false | "said_already" | "angry"}
 */
function frustrationOf(text, { carriesNewData = false } = {}) {
  const t = norm(text);
  if (!t) return false;
  if (ANGRY.test(t)) return "angry";
  if (!carriesNewData && SAID_ALREADY.test(t)) return "said_already";
  return false;
}

/**
 * What the bot says. It apologises for the real failure (we were not following), says a
 * person is taking over, and asks for NOTHING — the thread is open, the customer has
 * already told us what he wants more than once, and one more question is the insult.
 *
 * @param {"said_already"|"angry"} kind
 * @returns {string}
 */
function frustrationAnswer(kind) {
  return kind === "angry"
    ? "Tienes razón y te pido una disculpa. 🙏 Dejo de insistir: ya pasé tu conversación con una persona del equipo para que te atienda directo por aquí."
    : "Perdón, tienes razón: ya me lo habías dicho. 🙏 Para no hacerte repetirlo otra vez, ya pasé tu conversación con una persona del equipo que la retoma desde aquí.";
}

module.exports = { frustrationOf, frustrationAnswer };
