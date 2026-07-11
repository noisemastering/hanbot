// scripts/backfillMLOrdersRaw.js
//
// One-shot backfill of our first-party RAW copy of ALL Mercado Libre sales data
// into the ml_orders_raw collection (verbatim, the exact schema ML delivers).
//
// Usage:
//   node scripts/backfillMLOrdersRaw.js [sellerId] [startDateISO]
//   node scripts/backfillMLOrdersRaw.js 482595248
//   node scripts/backfillMLOrdersRaw.js 482595248 2018-01-01
//
// Idempotent: re-running upserts/refreshes existing orders.

require("dotenv").config();
const mongoose = require("mongoose");
const { backfillRawOrders } = require("../utils/mlOrderRawImport");
const MLOrderRaw = require("../models/MLOrderRaw");

const SELLER = process.argv[2] || "482595248";
const START = process.argv[3] || null;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`🔗 Mongo connected. Backfilling RAW ML orders for seller ${SELLER}${START ? ` from ${START}` : " (auto-detect earliest)"}...`);

  const t0 = Date.now();
  let lastLog = 0;
  const stats = await backfillRawOrders(SELLER, {
    startDate: START,
    onProgress: (s, label) => {
      const nonEmpty = !label.endsWith("total=0");
      const now = Date.now();
      // Log every non-empty window, plus a heartbeat every ~15s.
      if (nonEmpty || now - lastLog > 15000) {
        lastLog = now;
        console.log(
          `  [${s.windowsDone}/${s.windowsTotal}] ${label} | inserted=${s.inserted} modified=${s.modified} seen=${s.ordersSeen}`
        );
      }
    },
  });

  const count = await MLOrderRaw.countDocuments({ _sellerId: SELLER });
  const paid = await MLOrderRaw.countDocuments({ _sellerId: SELLER, status: "paid" });
  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   Earliest order date: ${stats.earliestDate ? stats.earliestDate.toISOString().slice(0, 10) : "n/a"}`);
  console.log(`   inserted=${stats.inserted}  modified=${stats.modified}  ordersSeen=${stats.ordersSeen}`);
  console.log(`   ml_orders_raw total for seller: ${count} (paid: ${paid})`);
  if (stats.overflowWindows.length) console.log(`   ⚠️ Windows over 10K offset cap:\n     ${stats.overflowWindows.join("\n     ")}`);
  if (stats.errors.length) console.log(`   ⚠️ ${stats.errors.length} errors (first 5):\n     ${stats.errors.slice(0, 5).join("\n     ")}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
