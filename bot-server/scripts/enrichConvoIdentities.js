// scripts/enrichConvoIdentities.js
//
// AI-reads each conversation's messages and writes the customer's identity
// (name/city/state/zip) onto the conversation as `aiIdentity` — recovering the
// signal that field-scraping misses ("envían a Tijuana", a name given mid-chat).
//
// Usage: node scripts/enrichConvoIdentities.js [sinceISO]
//        node scripts/enrichConvoIdentities.js 2026-06-01

require("dotenv").config();
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ZipCode = require("../models/ZipCode");
const { extractConvoIdentity } = require("../ai/utils/convoIdentityExtractor");

const SINCE = process.argv[2] ? new Date(process.argv[2]) : null;
const CONCURRENCY = 8;

async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length || 1) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    })
  );
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  // Only enrich convos not already done (idempotent, avoids re-charging AI). Pass
  // FORCE=1 to re-enrich everything.
  const dateClause = SINCE ? { $or: [{ lastMessageAt: { $gte: SINCE } }, { createdAt: { $gte: SINCE } }] } : {};
  const filter = process.env.FORCE ? dateClause : { $and: [dateClause, { aiIdentity: { $exists: false } }] };
  const convos = await Conversation.find(filter).select("psid").lean();
  console.log(`🧠 Enriching ${convos.length} conversations${SINCE ? ` since ${SINCE.toISOString().slice(0, 10)}` : ""} with AI identity extraction...`);

  const stats = { done: 0, gotName: 0, gotCity: 0, gotZip: 0, gotZipValid: 0, empty: 0, noMsgs: 0 };
  const t0 = Date.now();

  await pool(convos, CONCURRENCY, async (c) => {
    try {
      const msgs = (await Message.find({ psid: c.psid, senderType: "user" }).select("text").sort({ createdAt: 1 }).lean()).map((m) => m.text);
      if (!msgs.length) { stats.noMsgs++; stats.done++; return; }
      // Name harvesting: the customer's name comes from the automated greeting (Meta),
      // echoed by the bot as "Hola <Nombre>, soy …". Pass the first greeting-looking bot line.
      const gm = await Message.find({ psid: c.psid, senderType: "bot" }).select("text").sort({ createdAt: 1 }).limit(4).lean();
      const greeting = (gm.find((m) => /\bhola\b|buen(?:os|as)\b/i.test(String(m.text || ""))) || {}).text || null;
      const id = await extractConvoIdentity(msgs, { greeting });

      // validate zip against the real MX zip DB (drop AI-hallucinated codes)
      let zipValid = null;
      if (id.zip) {
        const z = await ZipCode.findOne({ code: id.zip }).select("code city state").lean().catch(() => null);
        if (z) { zipValid = id.zip; stats.gotZipValid++; }
      }
      if (id.zip) stats.gotZip++;
      if (id.name) stats.gotName++;
      if (id.city) stats.gotCity++;
      if (!id.name && !id.city && !id.state && !zipValid) stats.empty++;

      await Conversation.updateOne(
        { _id: c._id },
        { $set: { aiIdentity: { name: id.name, city: id.city, state: id.state, zip: zipValid, zipRaw: id.zip, extractedAt: new Date(), source: "ai" } } }
      );
    } catch (e) {
      /* skip this convo */
    }
    stats.done++;
    if (stats.done % 200 === 0) console.log(`   [${stats.done}/${convos.length}] name=${stats.gotName} city=${stats.gotCity} zip=${stats.gotZipValid}`);
  });

  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   conversations: ${stats.done} (no messages: ${stats.noMsgs}, nothing found: ${stats.empty})`);
  console.log(`   extracted → name: ${stats.gotName} | city: ${stats.gotCity} | zip: ${stats.gotZip} (valid MX: ${stats.gotZipValid})`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
