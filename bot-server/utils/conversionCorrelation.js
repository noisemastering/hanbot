// utils/conversionCorrelation.js
const ClickLog = require("../models/ClickLog");
const { getShipmentById } = require("./mercadoLibreOrders");

// Correlation time windows (in hours)
const HIGH_CONFIDENCE_HOURS = 24;
const MEDIUM_CONFIDENCE_HOURS = 72;
const MAX_CORRELATION_HOURS = 168; // 7 days

/**
 * Normalize city name for comparison
 * Removes accents, lowercase, trims whitespace
 */
function normalizeCity(city) {
  if (!city) return null;
  return city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .trim();
}

/**
 * Calculate hours between two dates
 */
function hoursBetween(date1, date2) {
  const ms = Math.abs(new Date(date2) - new Date(date1));
  return ms / (1000 * 60 * 60);
}

/**
 * Correlate an ML order with ClickLog entries
 *
 * @param {object} order - ML order object
 * @param {string} sellerId - Seller ID for API calls
 * @returns {Promise<object|null>} - Correlation result or null
 */
async function correlateOrder(order, sellerId) {
  try {
    const orderId = order.id || order.orderId;
    const orderDate = new Date(order.date_created || order.orderDate);

    console.log(`🔍 Correlating order ${orderId}...`);

    // Check if order is already correlated
    const existingCorrelation = await ClickLog.findOne({ correlatedOrderId: String(orderId) });
    if (existingCorrelation) {
      console.log(`   ⏭️ Order ${orderId} already correlated to click ${existingCorrelation.clickId}`);
      return { alreadyCorrelated: true, clickLog: existingCorrelation };
    }

    // Get shipping address from ML Shipments API
    let shippingCity = null;
    let shippingState = null;

    if (order.shipping?.id) {
      const shipmentResult = await getShipmentById(sellerId, order.shipping.id);
      if (shipmentResult.success) {
        shippingCity = shipmentResult.shipment.receiverAddress?.city;
        shippingState = shipmentResult.shipment.receiverAddress?.state;
        console.log(`   📍 Shipping address: ${shippingCity}, ${shippingState}`);
      }
    }

    const normalizedShippingCity = normalizeCity(shippingCity);

    // Get ordered product IDs
    const orderedProductIds = (order.order_items || [])
      .map(item => item.item?.id)
      .filter(Boolean);

    // Calculate time window for correlation
    const maxTimeAgo = new Date(orderDate.getTime() - (MAX_CORRELATION_HOURS * 60 * 60 * 1000));

    // Find potential matching clicks
    // Must be: clicked, not converted, within time window
    const query = {
      clicked: true,
      converted: { $ne: true },
      clickedAt: { $gte: maxTimeAgo, $lte: orderDate }
    };

    // If we have a shipping city/state, prioritize location matches
    let candidates = [];
    const normalizedShippingState = normalizeCity(shippingState);

    if (normalizedShippingCity || normalizedShippingState) {
      // Build location match query
      // Match by: city, state, OR if user stored state as city (common case)
      const locationConditions = [];

      if (normalizedShippingCity) {
        locationConditions.push(
          { city: { $regex: new RegExp(normalizedShippingCity, 'i') } },
          { city: shippingCity }
        );
      }

      if (normalizedShippingState) {
        // Also match if the ClickLog.city is actually the state name
        // e.g., user said "Jalisco" and we stored it as city
        locationConditions.push(
          { city: { $regex: new RegExp(normalizedShippingState, 'i') } },
          { stateMx: { $regex: new RegExp(normalizedShippingState, 'i') } }
        );
      }

      const cityMatches = await ClickLog.find({
        ...query,
        $or: locationConditions
      }).sort({ clickedAt: -1 }).limit(10);

      candidates = cityMatches;
      console.log(`   🏙️ Found ${cityMatches.length} clicks matching ${shippingCity || ''}, ${shippingState || ''}`);
    }

    // If no city matches, fall back to product-only matching (lower confidence)
    if (candidates.length === 0 && orderedProductIds.length > 0) {
      const productMatches = await ClickLog.find({
        ...query,
        productId: { $in: orderedProductIds.map(String) }
      }).sort({ clickedAt: -1 }).limit(5);

      candidates = productMatches;
      console.log(`   📦 Found ${productMatches.length} clicks for ordered products (no city match)`);
    }

    if (candidates.length === 0) {
      console.log(`   ❌ No matching clicks found for order ${orderId}`);
      return null;
    }

    // Score candidates and pick the best match
    let bestMatch = null;
    let bestScore = 0;

    for (const click of candidates) {
      let score = 0;
      const hoursAgo = hoursBetween(click.clickedAt, orderDate);

      // City match scoring
      const normalizedClickCity = normalizeCity(click.city);
      const normalizedClickState = normalizeCity(click.stateMx);

      const cityMatches = normalizedClickCity && normalizedShippingCity &&
                          normalizedClickCity === normalizedShippingCity;

      // State match - either direct state match OR click.city is actually the state name
      const stateMatches = normalizedShippingState && (
        (normalizedClickState && normalizedClickState === normalizedShippingState) ||
        (normalizedClickCity && normalizedClickCity === normalizedShippingState)
      );

      if (cityMatches) {
        score += 50; // Strong signal - exact city match
      } else if (stateMatches) {
        score += 35; // Good signal - same state
      }

      // Product match scoring
      const clickProductId = click.productId ? String(click.productId) : null;
      const productMatches = clickProductId && orderedProductIds.map(String).includes(clickProductId);

      if (productMatches) {
        score += 30; // Good signal
      }

      // Time proximity scoring (closer = better)
      if (hoursAgo <= HIGH_CONFIDENCE_HOURS) {
        score += 20;
      } else if (hoursAgo <= MEDIUM_CONFIDENCE_HOURS) {
        score += 10;
      } else {
        score += 5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          click,
          score,
          cityMatches,
          stateMatches,
          productMatches,
          hoursAgo
        };
      }
    }

    if (!bestMatch) {
      console.log(`   ❌ No suitable match found for order ${orderId}`);
      return null;
    }

    // Determine confidence level
    let confidence = 'low';
    if (bestMatch.cityMatches && bestMatch.hoursAgo <= HIGH_CONFIDENCE_HOURS) {
      confidence = 'high';
    } else if (bestMatch.cityMatches || (bestMatch.stateMatches && bestMatch.hoursAgo <= MEDIUM_CONFIDENCE_HOURS)) {
      confidence = 'medium'; // State match within 72h
    } else if (bestMatch.productMatches && bestMatch.hoursAgo <= MEDIUM_CONFIDENCE_HOURS) {
      confidence = 'medium';
    }

    // Update the ClickLog with conversion data
    const click = bestMatch.click;
    const buyerInfo = order.buyer || {};
    const firstItem = (order.order_items || [])[0];

    const updateData = {
      converted: true,
      convertedAt: new Date(),
      correlatedOrderId: String(orderId),
      correlationConfidence: confidence,
      correlationMethod: 'time_based',
      conversionData: {
        orderId: String(orderId),
        orderStatus: order.status,
        buyerId: buyerInfo.id ? String(buyerInfo.id) : null,
        buyerNickname: buyerInfo.nickname,
        buyerFirstName: buyerInfo.first_name,
        buyerLastName: buyerInfo.last_name,
        totalAmount: order.total_amount,
        paidAmount: order.paid_amount,
        currency: order.currency_id,
        orderDate: orderDate,
        itemTitle: firstItem?.item?.title,
        itemQuantity: firstItem?.quantity,
        shippingCity: shippingCity,
        shippingState: shippingState
      }
    };

    const updatedClick = await ClickLog.findByIdAndUpdate(
      click._id,
      updateData,
      { new: true }
    );

    console.log(`   ✅ Correlated order ${orderId} with click ${click.clickId}`);
    console.log(`      Confidence: ${confidence}, Score: ${bestScore}`);
    console.log(`      City: ${click.city || 'none'} → ${shippingCity || 'none'} (${bestMatch.cityMatches ? 'MATCH' : 'no match'})`);
    console.log(`      State: ${click.stateMx || click.city || 'none'} → ${shippingState || 'none'} (${bestMatch.stateMatches ? 'MATCH' : 'no match'})`);
    console.log(`      Time: ${bestMatch.hoursAgo.toFixed(1)}h before order`);

    return {
      success: true,
      clickLog: updatedClick,
      confidence,
      score: bestScore,
      details: {
        cityMatches: bestMatch.cityMatches,
        stateMatches: bestMatch.stateMatches,
        productMatches: bestMatch.productMatches,
        hoursAgo: bestMatch.hoursAgo
      }
    };

  } catch (error) {
    console.error(`❌ Error correlating order:`, error.message);
    return { error: error.message };
  }
}

