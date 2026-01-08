const axios = require('axios');

async function testCorrelation() {
  console.log('🧪 Testing Conversion Correlation\n');

  try {
    // First, check current conversion stats
    console.log('1️⃣  Checking current conversion stats...');
    const statsRes = await axios.get('http://localhost:3000/analytics/conversions');
    console.log('📊 Current stats:', JSON.stringify(statsRes.data.stats, null, 2));

    // Run correlation (dry run first)
    console.log('\n2️⃣  Running correlation (DRY RUN)...');
    const dryRunRes = await axios.post(
      'http://localhost:3000/analytics/correlate-conversions',
      {
        sellerId: '482595248',
        timeWindowHours: 48,
        orderLimit: 20,
        dryRun: true
      }
    );

    console.log('\n📋 Dry run results:');
    console.log('   Orders processed:', dryRunRes.data.ordersProcessed);
    console.log('   Orders with clicks:', dryRunRes.data.ordersWithClicks);
    console.log('   Would correlate:', dryRunRes.data.correlations?.length || 0, 'clicks');

    if (dryRunRes.data.correlations?.length > 0) {
      console.log('\n   Sample correlations:');
      dryRunRes.data.correlations.slice(0, 5).forEach((c, i) => {
        console.log('\n   ' + (i + 1) + '. PSID: ' + c.psid);
        console.log('      Product: ' + c.productName);
        console.log('      Clicked: ' + c.clickedAt);
        console.log('      Order: ' + c.orderId);
        console.log('      Buyer: ' + c.buyerNickname);
        console.log('      Amount: $' + c.totalAmount);
        console.log('      Confidence: ' + c.confidence);
        console.log('      Time to purchase: ' + c.timeBetweenClickAndPurchase + ' min');
      });
    } else {
      console.log('\n   ⚠️ No matching clicks found.');
      console.log('   This could mean:');
      console.log('   - ClickLogs dont have productId matching ML item IDs');
      console.log('   - Clicks happened more than 48 hours before orders');
      console.log('   - Orders have different products than what was clicked');
    }

    // Run for real if matches found
    if (dryRunRes.data.ordersWithClicks > 0) {
      console.log('\n3️⃣  Running correlation FOR REAL...');
      const realRunRes = await axios.post(
        'http://localhost:3000/analytics/correlate-conversions',
        {
          sellerId: '482595248',
          timeWindowHours: 48,
          orderLimit: 20,
          dryRun: false
        }
      );

      console.log('\n✅ Real run results:');
      console.log('   Clicks correlated:', realRunRes.data.clicksCorrelated);

      // Check updated stats
      console.log('\n4️⃣  Updated conversion stats:');
      const newStatsRes = await axios.get('http://localhost:3000/analytics/conversions');
      console.log(JSON.stringify(newStatsRes.data.stats, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testCorrelation();
