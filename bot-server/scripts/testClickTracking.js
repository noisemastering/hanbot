// Script to test click tracking system
require('dotenv').config();
const mongoose = require('mongoose');
const ClickLog = require('../models/ClickLog');

async function testTracking() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get recent click logs
    const recentLogs = await ClickLog.find()
      .sort({ createdAt: -1 })
      .limit(5);

    console.log('📊 Recent Click Logs:\n');
    recentLogs.forEach((log, idx) => {
      console.log(`${idx + 1}. Click ID: ${log.clickId}`);
      console.log(`   PSID: ${log.psid}`);
      console.log(`   Product: ${log.productName}`);
      console.log(`   Original URL: ${log.originalUrl}`);
      console.log(`   Clicked: ${log.clicked ? '✅ YES' : '❌ NO'}`);
      if (log.clicked) {
        console.log(`   Clicked At: ${log.clickedAt}`);
      }
      console.log(`   Created: ${log.createdAt}\n`);
    });

    // Get stats
    const totalLinks = await ClickLog.countDocuments();
    const clickedLinks = await ClickLog.countDocuments({ clicked: true });
    const convertedLinks = await ClickLog.countDocuments({ converted: true });

    console.log('📈 Statistics:');
    console.log(`   Total Links Generated: ${totalLinks}`);
    console.log(`   Links Clicked: ${clickedLinks}`);
    console.log(`   Links Converted: ${convertedLinks}`);
    console.log(`   Click Rate: ${totalLinks > 0 ? ((clickedLinks / totalLinks) * 100).toFixed(2) : 0}%`);
    console.log(`   Conversion Rate: ${clickedLinks > 0 ? ((convertedLinks / clickedLinks) * 100).toFixed(2) : 0}%\n`);

    // Check BASE_URL configuration
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    console.log(`🔗 Configured BASE_URL: ${baseUrl}`);

    if (recentLogs.length > 0) {
      const exampleLink = `${baseUrl}/r/${recentLogs[0].clickId}`;
      console.log(`\n🧪 Example tracking link: ${exampleLink}`);
      console.log(`   Original destination: ${recentLogs[0].originalUrl}`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testTracking();
