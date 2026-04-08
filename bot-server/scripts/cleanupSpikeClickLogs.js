// scripts/cleanupSpikeClickLogs.js
// One-shot cleanup: delete the unclicked ClickLogs created by the
// "mint N tracked links per multi-product sales call" bug on Apr 6 and Apr 7.
//
// Preserves all CLICKED records (real customer activity) and direct_ad records.
//
// Usage:
//   node scripts/cleanupSpikeClickLogs.js --dry-run
//   node scripts/cleanupSpikeClickLogs.js

require('dotenv').config();
const mongoose = require('mongoose');
const ClickLog = require('../models/ClickLog');

const DRY_RUN = process.argv.includes('--dry-run');

// Mexico City is UTC-6.
const FROM = new Date('2026-04-06T06:00:00Z'); // Apr 6 00:00 Mexico time
const TO   = new Date('2026-04-08T06:00:00Z'); // Apr 8 00:00 Mexico time

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Cleanup spike ClickLogs Apr 6-7 (Mexico time)\n`);

  const filter = {
    createdAt: { $gte: FROM, $lt: TO },
    source: { $ne: 'direct_ad' },
    clicked: { $ne: true }
  };

  const total = await ClickLog.countDocuments({ createdAt: { $gte: FROM, $lt: TO }, source: { $ne: 'direct_ad' } });
  const clicked = await ClickLog.countDocuments({ createdAt: { $gte: FROM, $lt: TO }, source: { $ne: 'direct_ad' }, clicked: true });
  const toDelete = total - clicked;

  console.log(`In window — total: ${total}, clicked (preserved): ${clicked}, unclicked (to delete): ${toDelete}`);

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] No data deleted.`);
  } else if (toDelete > 0) {
    const result = await ClickLog.deleteMany(filter);
    console.log(`\nDeleted ${result.deletedCount} unclicked records from Apr 6-7.`);
  } else {
    console.log(`\nNothing to delete.`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
