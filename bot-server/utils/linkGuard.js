// utils/linkGuard.js
//
// A LINK IS NOT THE MODEL'S TO AUTHOR (2026-11-17, found replaying ticket
// wa:5218281000138). After "Trae estacas?" and "Tienes envíos?" the customer wrote
// "Ok" and the model answered "te comparto el link del de 54 m para que completes tu
// compra: https://hanlob.com.mx/collections/borde-separador/products/borde-separador-premium-54m"
// — a URL that is in no catalogue entry, no flow, no tool output. It invented it, for
// a length nobody chose. Prices have had this guard since the "7x4 → $3450" report
// (clampPrices); links had none.
//
// The rule is the same one: a link in a reply must be one the SYSTEM produced this
// conversation — a tool output, the flow's own context/knowledge, or something we
// already sent. Anything else is removed, together with the sentence that announced
// it, so the customer is never handed a dead or wrong URL.
//
// This is not interpretation: a URL either appears in what the engine resolved or it
// does not.
//
// Tests: node scripts/linkGuardTest.js

const URL_RE = /https?:\/\/[^\s<>"'）)\]]+/gi;
const clean = (u) => String(u).replace(/[.,;:!?…]+$/, "");

function linksIn(text) {
  return (String(text || "").match(URL_RE) || []).map(clean);
}

/**
 * @param {string} text     the model's reply
 * @param {string} sources  everything the system produced or was given this turn
 * @returns {{text: string, removed: string[]}}
 */
function stripUnknownLinks(text, sources) {
  const src = String(sources || "");
  const unknown = [...new Set(linksIn(text))].filter((u) => !src.includes(u));
  if (!unknown.length) return { text, removed: [] };
  let out = String(text);
  for (const u of unknown) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // a markdown link keeps its label out too: [texto](url)
    out = out.replace(new RegExp(`\\[[^\\]]*\\]\\(\\s*${esc}[^)]*\\)`, "g"), " ");
    // the clause that carries the URL goes with it: everything from the end of the
    // previous sentence up to the URL ("Cómpralo aquí: <url>"), and nothing after it.
    out = out.replace(new RegExp(`[^.!?\\n]*${esc}[.,;:]?`, "g"), " ");
  }
  // A sentence left announcing a link that is no longer there ("te comparto el link
  // del de 54 m para que completes tu compra:") is an empty promise — drop it too.
  out = out
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?:])\s+/)
        .filter((s) => !(/:\s*$/.test(s.trim()) && /\b(link|enlace|liga)\b/i.test(s)))
        .join(" ")
    )
    .filter((line, i, arr) => line.trim() || (i > 0 && arr[i - 1].trim()))
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: out, removed: unknown };
}

module.exports = { stripUnknownLinks, linksIn };
