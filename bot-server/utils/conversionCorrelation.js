// utils/conversionCorrelation.js
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const { getShipmentById } = require("./mercadoLibreOrders");
const { detectGender } = require("./genderDetector");

// Correlation time windows (in hours)
const HIGH_CONFIDENCE_HOURS = 24;
const MEDIUM_CONFIDENCE_HOURS = 72;
const MAX_CORRELATION_HOURS = 168; // 7 days

/**
 * Normalize name for comparison
 * Removes accents, lowercase, trims
 */
function normalizeName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

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
 * Check if POI matches ordered product
 * @param {string} poiRootName - User's POI root (e.g., "Malla Sombra")
 * @param {string} itemTitle - ML order item title
 * @returns {boolean}
 */
function poiMatchesProduct(poiRootName, itemTitle) {
  if (!poiRootName || !itemTitle) return false;
  const normalizedPoi = normalizeName(poiRootName);
  const normalizedTitle = normalizeName(itemTitle);

  // Check if POI root name appears in item title
  return normalizedTitle.includes(normalizedPoi);
}

/**
 * Check if a name appears in a nickname
 * E.g., "juan" in "JUANPEREZ123" or "laura" in "LAURAM_MX"
 * @param {string} firstName - Normalized first name from Facebook
 * @param {string} nickname - ML buyer nickname
 * @returns {boolean}
 */
function nameInNickname(firstName, nickname) {
  if (!firstName || !nickname || firstName.length < 3) return false;
  const normalizedNickname = normalizeName(nickname);
  return normalizedNickname.includes(firstName);
}

/**
 * Correlate an ML order with ClickLog entries and User data
 *
 * Correlation priority:
 * 1. ML Item ID exact match (from clicked link)
 * 2. Name + Location + POI match (highest confidence)
 * 3. Location + POI match
 * 4. Name + POI match
 * 5. Click within time window (fallback)
 *
 * @param {object} order - ML order object
 * @param {string} sellerId - Seller ID for API calls
 * @returns {Promise<object|null>} - Correlation result or null
 */
