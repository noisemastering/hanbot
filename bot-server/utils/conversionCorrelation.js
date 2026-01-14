// utils/conversionCorrelation.js
const ClickLog = require("../models/ClickLog");
const { getOrders, getShipmentById } = require("./mercadoLibreOrders");

/**
 * Extract ML item ID from various URL formats
 * Examples:
 *   - https://articulo.mercadolibre.com.mx/MLM-123456789
 *   - https://www.mercadolibre.com.mx/p/MLM123456789
 *   - MLM123456789
 */
function extractMLItemId(url) {
  if (!url) return null;

  // Pattern: MLM followed by digits (with or without dash)
  const match = url.match(/MLM[-]?(\d+)/i);
  if (match) {
    return `MLM${match[1]}`;
  }
  return null;
}

/**
 * Correlate clicks to ML orders using time-based matching
 *
 * @param {string} sellerId - ML seller ID (e.g., "482595248")
 * @param {object} options - Correlation options
 * @param {number} options.timeWindowHours - Hours before purchase to look for clicks (default: 48)
 * @param {number} options.orderLimit - Max orders to process (default: 100)
 * @param {boolean} options.dryRun - If true, don't save changes (default: false)
 * @returns {Promise<object>} Correlation results
 */
async function correlateClicksToOrders(sellerId, options = {}) {
  const {
    timeWindowHours = 48,
    orderLimit = 100,
    dryRun = false
  } = options;

  console.log(`\n🔗 Starting time-based correlation for seller ${sellerId}`);
  console.log(`   Time window: ${timeWindowHours} hours before purchase`);
  console.log(`   Order limit: ${orderLimit}`);
  console.log(`   Dry run: ${dryRun}`);

  const results = {
    ordersProcessed: 0,
    ordersWithClicks: 0,
    clicksCorrelated: 0,
    correlations: [],
    errors: []
  };

  try {
    // Fetch recent orders from ML
    console.log(`\n📦 Fetching orders from Mercado Libre...`);
    const ordersResponse = await getOrders(sellerId, {
      sort: "date_desc",
      limit: orderLimit
    });

    if (!ordersResponse.success || !ordersResponse.orders?.length) {
      console.log(`⚠️ No orders found for seller ${sellerId}`);
      return results;
    }

    const orders = ordersResponse.orders;
    console.log(`✅ Fetched ${orders.length} orders`);

    // Process each order
    for (const order of orders) {
      results.ordersProcessed++;

      const orderId = order.id;
      const orderDate = new Date(order.date_created);
      const timeWindowStart = new Date(orderDate.getTime() - (timeWindowHours * 60 * 60 * 1000));

      // Get all product IDs from this order
      const orderProductIds = (order.order_items || [])
        .map(item => item.item?.id)
        .filter(Boolean);

      if (orderProductIds.length === 0) {
        continue;
      }

      console.log(`\n📋 Order ${orderId}:`);
      console.log(`   Date: ${orderDate.toISOString()}`);
      console.log(`   Products: ${orderProductIds.join(', ')}`);
      console.log(`   Looking for clicks between ${timeWindowStart.toISOString()} and ${orderDate.toISOString()}`);

      // Find clicks that match any product in this order
      // AND were clicked within the time window before purchase
      // AND haven't already been correlated to another order
      const matchingClicks = await ClickLog.find({
        clicked: true,
        correlatedOrderId: { $exists: false },
        clickedAt: {
          $gte: timeWindowStart,
          $lte: orderDate
        },
        $or: [
          // Match by productId field directly
          { productId: { $in: orderProductIds } },
          // Match by extracting ID from originalUrl
          ...orderProductIds.map(pid => ({
            originalUrl: { $regex: pid.replace('MLM', 'MLM[-]?'), $options: 'i' }
          }))
        ]
      }).sort({ clickedAt: -1 });

      if (matchingClicks.length === 0) {
        console.log(`   ❌ No matching clicks found`);
        continue;
      }

      results.ordersWithClicks++;
      console.log(`   ✅ Found ${matchingClicks.length} matching click(s)`);

      // Calculate confidence based on number of matching clicks
      // 1 click = high confidence (likely this person bought)
      // 2-3 clicks = medium confidence (could be any of them)
      // 4+ clicks = low confidence (hard to attribute)
      const confidence = matchingClicks.length === 1 ? 'high' :
                        matchingClicks.length <= 3 ? 'medium' : 'low';

      // Get order item details for the first matching product
      const matchedItem = order.order_items.find(item =>
        orderProductIds.includes(item.item?.id)
      );

      // Correlate the most recent click (most likely the converter)
      const clickToCorrelate = matchingClicks[0];

      const correlationData = {
        clickId: clickToCorrelate.clickId,
        psid: clickToCorrelate.psid,
        productId: clickToCorrelate.productId,
        productName: clickToCorrelate.productName,
        clickedAt: clickToCorrelate.clickedAt,
        orderId: orderId,
        orderDate: orderDate,
        buyerNickname: order.buyer?.nickname,
        totalAmount: order.total_amount,
        confidence,
        matchingClicksCount: matchingClicks.length,
        timeBetweenClickAndPurchase: Math.round((orderDate - clickToCorrelate.clickedAt) / 60000) // minutes
      };

      results.correlations.push(correlationData);

      console.log(`   🎯 Correlating click ${clickToCorrelate.clickId} (PSID: ${clickToCorrelate.psid})`);
      console.log(`   📊 Confidence: ${confidence} (${matchingClicks.length} matching clicks)`);
      console.log(`   ⏱️ Time to purchase: ${correlationData.timeBetweenClickAndPurchase} minutes`);

      if (!dryRun) {
        // Fetch shipping address if shipment ID is available
        let shippingData = {};
        if (order.shipping?.id) {
          console.log(`   📍 Fetching shipping address for shipment ${order.shipping.id}...`);
          const shipmentResult = await getShipmentById(sellerId, order.shipping.id);
          if (shipmentResult.success) {
            shippingData = {
              shippingCity: shipmentResult.shipment.receiverAddress.city,
              shippingState: shipmentResult.shipment.receiverAddress.state,
              shippingZipCode: shipmentResult.shipment.receiverAddress.zipCode
            };
            console.log(`   📍 Shipping to: ${shippingData.shippingCity}, ${shippingData.shippingState} (${shippingData.shippingZipCode})`);
          } else {
            console.log(`   ⚠️ Could not fetch shipping address: ${shipmentResult.error}`);
          }
        }

        // Update the click with conversion data
        await ClickLog.findByIdAndUpdate(clickToCorrelate._id, {
          converted: true,
          convertedAt: orderDate,
          correlatedOrderId: orderId,
          correlationConfidence: confidence,
          correlationMethod: 'time_based',
          conversionData: {
            orderId: orderId,
            orderStatus: order.status,
            buyerId: order.buyer?.id,
            buyerNickname: order.buyer?.nickname,
            buyerFirstName: order.buyer?.first_name,
            buyerLastName: order.buyer?.last_name,
            totalAmount: order.total_amount,
            paidAmount: order.paid_amount,
            currency: order.currency_id,
            orderDate: orderDate,
            itemTitle: matchedItem?.item?.title,
            itemQuantity: matchedItem?.quantity,
            ...shippingData
          }
        });

        results.clicksCorrelated++;
        console.log(`   ✅ Click marked as converted`);
      } else {
        console.log(`   🔍 [DRY RUN] Would mark click as converted`);
      }
    }

    // Summary
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 CORRELATION SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Orders processed: ${results.ordersProcessed}`);
    console.log(`   Orders with matching clicks: ${results.ordersWithClicks}`);
    console.log(`   Clicks correlated: ${results.clicksCorrelated}`);
    console.log(`   Correlation rate: ${results.ordersProcessed > 0 ? ((results.ordersWithClicks / results.ordersProcessed) * 100).toFixed(1) : 0}%`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return results;

  } catch (error) {
    console.error(`❌ Error during correlation:`, error);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Get conversion statistics
 * @param {object} options - Filter options
 * @param {Date|string} options.dateFrom - Start date filter
 * @param {Date|string} options.dateTo - End date filter
 */
async function getConversionStats(options = {}) {
  const { dateFrom, dateTo } = options;

  // Build date filter for link creation (based on createdAt)
  // All metrics use createdAt for consistency - we're measuring links created in period
  const createdAtFilter = {};
  if (dateFrom || dateTo) {
    createdAtFilter.createdAt = {};
    if (dateFrom) createdAtFilter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) createdAtFilter.createdAt.$lte = new Date(dateTo);
  }

  const [
    totalLinks,
    clickedLinks,
    conversions,
    highConfidence,
    mediumConfidence,
    lowConfidence
  ] = await Promise.all([
    ClickLog.countDocuments(createdAtFilter),
    ClickLog.countDocuments({ clicked: true, ...createdAtFilter }),
    ClickLog.countDocuments({ converted: true, ...createdAtFilter }),
    ClickLog.countDocuments({ converted: true, correlationConfidence: 'high', ...createdAtFilter }),
    ClickLog.countDocuments({ converted: true, correlationConfidence: 'medium', ...createdAtFilter }),
    ClickLog.countDocuments({ converted: true, correlationConfidence: 'low', ...createdAtFilter })
  ]);

  // Get total revenue from UNIQUE orders only (same order can be linked to multiple clicks)
  // Filter by convertedAt (order date), not createdAt (link creation date)
  const revenueDateFilter = {};
  if (dateFrom || dateTo) {
    revenueDateFilter.convertedAt = {};
    if (dateFrom) revenueDateFilter.convertedAt.$gte = new Date(dateFrom);
    if (dateTo) revenueDateFilter.convertedAt.$lte = new Date(dateTo);
  }
  const revenueMatch = { converted: true, 'conversionData.orderId': { $exists: true }, ...revenueDateFilter };

  const revenueAgg = await ClickLog.aggregate([
    { $match: revenueMatch },
    // First group by orderId to get unique orders
    { $group: {
      _id: '$conversionData.orderId',
      totalAmount: { $first: '$conversionData.totalAmount' }
    }},
    // Then sum all unique orders
    { $group: { _id: null, total: { $sum: '$totalAmount' }, uniqueOrders: { $sum: 1 } } }
  ]);
  const totalRevenue = revenueAgg[0]?.total || 0;
  const uniqueOrderCount = revenueAgg[0]?.uniqueOrders || 0;

  // Get conversions by PSID (with date filter) - also dedupe by orderId
  const conversionsByPSID = await ClickLog.aggregate([
    { $match: revenueMatch },
    // First dedupe by orderId, keeping first PSID that clicked
    { $group: {
      _id: '$conversionData.orderId',
      psid: { $first: '$psid' },
      totalAmount: { $first: '$conversionData.totalAmount' }
    }},
    // Then group by PSID
    {
      $group: {
        _id: '$psid',
        conversions: { $sum: 1 },
        revenue: { $sum: '$totalAmount' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 }
  ]);

  return {
    totalLinks,
    clickedLinks,
    conversions: uniqueOrderCount, // Use unique orders, not duplicate click attributions
    clickRate: totalLinks > 0 ? ((clickedLinks / totalLinks) * 100).toFixed(2) : 0,
    conversionRate: clickedLinks > 0 ? ((uniqueOrderCount / clickedLinks) * 100).toFixed(2) : 0,
    confidenceBreakdown: {
      high: highConfidence,
      medium: mediumConfidence,
      low: lowConfidence
    },
    totalRevenue,
    topConverters: conversionsByPSID
  };
}

/**
 * Get accurate conversion stats by cross-referencing ML API orders with click data
 * This uses ML API as source of truth for orders, then checks attribution in ClickLog
 */
async function getAccurateConversionStats(sellerId, options = {}) {
  const { dateFrom, dateTo } = options;
  const { getOrders } = require('./mercadoLibreOrders');

  // Convert Z format to -00:00 offset format for ML API
  const formatDateForML = (dateStr) => {
    if (!dateStr) return undefined;
    return dateStr.replace('Z', '-00:00').replace('.000-', '-').replace(/\.\d{3}-/, '-');
  };

  const mlDateFrom = formatDateForML(dateFrom);
  const mlDateTo = formatDateForML(dateTo);

  console.log(`📊 Calculating accurate conversion stats for seller ${sellerId}`);
  console.log(`   Date range: ${mlDateFrom || 'start of month'} to ${mlDateTo || 'now'}`);

  try {
    // Step 1: Fetch all orders from ML API for the period
    let allOrders = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const result = await getOrders(sellerId, {
        dateFrom: mlDateFrom,
        dateTo: mlDateTo,
        limit,
        offset
      });

      if (!result.success || !result.orders?.length) break;
      allOrders = allOrders.concat(result.orders);
      if (result.orders.length < limit) break;
      offset += limit;
    }

    console.log(`   📦 Fetched ${allOrders.length} orders from ML API`);

    // Step 2: Calculate total ML revenue
    const totalMLRevenue = allOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);

    // Step 3: Check which orders have matching clicks in ClickLog
    const orderIds = allOrders.map(o => String(o.id));

    const attributedOrders = await ClickLog.find({
      'conversionData.orderId': { $in: orderIds },
      converted: true
    }).distinct('conversionData.orderId');

    console.log(`   🔗 Found ${attributedOrders.length} orders with FB click attribution`);

    // Step 4: Calculate attributed revenue (only orders with clicks)
    const attributedOrdersSet = new Set(attributedOrders.map(String));
    let attributedRevenue = 0;
    const attributedOrderDetails = [];

    for (const order of allOrders) {
      if (attributedOrdersSet.has(String(order.id))) {
        attributedRevenue += order.total_amount || 0;
        attributedOrderDetails.push({
          orderId: order.id,
          amount: order.total_amount,
          date: order.date_created
        });
      }
    }

    const attributionRate = allOrders.length > 0
      ? ((attributedOrders.length / allOrders.length) * 100).toFixed(1)
      : 0;

    console.log(`   💰 Total ML revenue: $${totalMLRevenue.toFixed(2)}`);
    console.log(`   🎯 Attributed revenue: $${attributedRevenue.toFixed(2)} (${attributionRate}%)`);

    return {
      success: true,
      totalOrders: allOrders.length,
      totalMLRevenue,
      attributedOrders: attributedOrders.length,
      attributedRevenue,
      attributionRate: parseFloat(attributionRate),
      // For debugging
      attributedOrderDetails: attributedOrderDetails.slice(0, 10)
    };

  } catch (error) {
    console.error(`❌ Error calculating accurate stats:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get recent conversions
 */
async function getRecentConversions(limit = 20) {
  return await ClickLog.find({ converted: true })
    .select('clickId psid productName productId clickedAt convertedAt correlatedOrderId correlationConfidence correlationMethod conversionData')
    .sort({ convertedAt: -1 })
    .limit(limit);
}

module.exports = {
  correlateClicksToOrders,
  getConversionStats,
  getAccurateConversionStats,
  getRecentConversions,
  extractMLItemId
};
