// scripts/backfillMLSalesLean.js
//
// Backfill the lean first-party sales store (ml_sales): one doc per ML order
// with the ship-to address (zip/city/state/street/receiver) merged in.
//
// Usage:
//   node scripts/backfillMLSalesLean.js [sellerId] [startDateISO]
//   node scripts/backfillMLSalesLean.js 482595248 2025-12-01
//
// Idempotent + storage-guarded (aborts before the 512MB cluster cap).

require("dotenv").config();
const mongoose = require("mongoose");
const { backfillLeanSales } = require("../utils/mlSalesLeanImport");
const MLSale = require("../models/MLSale");

const SELLER = process.argv[2] || "482595248";
const START = process.argv[3] || "2025-12-01";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const s0 = await mongoose.connection.db.stats();
  console.log(`🔗 Mongo connected. Cluster at ${((s0.dataSize + s0.indexSize) / 1048576).toFixed(0)}MB / 512MB`);
  console.log(`📦 Backfilling LEAN sales for seller ${SELLER} from ${START}...`);

  const t0 = Date.now();
  let last = 0;
  const stats = await backfillLeanSales(SELLER, {
    startDate: START,
    concurrency: 6,
    onProgress: (s, label) => {
      const now = Date.now();
      if (now - last > 8000 || s.windowsDone === s.windowsTotal) {
        last = now;
        console.log(`  [${s.windowsDone}/${s.windowsTotal}] ${label} | orders=${s.orders} ship=${s.shipmentsFetched} zip=${s.withZip} upserted=${s.upserted}`);
      }
    },
  });

  const count = await MLSale.countDocuments({ sellerId: SELLER });
  const withZip = await MLSale.countDocuments({ sellerId: SELLER, "shipping.zip": { $ne: null } });
  const s1 = await mongoose.connection.db.stats();
  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   orders=${stats.orders}  shipmentsFetched=${stats.shipmentsFetched}  shipmentsFailed=${stats.shipmentsFailed}`);
  console.log(`   ml_sales docs=${count}  withZip=${withZip}`);
  console.log(`   cluster now ${((s1.dataSize + s1.indexSize) / 1048576).toFixed(0)}MB / 512MB`);
  if (stats.aborted) console.log(`   ⚠️ ABORTED: ${stats.aborted}`);
  if (stats.errors.length) console.log(`   ⚠️ ${stats.errors.length} errors (first 5):\n     ${stats.errors.slice(0, 5).join("\n     ")}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("❌ Lean backfill failed:", e);
  process.exit(1);
});
