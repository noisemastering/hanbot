require("dotenv").config();
const mongoose = require("mongoose");
const { backfillLeanSales } = require("./utils/mlSalesLeanImport");
const MLSale = require("./models/MLSale");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const before = await MLSale.countDocuments({ sellerId:"482595248" });
  const stats = await backfillLeanSales("482595248", {
    startDate: "2025-11-01T00:00:00.000Z", endDate: "2025-12-01T00:00:00.000Z", concurrency: 6,
    onProgress: (s, label) => console.log(`  [${s.windowsDone}/${s.windowsTotal}] ${label} | orders=${s.orders} zip=${s.withZip}`),
  });
  const after = await MLSale.countDocuments({ sellerId:"482595248" });
  const nov = await MLSale.countDocuments({ sellerId:"482595248", dateCreated: { $gte: new Date("2025-11-01"), $lt: new Date("2025-12-01") } });
  const oldest = await MLSale.find({sellerId:"482595248"}).sort({dateCreated:1}).limit(1).select("dateCreated").lean();
  const s = await mongoose.connection.db.stats();
  console.log(`\n✅ Nov backfill done. orders=${stats.orders} ship=${stats.shipmentsFetched} zip=${stats.withZip}`);
  console.log(`ml_sales: ${before} → ${after} | Nov 2025 docs: ${nov} | covers from ${oldest[0]&&oldest[0].dateCreated.toISOString().slice(0,10)} | cluster ${((s.dataSize+s.indexSize)/1048576).toFixed(0)}MB`);
  await mongoose.disconnect(); process.exit(0);
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
