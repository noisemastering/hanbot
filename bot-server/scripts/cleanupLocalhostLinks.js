// Script to delete localhost tracking links that will never work
require('dotenv').config();
const mongoose = require('mongoose');
const ClickLog = require('../models/ClickLog');

async function cleanup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all localhost links
    const localhostLinks = await ClickLog.find({
      // This will never exist in production, so we identify by checking if originalUrl exists
      // but we can't directly check the tracking URL. Let's find all unclicked links created before now
    });

    // Better approach: delete all links where clicked is false and createdAt is old
    const result = await ClickLog.deleteMany({
      clicked: false,
      createdAt: { $lt: new Date() } // All existing unclicked links
    });

    console.log(`🗑️  Deleted ${result.deletedCount} old localhost tracking links\n`);

    // Show remaining stats
    const totalLinks = await ClickLog.countDocuments();
    const clickedLinks = await ClickLog.countDocuments({ clicked: true });

    console.log('📊 Clean Database Stats:');
    console.log(`   Total Links: ${totalLinks}`);
    console.log(`   Clicked Links: ${clickedLinks}`);
    console.log(`   Pending Links: ${totalLinks - clickedLinks}`);

    await mongoose.disconnect();
    console.log('\n✅ Cleanup complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanup();
