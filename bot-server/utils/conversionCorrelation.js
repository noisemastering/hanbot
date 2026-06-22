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

    // Receiver name for matching (from shipment, this is the real name)
    // Parse "Juan Pérez García" into first/last name
    let buyerFirstName = null;
    let buyerLastName = null;
    if (receiverName) {
      const nameParts = receiverName.trim().split(/\s+/);
      buyerFirstName = normalizeName(nameParts[0]);
      buyerLastName = nameParts.length > 1 ? normalizeName(nameParts.slice(1).join(' ')) : null;
    }
    console.log(`   👤 Receiver name parsed: ${buyerFirstName} ${buyerLastName || ''}`);

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

    let bestMatch = null;
    let bestScore = 0;

    for (const click of allClicks) {
      let score = 0;
      const matchDetails = {
        mlItemMatch: false,
        nameMatch: false,
        nicknameMatch: false,
        cityMatch: false,
        stateMatch: false,
        zipMatch: false,
        poiMatch: false,
        timeScore: 0
      };

      const hoursAgo = hoursBetween(click.clickedAt, orderDate);

      // Find the user associated with this click
      const clickUser = matchingUsers.find(u =>
        u.psid === click.psid ||
        u.unifiedId === click.psid ||
        u.unifiedId === `fb:${click.psid}`
      );

      // ML Item ID exact match - strongest signal
      if (click.mlItemId && orderedMLItemIds.includes(click.mlItemId)) {
        score += 100;
        matchDetails.mlItemMatch = true;
        console.log(`      ✓ ML Item ID match: ${click.mlItemId}`);
      }

      // Name match - check User model against receiver name or nickname
      if (clickUser) {
        const userFirstName = normalizeName(clickUser.firstName || clickUser.first_name);

        // Primary: match against receiver name from shipment
        if (userFirstName && buyerFirstName && userFirstName === buyerFirstName) {
          score += 40;
          matchDetails.nameMatch = true;
          console.log(`      ✓ Name match (receiver): ${clickUser.firstName || clickUser.first_name}`);
        }
        // Fallback: check if user's name appears in buyer nickname
        else if (userFirstName && buyerInfo.nickname && nameInNickname(userFirstName, buyerInfo.nickname)) {
          score += 35; // Slightly lower confidence than exact match
          matchDetails.nameMatch = true;
          matchDetails.nicknameMatch = true;
          console.log(`      ✓ Name in nickname: ${userFirstName} found in ${buyerInfo.nickname}`);
        }
      }

      // Location matches - check both ClickLog and User model
      const clickCity = normalizeCity(click.city || clickUser?.location?.city);
      const clickState = normalizeCity(click.stateMx || clickUser?.location?.state);
      const clickZip = click.zipcode || clickUser?.location?.zipcode;

      if (clickCity && normalizedShippingCity && clickCity === normalizedShippingCity) {
        score += 35;
        matchDetails.cityMatch = true;
      }

      if (clickState && normalizedShippingState && clickState === normalizedShippingState) {
        score += 25;
        matchDetails.stateMatch = true;
      }

      if (clickZip && shippingZipCode && clickZip === shippingZipCode) {
        score += 45; // Zip is very specific
        matchDetails.zipMatch = true;
      }

      // POI match - check if user's POI matches ordered product
      if (clickUser?.poi?.rootName && firstItem?.item?.title) {
        if (poiMatchesProduct(clickUser.poi.rootName, firstItem.item.title)) {
          score += 30;
          matchDetails.poiMatch = true;
          console.log(`      ✓ POI match: ${clickUser.poi.rootName}`);
        }
      }

      // Time proximity scoring
      if (hoursAgo <= HIGH_CONFIDENCE_HOURS) {
        score += 20;
        matchDetails.timeScore = 20;
      } else if (hoursAgo <= MEDIUM_CONFIDENCE_HOURS) {
        score += 10;
        matchDetails.timeScore = 10;
      } else {
        score += 5;
        matchDetails.timeScore = 5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { click, score, hoursAgo, matchDetails, user: clickUser };
      }
    }

    // ============ PHASE 4: ORPHAN CORRELATION ============
    // If no click matched well, check if we have a user match without a click
    // This handles: user chatted, got product info, but bought directly on ML without clicking link
    // An item-id match gives a click a high raw score but is NOT identity. If the
    // best click lacks any identity signal, treat it as "no real match" so a
    // genuine identity-backed buyer (orphan) can take the order instead.
    const bestHasIdentity = !!(bestMatch && bestMatch.matchDetails &&
      (bestMatch.matchDetails.nameMatch || bestMatch.matchDetails.zipMatch ||
       bestMatch.matchDetails.cityMatch || bestMatch.matchDetails.stateMatch ||
       bestMatch.matchDetails.poiMatch));

    if ((!bestMatch || bestScore < 50 || !bestHasIdentity) && matchingUsers.length > 0) {
      for (const user of matchingUsers) {
        let orphanScore = 0;
        const matchDetails = {
          orphan: true,
          nameMatch: false,
          nicknameMatch: false,
          cityMatch: false,
          stateMatch: false,
          zipMatch: false,
          poiMatch: false
        };

        // Name match - receiver name or nickname
        const userFirstName = normalizeName(user.firstName || user.first_name);
        if (userFirstName && buyerFirstName && userFirstName === buyerFirstName) {
          orphanScore += 40;
          matchDetails.nameMatch = true;
        } else if (userFirstName && buyerInfo.nickname && nameInNickname(userFirstName, buyerInfo.nickname)) {
          orphanScore += 35;
          matchDetails.nameMatch = true;
          matchDetails.nicknameMatch = true;
        }

        // Location match
        const userCity = normalizeCity(user.location?.city);
        const userState = normalizeCity(user.location?.state);
        const userZip = user.location?.zipcode;

        if (userCity && normalizedShippingCity && userCity === normalizedShippingCity) {
          orphanScore += 35;
          matchDetails.cityMatch = true;
        }

        if (userState && normalizedShippingState && userState === normalizedShippingState) {
          orphanScore += 25;
          matchDetails.stateMatch = true;
        }

        if (userZip && shippingZipCode && userZip === shippingZipCode) {
          orphanScore += 45;
          matchDetails.zipMatch = true;
        }

        // POI match
        if (user.poi?.rootName && firstItem?.item?.title) {
          if (poiMatchesProduct(user.poi.rootName, firstItem.item.title)) {
            orphanScore += 30;
            matchDetails.poiMatch = true;
          }
        }

        // Only consider orphan if score is meaningful (name + location OR name + POI).
        // An identity-backed orphan must be able to beat an item-id-only click
        // (high raw score, no identity corroboration).
        if (orphanScore >= 70 && (orphanScore > bestScore || !bestHasIdentity)) {
          console.log(`   🔮 ORPHAN CORRELATION: User ${user.first_name} (score: ${orphanScore})`);
          bestScore = orphanScore;
          bestMatch = {
            click: null,
            score: orphanScore,
            hoursAgo: null,
            matchDetails,
            user,
            isOrphan: true
          };
        }
      }
    }

    if (!bestMatch || bestScore < 30) {
      // Re-evaluate an existing correlation. CONFIDENCE reflects how strongly the
      // buyer's IDENTITY corroborates the click's user (name / ML nickname / zip /
      // city/state). An item-id match alone (clicking our tracked link for a
      // popular product) is kept but at LOW confidence — it is NOT proof this
      // person is the buyer. Identity signals promote it to medium/high.
      if (existingCorrelation) {
        const clickUser = await User.findOne({ psid: existingCorrelation.psid }).lean();
        let nameMatches = false, cityMatches = false, stateMatches = false, zipMatches = false;
        if (clickUser) {
          const userFirstName = normalizeName(clickUser.firstName || clickUser.first_name);
          const userCity = normalizeCity(clickUser.location?.city);
          const userState = normalizeCity(clickUser.location?.state);
          const userZip = clickUser.location?.zipcode;
          nameMatches = !!(userFirstName && ((buyerFirstName && userFirstName === buyerFirstName) ||
            (buyerInfo.nickname && nameInNickname(userFirstName, buyerInfo.nickname))));
          cityMatches = !!(userCity && normalizedShippingCity && userCity === normalizedShippingCity);
          stateMatches = !!(userState && normalizedShippingState && userState === normalizedShippingState);
          zipMatches = !!(userZip && shippingZipCode && userZip === shippingZipCode);
        }
        const hasItemMatch = !!(existingCorrelation.mlItemId && orderedMLItemIds.includes(existingCorrelation.mlItemId));
        const hasIdentity = nameMatches || cityMatches || stateMatches || zipMatches;

        // Tier: identity (esp. name+location or zip) → high; identity-only signal
        // → medium; item-id alone (no identity) → low; nothing → low.
        const method = hasIdentity ? (hasItemMatch ? 'ml_item_match' : 'enhanced') : (hasItemMatch ? 'ml_item_match' : 'time_based');
        let confidence;
        if (hasIdentity && (zipMatches || (nameMatches && (cityMatches || stateMatches)))) confidence = 'high';
        else if (hasIdentity) confidence = 'medium';
        else confidence = 'low'; // item-id or time only — unconfirmed buyer
        await ClickLog.findByIdAndUpdate(existingCorrelation._id, {
          correlationMethod: method,
          correlationConfidence: confidence,
          correlatedOrderId: String(orderId)
        });
        console.log(`   ✅ Updated existing correlation for order ${orderId} (${method}, ${confidence})`);
        // One order → one converted click.
        await demoteOtherClicksForOrder(orderId, existingCorrelation._id);
        return { alreadyCorrelated: true, clickLog: existingCorrelation, method, confidence };
      }
      console.log(`   ❌ No suitable match found for order ${orderId} (best score: ${bestScore})`);
      return null;
    }

    // Log match details
    const md = bestMatch.matchDetails || {};
    console.log(`   📊 Best match score: ${bestScore}`);
    console.log(`      ML Item: ${md.mlItemMatch ? 'YES' : 'no'}, Name: ${md.nameMatch ? 'YES' : 'no'}, POI: ${md.poiMatch ? 'YES' : 'no'}`);
    console.log(`      City: ${md.cityMatch ? 'YES' : 'no'}, State: ${md.stateMatch ? 'YES' : 'no'}, Zip: ${md.zipMatch ? 'YES' : 'no'}`);

    // Determine method based on what actually matched
    const hasMLItemMatch = md.mlItemMatch || false;
    // Identity signals (the proprietary telltales): name / ML nickname, zip,
    // city, state, POI. These — not the item-id — are what tie a BUYER to a click.
    const hasIdentity = md.nameMatch || md.cityMatch || md.stateMatch || md.zipMatch || md.poiMatch;

    let method;
    if (hasIdentity && hasMLItemMatch) {
      method = 'ml_item_match';
    } else if (hasIdentity) {
      method = 'enhanced';
    } else if (hasMLItemMatch) {
      method = 'ml_item_match';
    } else {
      method = 'time_based';
    }

    // ── Confidence tiers (proprietary method) ───────────────────────────────
    // The item-id match alone only proves SOMEONE clicked our link for the
    // ordered product — it does NOT prove this person is the buyer (a popular
    // promo gets many clicks per order; that's how a 6x4 order by another buyer
    // got pinned to a click). So item-id WITHOUT an identity telltale is kept but
    // LOW confidence — not the fake "high" it used to get. Identity corroboration
    // (name/zip/city) promotes it to medium/high.
    let confidence;
    if (hasIdentity && (md.zipMatch || (md.nameMatch && (md.cityMatch || md.stateMatch)) || bestScore >= 135)) {
      confidence = 'high'; // strong identity (+ usually item) → confirmed buyer
    } else if (hasIdentity) {
      confidence = 'medium'; // a single identity telltale
    } else {
      confidence = 'low'; // item-id and/or time only — buyer not confirmed
    }

    // Handle orphan correlation (no click, just user match)
    if (bestMatch.isOrphan) {
      return await saveOrphanCorrelation(bestMatch.user, order, confidence, bestMatch.matchDetails, {
        shippingCity, shippingState, shippingZipCode,
        buyerFirstName, buyerLastName, receiverName
      });
    }

    // Normal click-based correlation
    return await saveCorrelation(bestMatch.click, order, confidence, method, {
      ...bestMatch.matchDetails,
      shippingCity, shippingState, shippingZipCode,
      buyerFirstName, buyerLastName, receiverName,
      hoursAgo: bestMatch.hoursAgo
    });

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
