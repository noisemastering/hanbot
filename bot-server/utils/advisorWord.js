// utils/advisorWord.js
//
// THE CUSTOMER NEVER HEARS THE WORD "ASESOR" (2026-10-28, the user reading a reply of
// ours against the client's campaign document).
//
// The rule is the client's and it is written into SEVEN of the nine live flows, in
// their own node prompts: "No te refieras al asesor humano como 'asesor' o 'humano',
// puedes usar 'especialista' o 'supervisor' o alguna otra expresión que aplique" —
// plus, on the Ground Cover campaign, "No te refieras a la acción de escalar el caso
// como 'escalar tu caso'". Every gate literal in the engine said "un asesor" anyway,
// which is the standing lesson one more time: A RULE THAT LIVES ONLY IN A PROMPT IS
// NOT IN FORCE. The reply that triggered this said "lo cierra un asesor" twice.
//
// So the word is translated at the engine's output chokepoint, where the model's own
// prose and every gate's hardcoded literal both pass. Internal text is deliberately
// NOT run through this: handoff reasons, the briefs and the dashboard say "asesor"
// because that is what the team calls itself — the rule is about what the CUSTOMER
// reads.
//
// What it does NOT touch:
//   - "asesora" / "asesoría" / "asesorarte" — the bot's own persona IS an asesora de
//     ventas ("Soy Karen, asesora de Hanlob"), which no rule forbids; only the
//     third-person human hand-off is renamed. NOTE THE ACCENT TRAP: a trailing \b
//     after "asesor" MATCHES inside "asesoría", because "í" is not a regex word
//     character — the same trap that silently disabled the follow-up's "ya compré"
//     exclusion. The end of the word is spelled `(?![a-záéíóúñ])`.
//   - anything inside a URL, so a tracked link or a listing slug can never be rewritten
//     into a dead one.

// Case-preserving swap: ASESOR → ESPECIALISTA, Asesor → Especialista, asesor → especialista.
function keepCase(found, replacement) {
  if (found === found.toUpperCase()) return replacement.toUpperCase();
  if (found[0] === found[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;

function swap(seg) {
  return seg
    .replace(/\basesores(?![a-záéíóúñ])/gi, (m) => keepCase(m, "especialistas"))
    .replace(/\basesor(?![a-záéíóúñ])/gi, (m) => keepCase(m, "especialista"))
    // "humano" only where it names the person we hand off to — a determiner in front
    // is what makes it that, so "el trato humano" or "error humano" stay as they are.
    .replace(/\b(un|una|el|la|otro|otra|nuestro|nuestra|algún|alguna)\s+human[oa]\b/gi,
      (m, det) => `${det} ${keepCase(m.slice(m.length - 6), "especialista")}`)
    .replace(/\b(unos|unas|los|las|nuestros|nuestras)\s+humanos?\b/gi,
      (m, det) => `${det} especialistas`);
}

/**
 * Rewrite a customer-facing reply so it never calls the human an "asesor" or a
 * "humano". URL-safe; returns non-strings unchanged.
 */
function sayEspecialista(text) {
  if (!text || typeof text !== "string") return text;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out += swap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += swap(text.slice(last));
  return out;
}

module.exports = { sayEspecialista };