async function correlateOrder(order, sellerId) {
  try {
    const orderId = order.id || order.orderId;
    const orderDate = new Date(order.date_created || order.orderDate);
    const buyerInfo = order.buyer || {};
    const firstItem = (order.order_items || [])[0];

    console.log(`🔍 Correlating order ${orderId}...`);

    // Check if order is already correlated (check both old and new field locations)
    const existingCorrelation = await ClickLog.findOne({
      $or: [
        { correlatedOrderId: String(orderId) },
        { 'conversionData.orderId': String(orderId) },
        { 'conversionData.orderId': orderId }
      ]
    });
    if (existingCorrelation) {
      const method = existingCorrelation.correlationMethod;
      const hasMatchDetails = existingCorrelation.matchDetails && Object.keys(existingCorrelation.matchDetails).length > 0;

      // Re-evaluate if: time_based method OR missing matchDetails (needs migration)
      if (method && method !== 'time_based' && hasMatchDetails) {
        console.log(`   ⏭️ Order ${orderId} already correlated (${method})`);
        return { alreadyCorrelated: true, clickLog: existingCorrelation };
      }

      // Old correlation or missing match details - re-evaluate with enhanced scoring
      const reason = !hasMatchDetails ? 'missing matchDetails' : 'time_based method';
      console.log(`   🔄 Re-evaluating correlation for order ${orderId} (${reason})...`);
    }

    // Get shipping address and receiver name from ML Shipments API
    let shippingCity = null;
    let shippingState = null;
    let shippingZipCode = null;
    let receiverName = null;

    if (order.shipping?.id) {
      const shipmentResult = await getShipmentById(sellerId, order.shipping.id);
      if (shipmentResult.success) {
        shippingCity = shipmentResult.shipment.receiverAddress?.city;
        shippingState = shipmentResult.shipment.receiverAddress?.state;
        shippingZipCode = shipmentResult.shipment.receiverAddress?.zipCode;
        receiverName = shipmentResult.shipment.receiverName;
        console.log(`   📍 Shipping: ${shippingCity}, ${shippingState} (${shippingZipCode})`);
        console.log(`   👤 Receiver: ${receiverName}`);
      }
    }

    // Get ordered ML Item IDs for exact matching
    const orderedMLItemIds = (order.order_items || [])
      .map(item => item.item?.id)
      .filter(Boolean);

    console.log(`   📦 Ordered items: ${orderedMLItemIds.join(', ')}`);

    // PRODUCT-BASED MATCH (the durable one): map the order's ML item ids to OUR
    // products via ProductFamily.mlItemIds, so a click (which stores our productId)
    // matches on the PRODUCT — not on a rotating/relisted ML id string. Item ids
    // drift when ML relists; our product id never does.
    let orderedProductIds = new Set();
    try {
      const ProductFamily = require('../models/ProductFamily');
      if (orderedMLItemIds.length) {
        const fams = await ProductFamily.find({ mlItemIds: { $in: orderedMLItemIds } }).select('_id').lean();
        orderedProductIds = new Set(fams.map(f => String(f._id)));
      }
    } catch (e) {
      console.error('   ⚠️ product map lookup failed:', e.message);
    }
    if (orderedProductIds.size) console.log(`   🧩 Order maps to our product(s): ${[...orderedProductIds].join(', ')}`);

    // Name for matching. ML delivers the BUYER ACCOUNT name (~99%) but almost
    // never the shipment receiver name (~0%) — so use the buyer name as the
    // primary, and fall back to the receiver name only if it's ever present.
    // (Bonus: using the buyer's name is what makes the "bought by someone else,
    // shipped to me" case score as zip+item=90% instead of a false trifecta.)
    let buyerFirstName = buyerInfo.first_name ? normalizeName(buyerInfo.first_name) : null;
    let buyerLastName = buyerInfo.last_name ? normalizeName(buyerInfo.last_name) : null;
    if ((!buyerFirstName || !buyerLastName) && receiverName) {
      const nameParts = receiverName.trim().split(/\s+/);
      if (!buyerFirstName) buyerFirstName = normalizeName(nameParts[0]);
      if (!buyerLastName && nameParts.length > 1) buyerLastName = normalizeName(nameParts.slice(1).join(' '));
    }
    console.log(`   👤 Buyer name: ${buyerFirstName} ${buyerLastName || ''} (nick ${buyerInfo.nickname || '-'})`);

    // Calculate time window for click-based correlation
    const maxTimeAgo = new Date(orderDate.getTime() - (MAX_CORRELATION_HOURS * 60 * 60 * 1000));

    // ============ PHASE 1: USER DATA LOOKUP ============
    // Find users that match buyer name and/or location
    const normalizedShippingCity = normalizeCity(shippingCity);
    const normalizedShippingState = normalizeCity(shippingState);

    let matchingUsers = [];

    // Build user query conditions
    const userConditions = [];

    // Name match condition
    if (buyerFirstName) {
      userConditions.push({
        $expr: {
          $eq: [
            { $toLower: "$first_name" },
            buyerFirstName
          ]
        }
      });
    }

    // Location match conditions
    if (normalizedShippingCity) {
      userConditions.push({ 'location.city': { $regex: new RegExp(normalizedShippingCity, 'i') } });
    }
    if (normalizedShippingState) {
      userConditions.push({ 'location.state': { $regex: new RegExp(normalizedShippingState, 'i') } });
    }
    if (shippingZipCode) {
      userConditions.push({ 'location.zipcode': shippingZipCode });
    }

    if (userConditions.length > 0) {
      matchingUsers = await User.find({ $or: userConditions }).lean();
      console.log(`   👥 Found ${matchingUsers.length} potentially matching users`);
    }

    // ============ PHASE 3: SCORE CLICK CANDIDATES ============
    // Find all clicks within time window
    const clickQuery = {
      clicked: true,
      converted: { $ne: true },
      clickedAt: { $gte: maxTimeAgo, $lte: orderDate }
    };

    let allClicks = await ClickLog.find(clickQuery).sort({ clickedAt: -1 }).limit(50);

    // If re-evaluating an old correlation, include the existing click in candidates
    if (existingCorrelation && !allClicks.find(c => c._id.equals(existingCorrelation._id))) {
      allClicks = [existingCorrelation, ...allClicks];
    }

    console.log(`   🖱️ Found ${allClicks.length} clicks in time window`);

    // ── CERTAINTY MODEL ───────────────────────────────────────────────────────
    // Attribution = the SUM of corroborating signals; no single one decides it.
    //   zip  = the CP we collected on Messenger == the order's shipping zip (the linchpin)
    //   name = our Messenger FULL name (first+last) == the shipping receiver name
    //   item = the product they clicked == the product ordered
    //   nick = our name inside the ML buyer handle (the undisputed topper)
    //   time = ONLY the ≤5-min gate for the weakest (item-only, no zip) case
    // Tiers: 100 (zip+name+item; +nick ⇒ undisputed) · 90 (zip+item) · 80 (city+item ·
    //   or name+nick+item) · 70 (zip+name, distinto producto = indirecta) · 60 (city+name) ·
    //   25 (item + ≤5min, sin zip) · else NOT attributed. Zip/city ALONE (no item, no
    //   name) do NOT attribute (removed 2026-07-02 — see classify body).
    const normZip = (z) => String(z || '').replace(/\D/g, '');
    const shipZipN = normZip(shippingZipCode);
    const shipCityN = normalizeCity(shippingCity);

    const evalCandidate = (click, user) => {
      const uFirst = normalizeName((user && (user.firstName || user.first_name)) || '');
      const uLast = normalizeName((user && (user.lastName || user.last_name)) || '');
      const uZip = normZip((user && user.location && user.location.zipcode) || (click && click.zipcode));
      const uCity = normalizeCity((user && user.location && user.location.city) || (click && click.city) || '');
      const mlItemId = click && click.mlItemId;
      const zipMatch = !!(uZip && shipZipN && uZip === shipZipN);
      // City = a zip-like fallback when we never captured the CP (lower score, -10).
      const cityMatch = !!(uCity && shipCityN && uCity === shipCityN);
      // FULL name only: need first AND last on both sides, all matching.
      const nameMatch = !!(uFirst && uLast && buyerFirstName && buyerLastName && uFirst === buyerFirstName && uLast === buyerLastName);
      // ITEM MATCH = "did they buy the PRODUCT they clicked". Match on OUR product
      // id (durable; the click stores it) first; the ML item-id string is only a
      // legacy fallback (it's usually null on clicks and rotates on relists).
      const itemMatch = !!(
        (click && click.productId && orderedProductIds.has(String(click.productId))) ||
        (mlItemId && orderedMLItemIds.includes(mlItemId))
      );
      const nicknameMatch = !!(uFirst && buyerInfo.nickname && nameInNickname(uFirst, buyerInfo.nickname));
      const minutes = click && click.clickedAt ? (orderDate.getTime() - new Date(click.clickedAt).getTime()) / 60000 : null;
      return { zipMatch, cityMatch, nameMatch, itemMatch, nicknameMatch, minutes };
    };

    // Location signal: zip (full strength) or city (zip − 10, a known-zip-area match).
    const classify = (m) => {
      const loc = m.zipMatch ? 'zip' : m.cityMatch ? 'city' : null;
      const locTxt = loc === 'zip' ? 'cp' : 'ciudad';
      const drop = loc === 'city' ? 10 : 0;
      const med = (pct) => (pct >= 70 ? 'high' : pct >= 50 ? 'medium' : 'low');
      if (loc && m.nameMatch && m.itemMatch) {
        const pct = 100 - drop;
        return { pct, confidence: med(pct), undisputed: !!m.nicknameMatch && loc === 'zip', ventaIndirecta: false,
                 reason: `${locTxt} + nombre + item${m.nicknameMatch ? ' + usuario ML' : ''} → ${m.nicknameMatch && loc === 'zip' ? 'indiscutible' : 'trifecta'} (${pct}%)` };
      }
      if (loc && m.itemMatch)
        return { pct: 90 - drop, confidence: med(90 - drop), undisputed: false, ventaIndirecta: false, reason: `${locTxt} + item (${90 - drop}%)` };
      // No location, but a strong identity match: name + ML nickname + item.
      if (m.nameMatch && m.nicknameMatch && m.itemMatch)
        return { pct: 80, confidence: 'high', undisputed: false, ventaIndirecta: false, reason: 'nombre + usuario ML + item, sin ubicación (80%)' };
      if (loc && m.nameMatch)
        return { pct: 70 - drop, confidence: med(70 - drop), undisputed: false, ventaIndirecta: true, reason: `${locTxt} + nombre, distinto producto → venta indirecta (${70 - drop}%)` };
      // LOCATION ALONE NO LONGER ATTRIBUTES (user, 2026-07-02). A zip must be
      // CORROBORATED by the product OR the name — zip+item=90 and zip+name=70 above
      // already cover those. A bare zip match with NEITHER item NOR name is NOT a
      // sale: after the profile backfill (44→1,539 users with a CP) a lone-zip rule
      // flooded the Conversions page with "50% indirecta" credits (many are just a
      // different household/relative at the same CP buying something else). City
      // alone was removed earlier for the same reason; zip alone now joins it.
      if (m.itemMatch && m.minutes != null && m.minutes >= 0 && m.minutes <= 5)
        return { pct: 25, confidence: 'low', undisputed: false, ventaIndirecta: false, reason: 'item + tiempo ≤5 min, sin ubicación (25%)' };
      return null;
    };

    const candidates = [];
    for (const click of allClicks) {
      let user = matchingUsers.find((u) => u.psid === click.psid || u.unifiedId === click.psid || u.unifiedId === `fb:${click.psid}`);
      if (!user) user = await User.findOne({ psid: click.psid }).lean().catch(() => null);
      const m = evalCandidate(click, user);
      const c = classify(m);
      if (c) candidates.push({ click, user, isOrphan: false, m, ...c });
    }
    // Orphans: a known customer (name/zip match) who bought without clicking our link.
    for (const u of matchingUsers) {
      const clicked = allClicks.some((cl) => cl.psid === u.psid || cl.psid === (u.unifiedId || '').replace(/^fb:/, ''));
      if (clicked) continue;
      const m = evalCandidate(null, u);
      const c = classify(m);
      if (c) candidates.push({ click: null, user: u, isOrphan: true, m, ...c });
    }

    // Strongest wins (highest %; tie → most recent click).
    candidates.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      const ta = a.click && a.click.clickedAt ? new Date(a.click.clickedAt).getTime() : 0;
      const tb = b.click && b.click.clickedAt ? new Date(b.click.clickedAt).getTime() : 0;
      return tb - ta;
    });
    const best = candidates[0] || null;

    if (!best) {
      // Nothing meets the model. Release any stale credit on this order so a
      // re-sync clears it instead of leaving a bogus conversion.
      if (existingCorrelation && existingCorrelation.converted && String(existingCorrelation.correlatedOrderId || '') === String(orderId)) {
        await ClickLog.findByIdAndUpdate(existingCorrelation._id, {
          converted: false, convertedAt: null, correlatedOrderId: null,
          correlationConfidence: null, correlationMethod: null, matchDetails: null,
          correlationCertainty: null, correlationUndisputed: false, ventaIndirecta: false, attributionReason: null,
        });
        console.log(`   🧹 Released stale correlation for order ${orderId} — no longer meets the certainty model`);
      }
      console.log(`   ❌ Order ${orderId}: no candidate meets the certainty model — not attributed`);
      return null;
    }

    console.log(`   ✅ Best: ${best.pct}% — ${best.reason}${best.isOrphan ? ' [orphan]' : ''}`);
    const method = best.m.itemMatch ? 'ml_item_match' : (best.m.nameMatch || best.m.zipMatch) ? 'enhanced' : 'time_based';
    const details = {
      mlItemMatch: best.m.itemMatch, nameMatch: best.m.nameMatch, nicknameMatch: best.m.nicknameMatch,
      zipMatch: best.m.zipMatch, cityMatch: best.m.cityMatch, stateMatch: false, poiMatch: false, timeScore: best.m.minutes,
      certaintyPct: best.pct, undisputed: best.undisputed, ventaIndirecta: best.ventaIndirecta, attributionReason: best.reason,
      shippingCity, shippingState, shippingZipCode, buyerFirstName, buyerLastName, receiverName,
    };
    if (best.isOrphan) {
      return await saveOrphanCorrelation(best.user, order, best.confidence, details, {
        shippingCity, shippingState, shippingZipCode, buyerFirstName, buyerLastName, receiverName,
      });
    }
    return await saveCorrelation(best.click, order, best.confidence, method, details);

  } catch (error) {
    console.error(`❌ Error correlating order:`, error.message);
    return { error: error.message };
  }
}

