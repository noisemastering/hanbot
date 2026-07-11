// scripts/backfillConvoSaleMatches.js
//
// Cross-references every conversation (name/zip/city + item asked) against the
// ml_sales dataset and writes the best sale match per conversation into
// convo_sale_matches. Enforces one-order → one-conversation (keeps the highest
// certainty; ties broken by closest convo→sale time).
//
// Usage: node scripts/backfillConvoSaleMatches.js

require("dotenv").config();
const mongoose = require("mongoose");
const { buildContext, matchConversation } = require("../utils/convoSaleMatcher");
const Conversation = require("../models/Conversation");
const ConvoSaleMatch = require("../models/ConvoSaleMatch");

const FIELDS =
  "psid extractedName productSpecs city stateMx zipCode zipcode customOrderZipcode " +
  "humanSalesZipcode leadData crmName productInterest poiRootId poiRootName productFamilyId " +
  "aiIdentity adMainProductId itemsDiscussed productInterest createdAt lastMessageAt updatedAt";

// Optional: restrict to conversations active since a date (arg 1, ISO). Filters on
// recent activity (lastMessageAt) or creation, so we only score fresh conversations.
const SINCE = process.argv[2] ? new Date(process.argv[2]) : null;
const CONVO_FILTER = SINCE
  ? { $or: [{ lastMessageAt: { $gte: SINCE } }, { createdAt: { $gte: SINCE } }] }
  : {};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const s0 = await mongoose.connection.db.stats();
  console.log(`🔗 Mongo connected. Cluster ${((s0.dataSize + s0.indexSize) / 1048576).toFixed(0)}MB / 512MB`);

  console.log("🧩 Building lookup context (families, cities, user locations)...");
  const ctx = await buildContext();
  console.log(`   itemId→family entries: ${ctx.itemToFamilies.size} | city buckets: ${ctx.cityIndex.size} | user locations: ${ctx.userLoc.size}`);

  const total = await Conversation.countDocuments(CONVO_FILTER);
  console.log(`💬 Scanning ${total} conversations${SINCE ? ` active since ${SINCE.toISOString().slice(0, 10)}` : ""}...`);

  const cursor = Conversation.find(CONVO_FILTER).select(FIELDS).lean().cursor();
  let scanned = 0,
    matched = 0;
  const byOrder = new Map(); // orderId → best match (one order → one convo)

  for (let c = await cursor.next(); c != null; c = await cursor.next()) {
    scanned++;
    if (!c.psid) continue;
    let m;
    try {
      const arr = await matchConversation(c, ctx); // now returns all matches (best first)
      m = Array.isArray(arr) ? arr[0] : arr;
    } catch (e) {
      continue;
    }
    if (!m) continue;
    matched++;
    const prev = byOrder.get(m.orderId);
    if (!prev) {
      byOrder.set(m.orderId, m);
    } else {
      const better =
        m.certainty > prev.certainty ||
        (m.certainty === prev.certainty &&
          Math.abs(m.matchDetails.minutesConvoToSale ?? 1e9) < Math.abs(prev.matchDetails.minutesConvoToSale ?? 1e9));
      if (better) byOrder.set(m.orderId, m);
    }
    if (scanned % 2000 === 0) console.log(`   [${scanned}/${total}] candidate matches: ${matched}, unique orders: ${byOrder.size}`);
  }

  const finalMatches = [...byOrder.values()];

  // LINK AUDIT (safety net): for each match, compare the product(s) whose links we
  // shared/clicked against what they actually bought — flag mismatches.
  const ClickLog = require("../models/ClickLog");
  const parseSize = (t) => {
    const m = String(t || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2").match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    if (!(a >= 1 && a <= 16 && b >= 1 && b <= 16)) return null;
    return `${Math.min(a, b)}x${Math.max(a, b)}`;
  };
  for (const d of finalMatches) {
    const clicks = await ClickLog.find({ psid: d.psid, productName: { $ne: null } }).select("productName clicked").lean();
    const shared = [...new Set(clicks.map((c) => parseSize(c.productName)).filter(Boolean))];
    const clicked = [...new Set(clicks.filter((c) => c.clicked).map((c) => parseSize(c.productName)).filter(Boolean))];
    const bought = parseSize(d.sale && d.sale.itemTitle);
    d.linkAudit = {
      sharedProducts: shared.length ? shared : undefined,
      clickedProducts: clicked.length ? clicked : undefined,
      boughtProduct: bought || undefined,
      matchedShared: bought ? shared.includes(bought) : undefined,
      matchedClicked: bought ? clicked.includes(bought) : undefined,
      mismatch: bought && shared.length ? !shared.includes(bought) : undefined,
    };
  }

  console.log(`\n📝 Writing ${finalMatches.length} deduped matches (from ${matched} candidates across ${scanned} convos)...`);

  // fresh rebuild — clear prior matches so re-runs don't leave stale rows
  await ConvoSaleMatch.deleteMany({});
  if (finalMatches.length) {
    const ops = finalMatches.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true } }));
    // chunk to keep bulkWrite payloads reasonable
    for (let i = 0; i < ops.length; i += 1000) {
      await ConvoSaleMatch.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
  }

  // tier breakdown
  const agg = await ConvoSaleMatch.aggregate([
    { $group: { _id: "$certainty", n: { $sum: 1 }, revenue: { $sum: "$sale.totalAmount" } } },
    { $sort: { _id: -1 } },
  ]);
  const s1 = await mongoose.connection.db.stats();
  console.log(`\n✅ Done. ${finalMatches.length} convo↔sale matches in convo_sale_matches.`);
  console.log("   Tier breakdown (certainty → count, revenue):");
  for (const r of agg) console.log(`     ${String(r._id).padStart(3)}% → ${String(r.n).padStart(5)} matches, $${Math.round(r.revenue || 0).toLocaleString("es-MX")}`);
  console.log(`   cluster now ${((s1.dataSize + s1.indexSize) / 1048576).toFixed(0)}MB / 512MB`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("❌ Convo-sale backfill failed:", e);
  process.exit(1);
});
