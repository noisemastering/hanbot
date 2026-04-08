// scripts/dedupClickLogs.js
// One-shot cleanup: remove duplicate ClickLogs created by the
// generateClickLink-on-every-message bug.
//
// For each (psid, originalUrl) group:
//   - Keep the most recent UNCLICKED record (it's the URL the customer
//     last received and could still click)
//   - Keep ALL clicked records (they represent real customer activity)
//   - Delete the older unclicked records
//
// Skip direct_ad records (psid is null by design, one per click).
//
// Usage:
//   node scripts/dedupClickLogs.js --dry-run    # show what would be deleted
//   node scripts/dedupClickLogs.js              # actually delete

require('dotenv').config();
const mongoose = require('mongoose');
const ClickLog = require('../models/ClickLog');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Deduping ClickLogs...\n`);

  // Group unclicked ClickLogs by (psid, originalUrl). Skip direct_ad and null psid.
  const pipeline = [
    {
      $match: {
        psid: { $ne: null, $exists: true },
        originalUrl: { $ne: null, $exists: true },
        source: { $ne: 'direct_ad' },
        clicked: { $ne: true }
      }
    },
    {
      $group: {
        _id: { psid: '$psid', originalUrl: '$originalUrl' },
        count: { $sum: 1 },
        ids: { $push: { id: '$_id', createdAt: '$createdAt' } }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ];

  const groups = await ClickLog.aggregate(pipeline).allowDiskUse(true);

  let totalDuplicates = 0;
  let groupsAffected = 0;
  const idsToDelete = [];

  for (const group of groups) {
    // Sort newest → oldest
    group.ids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // Keep the newest, delete the rest
    const keep = group.ids[0];
    const drop = group.ids.slice(1);
    totalDuplicates += drop.length;
    groupsAffected++;
    for (const d of drop) idsToDelete.push(d.id);
  }

  console.log(`Groups with duplicates (psid + url): ${groupsAffected}`);
  console.log(`Stale unclicked duplicates to delete: ${totalDuplicates}`);
  console.log(`Total unique (psid, url) pairs preserved: ${groupsAffected}`);
  console.log(`(plus any clicked records, which are never touched)\n`);

  if (groupsAffected > 0) {
    // Show a few sample groups for sanity-check
    console.log('Sample groups:');
    for (const g of groups.slice(0, 5)) {
      console.log(`  psid=${g._id.psid.slice(0, 8)}... url=${g._id.originalUrl.slice(0, 60)}... count=${g.count}`);
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] No data deleted. Re-run without --dry-run to delete.');
  } else if (idsToDelete.length > 0) {
    // Delete in batches of 1000 to avoid huge single ops
    const batchSize = 1000;
    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      const result = await ClickLog.deleteMany({ _id: { $in: batch } });
      deleted += result.deletedCount;
    }
    console.log(`Deleted ${deleted} stale ClickLog records.`);
  } else {
    console.log('Nothing to delete.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