/**
 * Batch correlate multiple orders
 * Useful for processing historical orders
 *
 * @param {array} orders - Array of ML order objects
 * @param {string} sellerId - Seller ID
 * @returns {Promise<object>} - Summary of correlations
 */
async function correlateOrders(orders, sellerId) {
  const results = {
    total: orders.length,
    correlated: 0,
    alreadyCorrelated: 0,
    noMatch: 0,
    errors: 0,
    details: []
  };

  for (const order of orders) {
    const result = await correlateOrder(order, sellerId);

    if (result?.alreadyCorrelated) {
      results.alreadyCorrelated++;
    } else if (result?.success) {
      results.correlated++;
      results.details.push({
        orderId: order.id,
        clickId: result.clickLog.clickId,
        confidence: result.confidence
      });
    } else if (result?.error) {
      results.errors++;
    } else {
      results.noMatch++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n📊 Correlation Summary:`);
  console.log(`   Total orders: ${results.total}`);
  console.log(`   New correlations: ${results.correlated}`);
  console.log(`   Already correlated: ${results.alreadyCorrelated}`);
  console.log(`   No match found: ${results.noMatch}`);
  console.log(`   Errors: ${results.errors}`);

  return results;
}

module.exports = {
  correlateOrder,
  correlateOrders,
  normalizeCity,
  HIGH_CONFIDENCE_HOURS,
  MEDIUM_CONFIDENCE_HOURS,
  MAX_CORRELATION_HOURS
};
