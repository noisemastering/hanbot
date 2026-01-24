// ai/context/index.js
// Layer 0: Source Context Detection
// This is the FIRST layer - determines where the conversation came from

const { detectSource, isTrulyCold, getProductFromSource, ENTRY_POINTS, CHANNELS } = require("./sourceDetector");
const { enrichAdContext, inferProductFromRef, getAdGreeting, getToneFromAngle, PRODUCT_TYPES } = require("./adContextMapper");
const { getUserHistory, getReturningGreeting, isHighValueUser } = require("./userHistory");

/**
 * Build complete source context for a conversation
 * This is the main entry point for Layer 0
 *
 * @param {object} webhookEvent - Raw webhook event
 * @param {object} convo - Existing conversation (if any)
 * @param {string} channel - 'facebook' or 'whatsapp'
 * @returns {object} Complete source context
 */
async function buildSourceContext(webhookEvent, convo, channel = "facebook") {
  console.log(`\n🔍 ===== LAYER 0: SOURCE CONTEXT =====`);

  // Step 1: Detect basic source (channel, entry point)
  let source = await detectSource(webhookEvent, convo, channel);

  // Step 2: Enrich with ad context (if from ad)
  if (source.ad?.id) {
    source = await enrichAdContext(source);
  }

  // Step 3: Try to infer product from ref (fallback)
  if (!source.ad?.product && source.ad?.ref) {
    source.ad.product = inferProductFromRef(source.ad.ref);
    if (source.ad.product) {
      console.log(`🔍 Inferred product from ref: ${source.ad.product}`);
    }
  }

  // Step 4: Get user history
  const psid = webhookEvent?.sender?.id || convo?.psid;
  if (psid) {
    source.history = await getUserHistory(psid, convo);
    source.isReturning = source.history.isReturning;
  }

  // Step 5: Determine if truly cold
  source.isTrulyCold = isTrulyCold(source);

  // Step 6: Get tone hints from ad angle
  if (source.ad?.angle) {
    source.tone = getToneFromAngle(source.ad.angle);
  }

  console.log(`📍 Source context complete:`, {
    channel: source.channel,
    entryPoint: source.entryPoint,
    product: getProductFromSource(source),
    isReturning: source.isReturning,
    isTrulyCold: source.isTrulyCold,
    angle: source.ad?.angle || "none"
  });
  console.log(`🔍 ===== END LAYER 0 =====\n`);

  return source;
}

/**
 * Get the appropriate greeting based on source context
 *
 * @param {object} source - Complete source context
 * @returns {string} Greeting message
 */
function getGreetingForSource(source) {
  // Returning user takes priority
  if (source.isReturning) {
    const returningGreeting = getReturningGreeting(source.history);
    if (returningGreeting) {
      return returningGreeting;
    }
  }

  // From ad
  if (source.ad?.product) {
    return getAdGreeting(source);
  }

  // Truly cold
  return "Hola, ¿qué tipo de producto te interesa?";
}

/**
 * Log source context for analytics (to be stored/analyzed later)
 *
 * @param {string} psid - User PSID
 * @param {object} source - Source context
 * @param {string} userMessage - The user's message
 */
function logSourceContext(psid, source, userMessage) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    psid: psid?.slice(-6) || "unknown",
    channel: source.channel,
    entryPoint: source.entryPoint,
    product: getProductFromSource(source),
    isReturning: source.isReturning,
    isTrulyCold: source.isTrulyCold,
    adId: source.ad?.id || null,
    adAngle: source.ad?.angle || null,
    messagePreview: userMessage?.slice(0, 50) || ""
  };

  // Log for now - later could write to analytics DB
  console.log(`📊 SOURCE_LOG:`, JSON.stringify(logEntry));
}

module.exports = {
  // Main function
  buildSourceContext,

  // Helpers
  getGreetingForSource,
  getProductFromSource,
  logSourceContext,

  // Re-export constants
  ENTRY_POINTS,
  CHANNELS,
  PRODUCT_TYPES,

  // Re-export individual modules for direct use
  detectSource,
  enrichAdContext,
  getUserHistory,
  getToneFromAngle
};