/**
 * Save correlation to ClickLog
 */
/**
 * Enforce ONE order → ONE converted click. A popular/hero listing can match
 * several clicks for the same ML order; only the best match (keepClickId, just
 * saved by correlateOrder) should be credited. Any other click still crediting
 * this order is released back to a plain (clicked, not converted) state so a
 * single sale can't be counted against multiple people.
 */
async function demoteOtherClicksForOrder(orderId, keepClickId) {
  if (!orderId) return 0;
  const res = await ClickLog.updateMany(
    { _id: { $ne: keepClickId }, correlatedOrderId: String(orderId), converted: true },
    { $set: { converted: false, convertedAt: null, correlatedOrderId: null, correlationConfidence: null, correlationMethod: null } }
  );
  if (res.modifiedCount) {
    console.log(`   🧹 Dedup: released ${res.modifiedCount} duplicate click credit(s) for order ${orderId}`);
  }
  return res.modifiedCount || 0;
}

async function saveCorrelation(click, order, confidence, method, details) {
  const orderId = order.id || order.orderId;
  const orderDate = new Date(order.date_created || order.orderDate);
  const buyerInfo = order.buyer || {};
  const firstItem = (order.order_items || [])[0];

  const updateData = {
    converted: true,
    convertedAt: new Date(),
    correlatedOrderId: String(orderId),
    correlationConfidence: confidence,
    correlationMethod: method,
    // Certainty model outputs (shown in the dashboard with hierarchy).
    correlationCertainty: details.certaintyPct != null ? details.certaintyPct : null,
    correlationUndisputed: !!details.undisputed,
    ventaIndirecta: !!details.ventaIndirecta,
    attributionReason: details.attributionReason || null,
    // Store match details for debugging/auditing
    matchDetails: {
      mlItemMatch: details.mlItemMatch || false,
      nameMatch: details.nameMatch || false,
      nicknameMatch: details.nicknameMatch || false,
      cityMatch: details.cityMatch || false,
      stateMatch: details.stateMatch || false,
      zipMatch: details.zipMatch || false,
      poiMatch: details.poiMatch || false,
      timeScore: details.timeScore || 0,
      hoursAgo: details.hoursAgo || null
    },
    conversionData: {
      orderId: String(orderId),
      orderStatus: order.status,
      buyerId: buyerInfo.id ? String(buyerInfo.id) : null,
      buyerNickname: buyerInfo.nickname,
      buyerFirstName: details.buyerFirstName || null,
      buyerLastName: details.buyerLastName || null,
      buyerGender: detectGender(details.buyerFirstName || ''),
      receiverName: details.receiverName || null,
      totalAmount: order.total_amount,
      paidAmount: order.paid_amount,
      currency: order.currency_id,
      orderDate: orderDate,
      itemTitle: firstItem?.item?.title,
      itemQuantity: firstItem?.quantity,
      shippingCity: details.shippingCity,
      shippingState: details.shippingState,
      shippingZipCode: details.shippingZipCode
    }
  };

  const updatedClick = await ClickLog.findByIdAndUpdate(
    click._id,
    updateData,
    { new: true }
  );

  console.log(`   ✅ Correlated order ${orderId} with click ${click.clickId} (${confidence})`);

  // One order → one converted click: release any other clicks crediting this order.
  await demoteOtherClicksForOrder(orderId, click._id);

  // Track cross-sell conversion if this click came from a cross-sell offer
  if (click.crossSellRuleId) {
    try {
      const CrossSellRule = require('../models/CrossSellRule');
      await CrossSellRule.updateOne(
        { _id: click.crossSellRuleId },
        { $inc: { 'stats.converted': 1 } }
      );
      console.log(`   🔄 Cross-sell conversion tracked for rule ${click.crossSellRuleId}`);
    } catch (csErr) {
      console.error(`   ⚠️ Cross-sell tracking error:`, csErr.message);
    }
  }

  return {
    success: true,
    clickLog: updatedClick,
    confidence,
    method,
    details
  };
}

