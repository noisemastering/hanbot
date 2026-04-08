#!/usr/bin/env node
// Backfill conversionData.buyerGender on all existing ML sales by running
// detectGender() against the stored buyerFirstName.

require("dotenv").config();
const mongoose = require("mongoose");
const ClickLog = require("../models/ClickLog");
const { detectGender } = require("../utils/genderDetector");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const all = await ClickLog.find({
    "conversionData.buyerFirstName": { $exists: true, $nin: [null, ""] }
  }).select("_id conversionData.buyerFirstName conversionData.buyerGender").lean();

  console.log(`Found ${all.length} ML sales with buyerFirstName`);

  let updated = 0;
  let skipped = 0;
  const breakdown = { male: 0, female: 0, unknown: 0 };
  const ops = [];

  for (const click of all) {
    const gender = detectGender(click.conversionData.buyerFirstName);
    breakdown[gender]++;
    if (click.conversionData.buyerGender === gender) {
      skipped++;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: click._id },
        update: { $set: { "conversionData.buyerGender": gender } }
      }
    });
    if (ops.length >= 500) {
      await ClickLog.bulkWrite(ops);
      updated += ops.length;
      ops.length = 0;
      process.stdout.write(`  ${updated}/${all.length}\r`);
    }
  }

  if (ops.length > 0) {
    await ClickLog.bulkWrite(ops);
    updated += ops.length;
  }

  console.log(`\n✅ Updated ${updated}, skipped ${skipped} (already correct)`);
  console.log(`👨 male:    ${breakdown.male}`);
  console.log(`👩 female:  ${breakdown.female}`);
  console.log(`❓ unknown: ${breakdown.unknown}`);

  await mongoose.disconnect();
}

run().catch(err => { console.error("❌", err); process.exit(1); });
