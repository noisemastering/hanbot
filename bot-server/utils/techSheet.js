// utils/techSheet.js
//
// A TECHNICAL QUESTION IS ANSWERED WITH THE FICHA TÉCNICA (2026-11-06, psid
// 28508399788837176, "No respondió lo que se preguntó").
//
// Miguel Ángel wrote "Quiero características de ese ground cover . Grosor" and got the
// campaign's promo prices and then the ask for his CP and colonia — the question itself
// was never touched. Noemí answered it three hours later the way it should be answered:
// *"Le comparto ficha técnica del cover"* + the PDF. So that is what the bot does now.
//
// This is the ONE predicate, so the gate in the engine and the claim guard at the output
// chokepoint can never drift apart. Two halves, same shape as utils/catalogClaim.js:
//
//   asksTechSheet()  — the customer is asking for the DATA SHEET or for a figure that
//                      lives on it (grosor, gramaje, calibre, densidad, polímero…).
//   claimsTechSheet()/stripTechSheetClaim() — a reply that SAYS it is sharing the ficha
//                      must be backed by the file. The bot has been offering it in prose
//                      for a year with nothing attached ("también te paso la ficha
//                      técnica", 2026-06-14 / 2026-07-02 / 2026-09-13): the promise is
//                      the model's sentence, the attachment is a separate send, and
//                      nothing in the sentence is false — so neither the grounding
//                      verifier nor the price clamp can see it.
//
// Deliberately NOT in here: la GARANTÍA (a knowledge answer, not a spec sheet) and the
// PORCENTAJE DE SOMBRA (owned by the flows and company-wide knowledge — and ground cover
// has none at all). Pulling those in would hijack answers that already work.
//
// Tests: node scripts/techSheetTest.js

// Spanish word ends: a trailing \b never matches after an accented vowel.
const END = "(?![a-záéíóúñ])";

// The document itself, by name.
const SHEET = new RegExp(
  "(" +
    "fichas?\\s+t[eé]cnicas?|" +
    "hojas?\\s+t[eé]cnicas?|" +
    "datos\\s+t[eé]cnicos|" +
    "especificaci[oó]n(?:es)?(?:\\s+t[eé]cnicas?)?|" +
    "caracter[ií]sticas?(?:\\s+t[eé]cnicas?)?" +
  ")" + END,
  "i"
);

// A figure that only the ficha carries. "grosor" is the reported word; the rest are what
// the sheet actually answers (gramaje 105 gr/m², HDPE, 720 KLYS, densidad de hilos).
const SPEC = new RegExp(
  "\\b(" +
    "grosor(?:es)?|grueso\\s+(?:de\\s+)?l[ao]\\s+malla|" +
    "calibre|" +
    "gramaje|" +
    "micr(?:as|ones|onaje)|" +
    "densidad(?:\\s+de\\s+hilos)?|" +
    "pol[ií]mero|hdpe|polietileno|" +
    "tipo\\s+de\\s+tejido|" +
    "resistencia\\s+(?:a\\s+l[ao]s\\s+)?(?:uv|rayos)|protecci[oó]n\\s+uv|" +
    "composici[oó]n|" +
    "de\\s+qu[eé]\\s+(?:material|est[aá]\\s+hecha)|" +
    "qu[eé]\\s+material" +
  ")" + END,
  "i"
);

/**
 * Is the customer asking for the technical data sheet, or for a figure that lives on it?
 *
 * @param {string} text the customer's message, as they wrote it
 * @returns {boolean}
 */
function asksTechSheet(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return SHEET.test(t) || SPEC.test(t);
}

/**
 * What the bot says when it attaches the sheet. Noemí's own answer, plus one question so
 * the conversation keeps moving instead of ending on a document. It quotes NO figure:
 * the numbers are in the file, and we never retype a spec we might get wrong.
 *
 * @param {string} label how to name the product ("la malla antimaleza (Ground Cover)")
 * @returns {string}
 */
function techSheetReply(label) {
  const what = label ? ` de ${label}` : "";
  return (
    `Te comparto la ficha técnica${what} 📄 ` +
    `Ahí vienen los datos del material: gramaje, tipo de tejido, polímero y resistencia UV. ` +
    `¿Qué medida necesitas y te paso el precio? 😊`
  );
}

// A reply that CLAIMS the sheet. Same shape as claimsCatalog: an OFFER is not a promise
// ("¿te paso la ficha técnica?" is a question the customer still has to answer, and
// stripping it would delete a real question), so a sentence ending in "?" never counts.
const CLAIM = new RegExp(
  "(?:te\\s+(?:comparto|env[ií]o|mando|paso|adjunto|dejo)|" +
    "le\\s+(?:comparto|env[ií]o|mando|paso|adjunto)|" +
    "aqu[ií]\\s+(?:te\\s+)?(?:va|van|tienes|est[aá]|dejo|le\\s+dejo)|" +
    "ah[ií]\\s+te\\s+(?:va|dejo)|" +
    "adjunto)" +
    "[^.!?\\n]{0,60}?(?:ficha\\s+t[eé]cnica|hoja\\s+t[eé]cnica|datos\\s+t[eé]cnicos)",
  "i"
);

function sentencesOf(text) {
  return String(text || "")
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => s.trim());
}

/**
 * Does this reply claim to be sending the ficha técnica?
 * @param {string} text the reply the bot is about to send
 * @returns {boolean}
 */
function claimsTechSheet(text) {
  return sentencesOf(text).some((s) => !/\?\s*$/.test(s.trim()) && CLAIM.test(s));
}

/**
 * Drop the claim and keep everything else the turn delivered (a reply that promises the
 * ficha usually answers something real alongside it). Mirrors stripCatalogClaim.
 * @param {string} text
 * @returns {string}
 */
function stripTechSheetClaim(text) {
  const kept = sentencesOf(text)
    .filter((s) => /\?\s*$/.test(s.trim()) || !CLAIM.test(s))
    .map((s) => s.replace(/^\s*(?:y|e|tambi[eé]n)\s+/i, "").trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return kept.join(" ").trim();
}

/**
 * The one-sentence version, for a turn that ALSO has something else to deliver (a price,
 * a measure). The customer asked two things and both get answered: the sheet rides along
 * with the quote instead of being dropped, which is the standing "a gate that answers
 * HALF the message drops the other half" rule.
 *
 * @param {string} label how to name the product
 * @returns {string}
 */
function techSheetLead(label) {
  const what = label ? ` de ${label}` : "";
  return `Te comparto la ficha técnica${what} 📄 (ahí vienen gramaje, tejido, polímero y resistencia UV).`;
}

module.exports = { asksTechSheet, techSheetReply, techSheetLead, claimsTechSheet, stripTechSheetClaim };