/**
 * Save orphan correlation (user match without click)
 * Creates a new ClickLog entry to track the correlation
 */
async function saveOrphanCorrelation(user, order, confidence, matchDetails, shippingInfo) {
  const orderId = order.id || order.orderId;
  const orderDate = new Date(order.date_created || order.orderDate);
  const buyerInfo = order.buyer || {};
  const firstItem = (order.order_items || [])[0];

  // Create an orphan ClickLog entry
  const orphanClick = new ClickLog({
    clickId: `orphan-${orderId}`,
    psid: user.psid || user.unifiedId,
    originalUrl: 'orphan_correlation',
    productName: firstItem?.item?.title || 'Unknown',
    clicked: false, // Not a real click
    converted: true,
    convertedAt: new Date(),
    correlatedOrderId: String(orderId),
    correlationConfidence: confidence,
    correlationMethod: 'orphan',
    correlationCertainty: matchDetails && matchDetails.certaintyPct != null ? matchDetails.certaintyPct : null,
    correlationUndisputed: !!(matchDetails && matchDetails.undisputed),
    ventaIndirecta: !!(matchDetails && matchDetails.ventaIndirecta),
    attributionReason: (matchDetails && matchDetails.attributionReason) || null,
    city: user.location?.city,
    stateMx: user.location?.state,
    conversionData: {
      orderId: String(orderId),
      orderStatus: order.status,
      buyerId: buyerInfo.id ? String(buyerInfo.id) : null,
      buyerNickname: buyerInfo.nickname,
      buyerFirstName: shippingInfo.buyerFirstName || null,
      buyerLastName: shippingInfo.buyerLastName || null,
      buyerGender: detectGender(shippingInfo.buyerFirstName || ''),
      receiverName: shippingInfo.receiverName || null,
      totalAmount: order.total_amount,
      paidAmount: order.paid_amount,
      currency: order.currency_id,
      orderDate: orderDate,
      itemTitle: firstItem?.item?.title,
      itemQuantity: firstItem?.quantity,
      shippingCity: shippingInfo.shippingCity,
      shippingState: shippingInfo.shippingState,
      shippingZipCode: shippingInfo.shippingZipCode
    }
  });

  await orphanClick.save();

  console.log(`   ✅ ORPHAN correlation: order ${orderId} → user ${user.firstName || user.first_name} (${confidence})`);

  // One order → one converted click (release any prior credits for this order).
  await demoteOtherClicksForOrder(orderId, orphanClick._id);

  return {
    success: true,
    clickLog: orphanClick,
    confidence,
    method: 'orphan',
    details: matchDetails,
    isOrphan: true
  };
}

/**
 * Batch correlate multiple orders
 * Useful for processing historical orders
 *
 * @param {array} orders - Array of ML order objects
 * @param {string} sellerId - Seller ID
 * @returns {Promise<object>} - Summary of correlations
 */
async function correlateOrders(orders, sellerId, onProgress = null) {
  const results = {
    total: orders.length,
    correlated: 0,
    alreadyCorrelated: 0,
    noMatch: 0,
    errors: 0,
    details: []
  };

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
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

    // Report progress every 5 orders
    if (onProgress && (i % 5 === 0 || i === orders.length - 1)) {
      onProgress(i + 1, results.correlated);
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
  normalizeName,
  poiMatchesProduct,
  HIGH_CONFIDENCE_HOURS,
  MEDIUM_CONFIDENCE_HOURS,
  MAX_CORRELATION_HOURS
};
