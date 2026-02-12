// scripts/runCorrelation.js
// Fast correlation: matches orders to click logs by ML Item ID
// Skips Shipment API call for item-match correlations (100+ point matches)
const mongoose = require('mongoose');
require('dotenv').config();

async function runCorrelation() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { getOrders } = require('../utils/mercadoLibreOrders');
  const ClickLog = require('../models/ClickLog');
  const User = require('../models/User');

  const sellerId = '482595248'; // HANLOB
  const ML_MAX_OFFSET = 10000;

  // Step 1: Load all real clicks with ML Item IDs
  const clicksWithItems = await ClickLog.find({
    clicked: true,
    mlItemId: { $exists: true, $ne: null }
  }).lean();

  // Build lookup: mlItemId → [clicks]
  const itemToClicks = {};
  for (const click of clicksWithItems) {
    if (!itemToClicks[click.mlItemId]) itemToClicks[click.mlItemId] = [];
    itemToClicks[click.mlItemId].push(click);
  }

  const trackedItems = Object.keys(itemToClicks);
  console.log(`🔗 Tracked ML items: ${trackedItems.length}`);
  console.log(`   Total clicks with items: ${clicksWithItems.length}`);

  // Step 2: Load all already-correlated order IDs
  const alreadyCorrelated = new Set();
  const existingCorrelations = await ClickLog.find({ converted: true }).select('correlatedOrderId conversionData.orderId').lean();
  for (const c of existingCorrelations) {
    if (c.correlatedOrderId) alreadyCorrelated.add(String(c.correlatedOrderId));
    if (c.conversionData?.orderId) alreadyCorrelated.add(String(c.conversionData.orderId));
  }
  console.log(`   Already correlated orders: ${alreadyCorrelated.size}`);

  // Step 3: Fetch orders and correlate on-the-fly
  const earliestClick = await ClickLog.findOne({ clicked: true }).sort({ clickedAt: 1 }).lean();
  const startDate = new Date(earliestClick.clickedAt);
  const endDate = new Date();

  console.log(`📅 Scanning orders from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  let totalFetched = 0;
  let totalCandidates = 0;
  let newCorrelations = 0;
  let skippedExisting = 0;
  let noClickMatch = 0;
  let offset = 0;
  const limit = 50;
  const correlationDetails = [];

  while (offset < ML_MAX_OFFSET) {
    const result = await getOrders(sellerId, {
      dateFrom: startDate.toISOString().replace('Z', '-00:00'),
      dateTo: endDate.toISOString().replace('Z', '-00:00'),
      limit,
      offset
    });

    if (!result.success || !result.orders || result.orders.length === 0) break;
    totalFetched += result.orders.length;

    for (const order of result.orders) {
      if (order.status !== 'paid') continue;

      // Check if any order item matches a tracked ML item
      const orderItemIds = (order.order_items || []).map(i => i.item && i.item.id).filter(Boolean);
      const matchingItemId = orderItemIds.find(id => itemToClicks[id]);
      if (!matchingItemId) continue;

      totalCandidates++;

      // Check if already correlated
      const orderId = String(order.id);
      if (alreadyCorrelated.has(orderId)) {
        skippedExisting++;
        continue;
      }

      // Find the best click for this order
      const possibleClicks = itemToClicks[matchingItemId];
      const orderDate = new Date(order.date_created);

      // Find click closest to the order date, within 7 days before the order
      let bestClick = null;
      let bestHoursAgo = Infinity;

      for (const click of possibleClicks) {
        const clickDate = new Date(click.clickedAt);
        const hoursAgo = (orderDate - clickDate) / (1000 * 60 * 60);
        // Click must be BEFORE the order, within 7 days
        if (hoursAgo >= 0 && hoursAgo <= 168 && hoursAgo < bestHoursAgo) {
          bestClick = click;
          bestHoursAgo = hoursAgo;
        }
      }

      if (!bestClick) {
        noClickMatch++;
        continue;
      }

      // Check if this click is already used for another order
      if (bestClick.converted) {
        noClickMatch++;
        continue;
      }

      // Determine confidence
      let timeScore = 5;
      if (bestHoursAgo <= 24) timeScore = 20;
      else if (bestHoursAgo <= 72) timeScore = 10;
      const totalScore = 100 + timeScore; // ML Item match (100) + time

      const confidence = totalScore >= 130 ? 'high' : 'medium';

      // Save correlation
      const firstItem = order.order_items[0];
      await ClickLog.findByIdAndUpdate(bestClick._id, {
        converted: true,
        convertedAt: new Date(),
        correlatedOrderId: orderId,
        correlationConfidence: confidence,
        correlationMethod: 'ml_item_match',
        matchDetails: {
          mlItemMatch: true,
          nameMatch: false,
          cityMatch: false,
          stateMatch: false,
          zipMatch: false,
          poiMatch: false,
          timeScore: timeScore,
          hoursAgo: Math.round(bestHoursAgo * 10) / 10
        },
        conversionData: {
          orderId: orderId,
          orderStatus: order.status,
          buyerId: order.buyer?.id ? String(order.buyer.id) : null,
          buyerNickname: order.buyer?.nickname,
          totalAmount: order.total_amount,
          paidAmount: order.paid_amount,
          currency: order.currency_id,
          orderDate: orderDate,
          itemTitle: firstItem?.item?.title,
          itemQuantity: firstItem?.quantity
        }
      });

      alreadyCorrelated.add(orderId);
      newCorrelations++;
      correlationDetails.push({
        orderId: order.id,
        clickId: bestClick.clickId,
        item: matchingItemId,
        confidence,
        hoursAgo: Math.round(bestHoursAgo * 10) / 10,
        amount: order.total_amount
      });

      console.log(`   ✅ Order ${order.id} → Click ${bestClick.clickId} (${confidence}, ${Math.round(bestHoursAgo)}h ago, $${order.total_amount})`);
    }

    const total = result.paging && result.paging.total ? result.paging.total : '?';
    const cappedTotal = Math.min(Number(total) || ML_MAX_OFFSET, ML_MAX_OFFSET);
    process.stdout.write(`\r  📦 ${totalFetched}/${cappedTotal} orders | ${totalCandidates} candidates | ${newCorrelations} new correlations`);

    if (result.paging && totalFetched >= result.paging.total) break;
    offset += limit;

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n✅ Correlation Complete:`);
  console.log(`   Orders scanned: ${totalFetched}`);
  console.log(`   Candidates (matching ML items): ${totalCandidates}`);
  console.log(`   Already correlated: ${skippedExisting}`);
  console.log(`   New correlations: ${newCorrelations}`);
  console.log(`   No click match (wrong timing): ${noClickMatch}`);

  if (correlationDetails.length > 0) {
    console.log(`\n📋 New correlations:`);
    for (const d of correlationDetails) {
      console.log(`   Order ${d.orderId} → ${d.clickId} | ${d.item} | ${d.confidence} | ${d.hoursAgo}h | $${d.amount}`);
    }
  }

  // Final stats
  const finalCorrelated = await ClickLog.countDocuments({ converted: true });
  const byMethod = await ClickLog.aggregate([
    { $match: { converted: true } },
    { $group: { _id: '$correlationMethod', count: { $sum: 1 } } }
  ]);
  const totalRevenue = await ClickLog.aggregate([
    { $match: { converted: true } },
    { $group: { _id: null, total: { $sum: '$conversionData.totalAmount' } } }
  ]);

  console.log(`\n📊 Final stats:`);
  console.log(`   Total correlations: ${finalCorrelated}`);
  for (const m of byMethod) {
    console.log(`   ${m._id}: ${m.count}`);
  }
  if (totalRevenue[0]) {
    console.log(`   Total correlated revenue: $${totalRevenue[0].total.toLocaleString()}`);
  }

  await mongoose.disconnect();
}

runCorrelation().catch(e => { console.error(e); process.exit(1); });
