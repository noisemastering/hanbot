// scripts/backfillNamesFromGraph.js
//
// Backfill customer names on existing FB Messenger conversations by reading the
// Graph Conversations API (senders[].name) — the only reliable source for
// ad-traffic PSIDs (the webhook omits it, the Profile API is blocked). Yields
// FULL names, which is exactly what convo↔sale correlation needs.
//
// Usage:
//   node scripts/backfillNamesFromGraph.js [days] [--ad-only] [--dry]
//     days      how far back by lastMessageAt (default 30)
//     --ad-only only conversations that entered via an ad
//     --dry     report what WOULD be fetched; write nothing
require("dotenv").config();
const mongoose = require("mongoose");

const DAYS = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || "30", 10);
const AD_ONLY = process.argv.includes("--ad-only");
const DRY = process.argv.includes("--dry");
const DELAY_MS = 250; // rate-limit the Graph API

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const SS = require("../models/SystemState");
  const ss = await SS.findById("singleton").lean();
  if (ss?.fbPageToken) process.env.FB_PAGE_TOKEN = ss.fbPageToken;
  if (!process.env.FB_PAGE_TOKEN) {
    console.error("⛔ No FB_PAGE_TOKEN (env or SystemState). Cannot call the Graph API.");
    process.exit(1);
  }

  const Conversation = require("../models/Conversation");
  const { fetchMessengerName } = require("../conversationManager");
  const { looksLikeName } = require("../utils/convoSaleMatcher");

  const since = new Date(Date.now() - DAYS * 864e5);
  const q = {
    channel: { $ne: "whatsapp" }, // FB + untagged; WhatsApp already has the profile name
    lastMessageAt: { $gte: since },
    $or: [{ extractedName: { $in: [null, ""] } }, { extractedName: { $exists: false } }],
  };
  if (AD_ONLY) q.adId = { $ne: null };

  const convos = await Conversation.find(q).select("psid").sort({ lastMessageAt: -1 }).lean();
  console.log(
    `${DRY ? "🔵 DRY RUN" : "🟢 WRITE"} — ${convos.length} FB convos missing a name (last ${DAYS}d${AD_ONLY ? ", ad-entry" : ""})\n`
  );

  let got = 0, tried = 0;
  const samples = [];
  for (const c of convos) {
    tried++;
    try {
      if (DRY) {
        const name = await fetchMessengerName(c.psid);
        if (name && looksLikeName(name)) { got++; if (samples.length < 15) samples.push(name); }
      } else {
        const { harvestMessengerName } = require("../conversationManager");
        const name = await harvestMessengerName(c.psid);
        if (name) { got++; if (samples.length < 15) samples.push(name); }
      }
    } catch (e) { /* skip on error */ }
    if (tried % 25 === 0) console.log(`  ${tried}/${convos.length} … ${got} names so far`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\n✅ ${DRY ? "Would fill" : "Filled"} ${got}/${convos.length} names.`);
  if (samples.length) console.log("   e.g.", samples.join(" · "));
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
