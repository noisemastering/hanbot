// scripts/deleteUserData.js
// GDPR / Meta data deletion compliance script
//
// Reads a list of Facebook app-scoped user IDs from a file,
// maps them to unified PSIDs (fb:xxx), and anonymizes all records
// while preserving stats and correlated conversion data.
//
// Usage:
//   node bot-server/scripts/deleteUserData.js <file>
//
// The file should contain one user ID per line (plain text or CSV).
// IDs that don't exist in the database are silently skipped.

require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");

const CORRELATION_WINDOW_DAYS = 7;

/**
 * Parse the user IDs file — one ID per line, ignores empty lines and comments
 */
function parseIdFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    // Handle CSV: take first column if comma-separated
    .map(line => line.split(",")[0].trim())
    .filter(Boolean);
}

/**
 * Check if a PSID has uncorrelated clicks within the correlation window
 */
async function hasPendingCorrelation(psid) {
  const windowStart = new Date(Date.now() - CORRELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const pendingClicks = await ClickLog.countDocuments({
    psid,
    clicked: true,
    converted: { $ne: true },
    clickedAt: { $gte: windowStart }
  });

  return pendingClicks > 0;
}

/**
 * Anonymize all data for a given PSID
 */
async function anonymizePsid(psid, anonLabel) {
  const results = { conversations: 0, messages: 0, clickLogs: 0, users: 0 };

  // 1. Anonymize Conversation
  const convoUpdate = await Conversation.updateMany(
    { psid },
    {
      $set: {
        psid: anonLabel,
        city: null,
        stateMx: null,
        zipCode: null,
        "productSpecs.customerName": null,
        "leadData.name": null,
        "leadData.zipcode": null,
        "leadData.location": null,
        "leadData.contact": null,
        "leadData.contactType": null,
        "customOrderZipcode": null,
        "humanSalesZipcode": null,
        "humanSalesNeighborhood": null,
        "humanSalesPendingNeighborhoods": [],
        adHeadline: null,
        adBody: null,
        adSourceUrl: null,
      }
    }
  );
  results.conversations = convoUpdate.modifiedCount;

  // 2. Anonymize Messages — keep text for stats but replace psid
  const msgUpdate = await Message.updateMany(
    { psid },
    { $set: { psid: anonLabel } }
  );
  results.messages = msgUpdate.modifiedCount;

  // 3. Anonymize ClickLogs — keep conversion data but strip PII
  const clickUpdate = await ClickLog.updateMany(
    { psid },
    {
      $set: {
        psid: anonLabel,
        userName: null,
        city: null,
        stateMx: null,
        ipAddress: null,
        userAgent: null,
        referrer: null,
        // Clear buyer PII from conversion snapshots but keep amounts/product
        "conversionData.buyerId": null,
        "conversionData.buyerNickname": null,
        "conversionData.buyerFirstName": null,
        "conversionData.buyerLastName": null,
        "conversionData.shippingCity": null,
        "conversionData.shippingState": null,
        "conversionData.shippingZipCode": null,
      }
    }
  );
  results.clickLogs = clickUpdate.modifiedCount;

  // 4. Delete User record entirely (profile pic, name, location)
  const userDelete = await User.deleteMany({
    $or: [
      { unifiedId: psid },
      { psid: psid.replace("fb:", "") },
      { whatsappPhone: psid.replace("wa:", "") }
    ]
  });
  results.users = userDelete.deletedCount;

  return results;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node bot-server/scripts/deleteUserData.js <id-file>");
    console.error("  File should contain one Facebook app-scoped user ID per line.");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const rawIds = parseIdFile(resolvedPath);
  console.log(`\n📋 Loaded ${rawIds.length} user ID(s) from ${path.basename(resolvedPath)}`);

  if (rawIds.length === 0) {
    console.log("No IDs to process. Exiting.");
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  let processed = 0;
  let skipped = 0;
  let notFound = 0;
  let deferred = 0;
  const deferredIds = [];

  for (const rawId of rawIds) {
    // Facebook app-scoped IDs are stored as fb:xxx in our unified format
    // Try both fb:xxx and the raw ID (legacy conversations before unification)
    const possiblePsids = [`fb:${rawId}`, rawId];

    // Find which PSID exists in our DB
    let foundPsid = null;
    for (const candidate of possiblePsids) {
      const exists = await Conversation.exists({ psid: candidate });
      if (exists) {
        foundPsid = candidate;
        break;
      }
    }

    if (!foundPsid) {
      // Check ClickLog and User too — might have clicks but no conversation
      for (const candidate of possiblePsids) {
        const clickExists = await ClickLog.exists({ psid: candidate });
        const userExists = await User.exists({
          $or: [{ unifiedId: candidate }, { psid: rawId }]
        });
        if (clickExists || userExists) {
          foundPsid = candidate;
          break;
        }
      }
    }

    if (!foundPsid) {
      notFound++;
      continue;
    }

    // Check for pending correlations
    const pending = await hasPendingCorrelation(foundPsid);
    if (pending) {
      console.log(`⏳ ${foundPsid} — has uncorrelated clicks within ${CORRELATION_WINDOW_DAYS}-day window, deferring`);
      deferredIds.push(rawId);
      deferred++;
      continue;
    }

    // Anonymize
    const anonLabel = `deleted_${String(processed + 1).padStart(4, "0")}`;
    const results = await anonymizePsid(foundPsid, anonLabel);

    console.log(
      `✅ ${foundPsid} → ${anonLabel} — ` +
      `${results.conversations} convo, ${results.messages} msgs, ` +
      `${results.clickLogs} clicks, ${results.users} user`
    );

    processed++;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   Anonymized: ${processed}`);
  console.log(`   Not in DB:  ${notFound} (no action needed)`);
  console.log(`   Deferred:   ${deferred} (pending correlation window)`);
  console.log(`   Total:      ${rawIds.length}`);

  if (deferredIds.length > 0) {
    const deferredFile = resolvedPath.replace(/(\.\w+)?$/, "_deferred$1");
    fs.writeFileSync(deferredFile, deferredIds.join("\n") + "\n");
    console.log(`\n⏳ Deferred IDs written to: ${path.basename(deferredFile)}`);
    console.log(`   Re-run this script with that file after ${CORRELATION_WINDOW_DAYS} days.`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
