// utils/courtesy.js
//
// A REPLY WITH NOTHING IN IT. One owner for "the customer was being polite and said
// nothing else", because two places need exactly the same judgement and they would
// drift apart the moment one of them was edited (the standing lesson from the three
// payment sentences, 2026-10-29):
//
//   • the deferral gate (ai/workflow/index.js) — "Ok gracias" / "Muy amable" is a
//     SIGN-OFF, so acknowledge, taper and stop selling (2026-11-02, wa:5217443178473,
//     the same nudge four times in three minutes).
//   • the pending-handoff resume — a thank-you or an emoji is neither a question nor
//     contact, so it must not raise an alert (2026-11-02, two asesora reports the same
//     morning: psid 9842980679120728 answered the data ask with "😏" and
//     9864541876987642 with "Gracias por tu atención").
//
// The judgement is the same one in both places: is there anything in this message
// besides politeness? Getting it too wide is the expensive direction — "Gracias, ¿me
// pasas el link?" and "me llamo Nubia Cervantes" are real replies and must never land
// here, because the answer to those is to keep going, not to close warmly.
//
// Tests: node scripts/courtesyTest.js

// Matched token by token against a CLOSED vocabulary, so anything the customer adds —
// a product, a measure, a name, a question — takes the message out of this set.
const COURTESY = new Set(
  ("ok okey okay oka sale va vale bien muy mucha muchas muchisima muchisimas mil gracias grax " +
   "amable amables de acuerdo entendido entendida enterado enterada por tu su la el lo info " +
   "informacion ayuda todo atencion apoyo buen buenos buena buenas dia dias tarde tardes noche " +
   "noches saludos igualmente quedo estamos perfecto excelente genial listo").split(" ")
);

const plainTokens = (text) => {
  const p = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return p ? p.split(" ") : [];
};

/**
 * A bare THANK-YOU: every word is courtesy vocabulary, and at least one of them is an
 * actual thanks. A question mark disqualifies it — "¿Gracias, me pasas el link?" is a
 * request. A bare "sí" or "claro" can never land here either: those CONFIRM something
 * we asked, and they are not in the set.
 */
function isThanksOnly(text) {
  const t = String(text || "");
  if (/\?/.test(t)) return false;
  const tokens = plainTokens(t);
  if (!tokens.length || tokens.length > 7) return false;
  if (!tokens.some((w) => w === "gracias" || w === "grax" || w === "amable" || w === "amables")) return false;
  return tokens.every((w) => COURTESY.has(w));
}

/**
 * A reply with NO WORDS at all — an emoji, a reaction, punctuation. "😏" was a real one.
 * Letters in any script mean the customer wrote something; digits do too (a CP, a phone
 * and a measure are all answers).
 */
function isWordlessReply(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return !/[a-zÀ-ɏЀ-ӿ]/i.test(t) && !/\d/.test(t);
}

/**
 * Nothing in it but politeness: a bare thank-you or a wordless reply. This is the test
 * for "close warmly and stop", never for "the customer gave us something".
 */
function isCourtesyOnly(text) {
  return isThanksOnly(text) || isWordlessReply(text);
}

module.exports = { isThanksOnly, isWordlessReply, isCourtesyOnly, COURTESY, plainTokens };
