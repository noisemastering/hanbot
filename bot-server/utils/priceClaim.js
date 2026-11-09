// utils/priceClaim.js
//
// A PROMISE OF A PRICE MUST CARRY THE PRICE (2026-11-09, wa:5218180999001, reported
// "Nunca le paso precio del cover").
//
// He asked for the antimaleza roll, then "Me das elmptecio de los dos", and the bot
// answered: *"Claro, te comparto el precio de ambos rollos completos de ground cover:
// 2x100 m y 4x100 m. Ambos están disponibles en negro y blanco al mismo precio."* —
// the sentence promises both prices and states neither. He gave his CP and still got
// no number; Noemí pasted $2,111.20 / $4,222.40 by hand eleven hours later.
//
// It is the same family as the unbacked catalog claim (utils/catalogClaim.js) and the
// ficha técnica one: nothing in the sentence is FALSE, so neither the grounding
// verifier nor the price clamp can see it — it describes something the turn did not
// actually do. So it is settled at the output chokepoint: a reply that says it is
// handing over the price either HAS a price in it, gets BACKED with the flow's
// resolved rows, or loses the promise.
//
// What is deliberately NOT a claim:
//   • a QUESTION — "¿te comparto el precio?" is an offer the customer still answers;
//   • "te preparamos tu cotización" — the hand-off line on the ground cover campaign
//     (§3), which promises a quote from a person, not a number in this message;
//   • "el precio depende de la medida" — a true statement about how pricing works.
//
// Tests: node scripts/priceClaimTest.js

// "te comparto / te paso / te doy / te mando / aquí están" + el precio / el costo.
// "cotización" is excluded on purpose: see above.
const CLAIM = new RegExp(
  "(?:te\\s+(?:comparto|env[ií]o|mando|paso|doy|dejo|digo)|" +
    "le\\s+(?:comparto|env[ií]o|mando|paso|doy)|" +
    "aqu[ií]\\s+(?:te\\s+)?(?:va|van|tienes|est[aá]|est[aá]n|dejo)|" +
    "ah[ií]\\s+te\\s+(?:va|van|dejo)|" +
    "estos?\\s+son)" +
    "[^.!?\\n]{0,40}?" +
    "\\b(?:precios?|costos?)\\b",
  "i"
);

// An amount actually present in the message. Our own quotes always print through
// fmtMoney ("$2111.20 (IVA incluido)"), so a currency mark is the reliable test; a
// bare "2111 pesos" counts too. A 5-digit código postal must NOT count, which is why
// a lone number does not.
const HAS_AMOUNT = /\$\s*\d|\b\d{2,}(?:[.,]\d+)?\s*pesos\b/i;

/** Split into sentences but keep the delimiters, so a strip can put the rest back. */
const sentences = (text) => String(text || "").split(/(?<=[.!?¡¿\n])/);

const claimSentences = (text) =>
  sentences(text).filter((s) => !/\?\s*$/.test(s.trim()) && CLAIM.test(s));

/**
 * Does this reply promise a price and fail to state one?
 * @param {string} text the reply as it would go out
 */
function claimsPriceWithoutNumber(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (HAS_AMOUNT.test(t)) return false; // it delivered what it promised
  return claimSentences(t).length > 0;
}

/**
 * Back the promise with the flow's resolved price rows — the same lines the prompt
 * carries and the same ones gate (a0-bis) would have quoted. The rest of the reply is
 * kept: the reported one also carried the colour fact and the freight rule, which are
 * true and useful.
 *
 * @param {string} text
 * @param {string[]} rows customer-ready lines, e.g. "• Rollo de 2 x 100 m: $2111.20"
 * @returns {string}
 */
function backPriceClaim(text, rows) {
  const t = String(text || "");
  const list = (rows || []).map((r) => String(r || "").trim()).filter(Boolean);
  if (!list.length) return stripPriceClaim(t);
  const claim = claimSentences(t)[0];
  if (!claim) return t;
  // Put the numbers immediately after the sentence that promised them.
  return t.replace(claim, `${claim.replace(/\s+$/, "")}\n${list.join("\n")}\n`).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Remove the unbacked promise, leaving everything else the turn said.
 * @param {string} text
 * @returns {string}
 */
function stripPriceClaim(text) {
  const t = String(text || "");
  if (!claimsPriceWithoutNumber(t)) return t;
  const drop = new Set(claimSentences(t));
  const kept = sentences(t).filter((s) => !drop.has(s));
  return kept
    .join("")
    .replace(/^[\s\n]*[YyEe]\s+(?=[a-záéíóúñ])/, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .replace(/^([a-záéíóúñ])/, (c) => c.toUpperCase());
}

module.exports = { claimsPriceWithoutNumber, backPriceClaim, stripPriceClaim };
