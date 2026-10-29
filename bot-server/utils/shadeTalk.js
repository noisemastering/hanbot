// utils/shadeTalk.js
//
// GROUND COVER HAS NO SHADE PERCENTAGE (reported 2026-10-28 from the sandbox, severity
// alta: "habla de malla sombra cuando el anuncio es de ground cover").
//
// On the Ground Cover ad the customer wrote "quiero ground cover 4x100" and the bot
// answered "ese rollo lo manejamos en varios porcentajes de sombra (35%, 50%, 70%,
// 80%, 90%). ¿Cuál necesitas?" — those are the Raschel shade-cloth percentages. Ground
// cover is antimaleza: it goes on the ground, it comes in black and white, and the
// only things that move its price are the WIDTH and the LENGTH. Asking which shade
// percentage they want is asking about a different product, and it stalls the sale on
// a question with no answer.
//
// The company-wide product facts already say this in `setupContext.js` ("ground cover
// not measured in shade % at all") and the model said it anyway, which is the standing
// lesson in this repo: a rule that lives only in a prompt is not in force. So the
// sentence is removed at the output chokepoint, on ground cover flows only.
//
// It works at SENTENCE level rather than rewriting phrases: a reply that quotes a
// price and then asks for the shade percentage keeps its price and loses the question.
// If nothing is left to ask, the ask that belongs here — the width — is appended, so
// the turn never ends on a dead end.

// Two shapes, and the narrowness is deliberate. A SINGLE percentage is left alone: if
// the customer asks about malla sombra and the turn flow-switches, "la de 90%" is a
// correct answer and this guard must not touch it. What cannot be right on ground
// cover is ASKING about the shade percentage, or reciting Raschel's list.
const SHADE_ASK = /(porcentajes?\s+de\s+sombra|%\s*de\s+sombra|sombra\s+(al|del)\s+\d{2}\s*%)/i;
const SHADE_LIST = /\b\d{2}\s*%\s*(?:,|y|o|\/)\s*\d{2}\s*%/i;
const SHADE_RE = new RegExp(`${SHADE_ASK.source}|${SHADE_LIST.source}`, "i");
const WIDTH_ASK = "¿Qué medida necesitas: 2 m o 4 m de ancho? 😊";

/**
 * Drop shade-percentage talk from a ground-cover reply.
 * @param {string} text
 * @returns {string} the reply without it (never empty if the input wasn't)
 */
function stripShadeTalk(text) {
  if (!text || typeof text !== "string" || !SHADE_RE.test(text)) return text;

  // Keep the delimiter with its sentence so "$4222.40 (IVA incluido)." survives whole.
  const parts = String(text).split(/(?<=[.!?\n])/);
  let kept = parts.filter((p) => !SHADE_RE.test(p));
  // A DANGLING "¿CUÁL NECESITAS?" IS WORSE THAN THE ERROR. The offer it referred to is
  // the sentence we just removed, so the customer is left choosing between nothing.
  // Only when something was actually stripped — an identical question in an untouched
  // reply is about something real.
  if (kept.length !== parts.length) {
    kept = kept.filter((p) => !/^\s*¿\s*cu[aá]l[^?]{0,40}\?/i.test(p));
  }
  let out = kept.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Everything was about the shade percentage, or the reply no longer asks anything:
  // give the turn back its question instead of leaving a statement in the air.
  if (!out) return WIDTH_ASK;
  if (!/\?/.test(out)) out = `${out} ${WIDTH_ASK}`;
  return out;
}

module.exports = { stripShadeTalk, SHADE_RE, SHADE_ASK, SHADE_LIST };
