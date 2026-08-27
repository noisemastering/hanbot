// Import MX zip centroids (lat/lng) into the ZipCode collection.
// Source: GeoNames MX postal export (download.geonames.org/export/zip/MX.zip → MX.txt),
// a tab-separated file: country, zip, place, admin1, admin1_code, admin2, admin2_code,
// admin3, admin3_code, LATITUDE(9), LONGITUDE(10), accuracy.
//
// Usage:
//   node scripts/importZipCentroids.js /path/to/MX.txt          # dry run (coverage only)
//   node scripts/importZipCentroids.js /path/to/MX.txt --write  # apply lat/lng to ZipCode
require("dotenv").config();
const fs = require("fs");
const readline = require("readline");
const mongoose = require("mongoose");

(async () => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const file = args.find((a) => !a.startsWith("--")) || process.env.GEONAMES_MX || "MX.txt";
  if (!fs.existsSync(file)) { console.error("❌ MX.txt not found at:", file); process.exit(1); }

  // Build zip -> averaged centroid (a zip appears once per colonia; coords ~identical).
  const acc = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const f = line.split("\t");
    const zip = (f[1] || "").trim();
    const lat = parseFloat(f[9]), lng = parseFloat(f[10]);
    if (!zip || !isFinite(lat) || !isFinite(lng)) continue;
    const a = acc.get(zip) || { latSum: 0, lngSum: 0, n: 0 };
    a.latSum += lat; a.lngSum += lng; a.n++;
    acc.set(zip, a);
  }
  const centroid = new Map();
  for (const [zip, a] of acc) centroid.set(zip, { lat: +(a.latSum / a.n).toFixed(6), lng: +(a.lngSum / a.n).toFixed(6) });
  console.log("GeoNames unique zips parsed:", centroid.size);

  await mongoose.connect(process.env.MONGODB_URI);
  const ZipCode = require("../models/ZipCode");
  const ours = await ZipCode.find({}).select("code").lean();

  let matched = 0, unmatched = 0;
  const ops = [];
  const missSamples = [];
  for (const z of ours) {
    const code = String(z.code).padStart(5, "0");
    const c = centroid.get(code) || centroid.get(String(z.code));
    if (c) { matched++; ops.push({ updateOne: { filter: { _id: z._id }, update: { $set: { lat: c.lat, lng: c.lng } } } }); }
    else { unmatched++; if (missSamples.length < 8) missSamples.push(z.code); }
  }
  console.log(`our ZipCodes: ${ours.length} | matched: ${matched} (${(matched / ours.length * 100).toFixed(1)}%) | unmatched: ${unmatched}`);
  if (unmatched) console.log("  unmatched samples:", missSamples.join(", "));

  if (!write) { console.log("\nDRY RUN — pass --write to apply."); await mongoose.disconnect(); return; }

  let done = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    await ZipCode.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    done += Math.min(1000, ops.length - i);
    process.stdout.write(`\r  written ${done}/${ops.length}`);
  }
  console.log("\n✅ Zip centroids imported.");
  await mongoose.disconnect();
})();
