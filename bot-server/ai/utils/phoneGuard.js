// ai/utils/phoneGuard.js
//
// Guarantees the bot never hands out a phone number that isn't one of Hanlob's
// real numbers (from CompanyInfo). The AI has historically hallucinated
// placeholder numbers like "442 123 4567". This is the hard backstop:
// every outgoing message passes through here; any phone-shaped digit sequence
// that isn't a real company number gets replaced with the real one.
//
// This is MECHANICAL phone-digit detection (find a 10-digit sequence, compare
// to the known real numbers) — not a semantic decision. It only runs on text
// that is actually about phones/contact, so prices, dimensions, zip codes and
// item ids in other messages are never touched.

const { getBusinessInfo } = require("../../businessInfoManager");

// Normalize to the last 10 digits (MX national number) for comparison.
function digits10(s) {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * Replace any fabricated phone number in `text` with the real company number.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sanitizePhones(text) {
  if (!text) return text;

  // Only act when the message is actually about phone/contact. Avoids touching
  // prices ("$2,185"), dimensions, zip codes, or ML item ids in other replies.
  if (!/tel[eé]fono|n[uú]mero|ll[aá]m|whats|cont[aá]ct/i.test(text)) return text;

  let info;
  try {
    info = await getBusinessInfo();
  } catch {
    return text;
  }
  const realPhones = (info && info.phones) || [];
  if (!realPhones.length) return text; // nothing to compare against; leave as-is

  const realSet = new Set(realPhones.map(digits10).filter(Boolean));
  if (!realSet.size) return text;
  const display = realPhones[0]; // canonical number to substitute

  // Candidate MX phone sequences: optional +52 / leading 1, then 10 digits in
  // 2-3 / 3-4 / 4 groups separated by space, dot or dash (or run together).
  const re = /(?:\+?52[\s.-]?)?(?:1[\s.-]?)?\d{2,3}[\s.-]?\d{3,4}[\s.-]?\d{4}/g;
  const found = text.match(re) || [];
  let out = text;
  const handled = new Set();

  for (const cand of found) {
    if (handled.has(cand)) continue;
    handled.add(cand);
    const d = digits10(cand);
    if (!d) continue;
    if (realSet.has(d)) continue; // it's a real company number — keep it
    // Fabricated number → swap for the real one.
    out = out.split(cand).join(display);
    console.log(`📞 phoneGuard: replaced fabricated "${cand}" → "${display}"`);
  }
  return out;
}

module.exports = { sanitizePhones };
