// scripts/dimensionAudit.js
//
// DETERMINISTIC dimension audit. The rule: for ANY requested measure the bot must
// offer the CLOSEST AVAILABLE size (exact if in catalog; else the nearest real size,
// ceiling decimals). This checks every 2-D measure a customer sent against what the
// bot replied — no LLM needed, so no judge variance.
//
//   node scripts/dimensionAudit.js                       # last 3 days
//   node scripts/dimensionAudit.js 2026-07-20T00:00:00Z  # explicit cutoff
//
// Flags per requested measure:
//   OK            → bot's reply names the exact (in-catalog) or the closest size
//   WRONG_SIZE    → bot named a size that is NOT the closest available
//   NO_OFFER      → bot handed off / denied / re-asked instead of offering a size
//   (decimals are ceiled before matching, per the ceil-not-floor rule)
require("dotenv").config();
const mongoose = require("mongoose");

const CUTOFF = new Date(process.argv[2] || new Date(Date.now() - 3 * 24 * 3600e3).toISOString());

// all 2-D measures in a string, normalized to sorted [min,max]; handles "6x4",
// "6 x 4", "6 por 4", "6X4", Mexican decimal comma "4,5x4,5".
function measuresIn(text) {
  const t = String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2");
  const out = [];
  // allow an optional m/mts/metros between the number and the "x" — the bot replies
  // with "7m x 10m", "4 m x 11 m", which the bare form missed (hiding real offers).
  const re = /(\d{1,3}(?:\.\d)?)\s*(?:m|mts?|metros?)?\s*(?:x|×|por)\s*(\d{1,3}(?:\.\d)?)/g;
  let m;
  while ((m = re.exec(t))) {
    const a = +m[1], b = +m[2];
    if (a >= 1 && a <= 30 && b >= 1 && b <= 30) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}
const key = (d) => `${d[0]}x${d[1]}`;
const NO_OFFER = /(asesor|especialista|no (lo )?manejo|no (la )?manejamos|no contamos|no disponible|medida especial|sobre medida|cotización personalizada|te paso con|un humano)/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Message = require("../models/Message");
  const WF = require("../models/Workflow");
  const { availableMeasuresForFamilies, closestAvailableMeasure, dimsOf } = require("../ai/workflow/tools");

  // Confeccionada catalog (the 2-D realm most measures target).
  const rf = await WF.findOne({ name: /con Refuerzo.*Retail/i });
  const fams = WF.familyListOf(rf) || [];
  const catalog = new Set((await availableMeasuresForFamilies(fams)).filter((x) => x.dims && !x.lengthOnly).map((x) => key(x.dims)));
  const expectedFor = async (want) => {
    const ceil = [Math.ceil(want[0]), Math.ceil(want[1])].sort((a, b) => a - b); // ceil decimals, then match
    if (catalog.has(key(ceil))) return key(ceil);           // exact (after ceil)
    if (catalog.has(key(want))) return key(want);
    const c = await closestAvailableMeasure(null, fams, ceil);
    return c && c.dims ? key(c.dims) : null;
  };

  console.log(`\n════════ DIMENSION AUDIT — since ${CUTOFF.toISOString()} ════════`);
  console.log(`  confeccionada catalog: ${catalog.size} sizes (2x2 … 7x10)`);

  // Every user message carrying a 2-D measure, with the bot's immediate reply.
  const userMsgs = await Message.find({ senderType: "user", timestamp: { $gte: CUTOFF } })
    .sort({ timestamp: 1 }).select("psid text timestamp").lean();

  const findings = { OK: 0, WRONG_SIZE: [], NO_OFFER: [] };
  let checked = 0;
  for (const um of userMsgs) {
    const wants = measuresIn(um.text);
    if (!wants.length) continue;
    // the bot's next reply for this psid
    const reply = await Message.findOne({ psid: um.psid, senderType: "bot", timestamp: { $gt: um.timestamp } })
      .sort({ timestamp: 1 }).select("text").lean();
    if (!reply) continue;
    const offered = new Set(measuresIn(reply.text).map(key));
    for (const want of wants) {
      const expected = await expectedFor(want);
      if (!expected) continue;
      checked++;
      if (offered.has(expected)) { findings.OK++; continue; }
      // the bot named SOME size, just not the expected one?
      if (offered.size) {
        findings.WRONG_SIZE.push({ psid: um.psid, want: key(want), expected, offered: [...offered].join(","), reply: (reply.text || "").slice(0, 90) });
      } else if (NO_OFFER.test(reply.text || "")) {
        findings.NO_OFFER.push({ psid: um.psid, want: key(want), expected, reply: (reply.text || "").slice(0, 100) });
      }
      // else: bot said neither a size nor a handoff phrase (e.g. asked shade/color) → skip, not a dim error
    }
  }

  console.log(`\n  Requested measures checked: ${checked}`);
  console.log(`  ✅ offered the right size: ${findings.OK}`);
  console.log(`  ⚠️  WRONG size offered:     ${findings.WRONG_SIZE.length}`);
  console.log(`  🔺 NO size offered (handoff/denial): ${findings.NO_OFFER.length}`);

  if (findings.NO_OFFER.length) {
    console.log(`\n  ── NO_OFFER — should have offered the closest available, didn't ──`);
    for (const f of findings.NO_OFFER) console.log(`   🔺 pidió ${f.want} → esperado ${f.expected} | psid ${f.psid}\n        "${f.reply}"`);
  }
  if (findings.WRONG_SIZE.length) {
    console.log(`\n  ── WRONG_SIZE — offered a size that isn't the closest available ──`);
    for (const f of findings.WRONG_SIZE) console.log(`   ⚠️ pidió ${f.want} → esperado ${f.expected}, ofreció ${f.offered} | psid ${f.psid}\n        "${f.reply}"`);
  }

  console.log(`\n════════ END — checked ${checked} | wrong ${findings.WRONG_SIZE.length} | no-offer ${findings.NO_OFFER.length} ════════\n`);
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
