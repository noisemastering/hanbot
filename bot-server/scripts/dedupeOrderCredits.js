// scripts/dedupeOrderCredits.js
//
// One-time, idempotent backfill: enforce ONE ML order → ONE converted click on
// EXISTING data. A popular/hero listing can match several clicks for the same
// order; only the single best-matching click should be credited. The rest are
// released to a plain (clicked, not converted) state so one sale isn't counted
// against multiple people. Mirrors conversionCorrelation.demoteOtherClicksForOrder.
//
// Reporting impact is small/surgical: only DUPLICATE credits are removed — real
// 1:1 conversions (the vast majority) are untouched.
//
// Usage:
//   node scripts/dedupeOrderCredits.js           # DRY RUN
//   node scripts/dedupeOrderCredits.js --apply    # release duplicates
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

// Score a click by its stored matchDetails — higher = stronger match. Used only
// to pick which click keeps the credit when several share one order.
function scoreOf(md = {}) {
  let s = 0;
  if (md.mlItemMatch) s += 100;
  if (md.nameMatch) s += 40;
  if (md.nicknameMatch) s += 35;
  if (md.zipMatch) s += 45;
  if (md.cityMatch) s += 35;
  if (md.stateMatch) s += 25;
  if (md.poiMatch) s += 30;
  s += md.timeScore || 0;
  return s;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const ClickLog = require("../models/ClickLog");

  // Orders credited to more than one converted click.
  const dupes = await ClickLog.aggregate([
    { $match: { converted: true, correlatedOrderId: { $ne: null } } },
    { $group: { _id: "$correlatedOrderId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);

  let ordersAffected = 0;
  let creditsReleased = 0;
  const samples = [];

  for (const d of dupes) {
    const orderId = d._id;
    const clicks = await ClickLog.find({ converted: true, correlatedOrderId: orderId })
      .select("clickId psid matchDetails clickedAt convertedAt conversionData.itemTitle")
      .lean();
    if (clicks.length <= 1) continue;

    // Keep the highest-scoring click; tie-break by most recent click.
    clicks.sort((a, b) => {
      const ds = scoreOf(b.matchDetails) - scoreOf(a.matchDetails);
      if (ds !== 0) return ds;
      return new Date(b.clickedAt || 0) - new Date(a.clickedAt || 0);
    });
    const keep = clicks[0];
    const release = clicks.slice(1);

    ordersAffected++;
    creditsReleased += release.length;
    if (samples.length < 8) {
      samples.push(`order ${orderId}: kept ${keep.clickId} (score ${scoreOf(keep.matchDetails)}), released ${release.map((r) => r.clickId).join(", ")} | ${keep.conversionData?.itemTitle || ""}`);
    }

    if (APPLY) {
      await ClickLog.updateMany(
        { _id: { $in: release.map((r) => r._id) } },
        { $set: { converted: false, convertedAt: null, correlatedOrderId: null, correlationConfidence: null, correlationMethod: null } }
      );
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}`);
  console.log(`orders with duplicate credits: ${ordersAffected}`);
  console.log(`duplicate click credits ${APPLY ? "released" : "that would be released"}: ${creditsReleased}`);
  console.log("\nsamples:");
  samples.forEach((s) => console.log("  - " + s));

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
