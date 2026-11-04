// utils/catalogClaim.js
//
// A CLAIM TO SEND THE CATALOG MUST BE BACKED BY AN ACTUAL ATTACHMENT (2026-11-04,
// psid 28764912069844715, reported "No le mando el catalogo").
//
// Manuel Tapia asked for "algo asi como un catalogo con su precios para poder comenzar
// a ver opciones" and six measures. The bot answered *"Te comparto nuestro catálogo 📄"*
// — and attached nothing. Noemí came in 13 hours later and sent the price list by hand.
//
// Root cause: the promise lives in the model's PROSE and the attachment is a TOOL CALL,
// and nothing tied them together. `share_catalog` (ai/workflow/tools.js) sets
// `ctx.catalogToSend`, which ai/index.js then sends as a document bubble — but the model
// wrote the sentence WITHOUT calling the tool. Reproduced 3/3 on the Coldstart flow with
// his exact message: every run said "Te comparto nuestro catálogo 📄" and every run came
// back with `catalogToSend: undefined`. The same thing was reported on 2026-10-27 for
// psid 28769615639359953 ("Información para ser distribuidor" → the same sentence, no
// file); that fix addressed the missing ESCALATION and left the empty promise standing.
//
// It is the same family as the unfilled placeholder (2026-10-28): neither the grounding
// verifier nor the price clamp can catch it, because nothing in the sentence is FALSE —
// it is a statement about an action that did not happen. So it is settled at the output
// chokepoint: if the reply claims the catalog, either we attach one or the claim goes.
//
// Tests: node scripts/catalogClaimTest.js

// "te comparto / te envío / te mando / te paso / aquí va" + catálogo / lista de precios.
// A QUESTION is not a claim: "¿te comparto el catálogo?" is an offer the customer still
// has to accept, and stripping it would be deleting a real question.
const CLAIM = new RegExp(
  "(?:te\\s+(?:comparto|env[ií]o|mando|paso|adjunto|dejo)|" +
    "aqu[ií]\\s+(?:te\\s+)?(?:va|van|tienes|est[aá]|dejo|le\\s+dejo)|" +
    "ah[ií]\\s+te\\s+(?:va|dejo)|" +
    "le\\s+(?:comparto|env[ií]o|mando|paso|adjunto)|" +
    "adjunto)" +
    "[^.!?\\n]{0,60}?" +
    "(?:cat[aá]logo|lista\\s+de\\s+precios|lista\\s+de\\s+medidas\\s+y\\s+precios)",
  "i"
);

/** Split into sentences but keep the delimiters, so a strip can put the rest back. */
const sentences = (text) => String(text || "").split(/(?<=[.!?¡¿\n])/);

/**
 * Does this reply CLAIM that the catalog is being sent?
 * @param {string} text the reply as it would go out
 */
function claimsCatalog(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return sentences(t).some((s) => !/\?\s*$/.test(s.trim()) && CLAIM.test(s));
}

/**
 * Remove the unbacked claim, leaving everything else the turn said — the six prices in
 * the reported reply were real and useful, so the whole message must not be thrown away.
 * Returns the text unchanged when there is no claim in it.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCatalogClaim(text) {
  const t = String(text || "");
  if (!claimsCatalog(t)) return t;
  const kept = sentences(t).filter((s) => /\?\s*$/.test(s.trim()) || !CLAIM.test(s));
  return kept
    .join("")
    // The removed line usually leaves a dangling conjunction behind ("Y de esas
    // medidas…"), so drop it and recapitalise — the remainder is now the first sentence.
    .replace(/^[\s\n]*[YyEe]\s+(?=[a-záéíóúñ])/, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .replace(/^([a-záéíóúñ])/, (c) => c.toUpperCase());
}

module.exports = { claimsCatalog, stripCatalogClaim };
