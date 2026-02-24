const { randomUUID } = require('crypto');
const ClickLog = require('./models/ClickLog');

/**
 * Extract ML Item ID from a Mercado Libre URL
 * Handles formats like:
 * - https://articulo.mercadolibre.com.mx/MLM-1234567890-titulo
 * - https://www.mercadolibre.com.mx/some-product/p/MLM12345678
 * - MLM1234567890 (already an ID)
 * @param {string} url - ML URL or item ID
 * @returns {string|null} - ML Item ID (e.g., "MLM1234567890") or null
 */
function extractMLItemId(url) {
  if (!url) return null;

  // Pattern 1: MLM-1234567890 or MLM1234567890 (with or without dash)
  const match = url.match(/MLM-?(\d+)/i);
  if (match) {
    return `MLM${match[1]}`;
  }

  return null;
}

/**
 * Generate a trackable click link
 * @param {string} psid - User's PSID
 * @param {string} originalUrl - The actual destination URL
 * @param {object} options - Additional tracking data
 * @returns {Promise<string>} - The trackable link
 */
async function generateClickLink(psid, originalUrl, options = {}) {
  const clickId = randomUUID().slice(0, 8);

  // Extract ML Item ID from URL for exact matching
  const mlItemId = extractMLItemId(originalUrl);

  const clickLog = new ClickLog({
    clickId,
    psid,
    originalUrl,
    mlItemId,  // Store extracted ML Item ID
    productName: options.productName,
    productId: options.productId,
    campaignId: options.campaignId,
    adSetId: options.adSetId,
    adId: options.adId,
    userName: options.userName,
    city: options.city,
    stateMx: options.stateMx
  });

  await clickLog.save();

  const baseUrl = process.env.BASE_URL || 'https://agente.hanlob.com.mx';
  return `${baseUrl}/r/${clickId}`;
}

/**
 * Get click data by click ID
 * @param {string} clickId - The click ID
 * @returns {Promise<object|null>} - The click log entry
 */
async function getClickData(clickId) {
  return await ClickLog.findOne({ clickId });
}

/**
 * Record a click
 * @param {string} clickId - The click ID
 * @param {object} metadata - Additional click metadata (userAgent, ip, etc.)
 * @returns {Promise<object|null>} - Updated click log entry
 */
async function recordClick(clickId, metadata = {}) {
  return await ClickLog.findOneAndUpdate(
    { clickId },
    {
      clicked: true,
      clickedAt: new Date(),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      referrer: metadata.referrer
    },
    { new: true }
  );
}

/**
 * Record a conversion
 * @param {string} clickId - The click ID
 * @param {object} conversionData - Conversion details
 * @returns {Promise<object|null>} - Updated click log entry
 */
async function recordConversion(clickId, conversionData = {}) {
  return await ClickLog.findOneAndUpdate(
    { clickId },
    {
      converted: true,
      convertedAt: new Date(),
      conversionData
    },
    { new: true }
  );
}

/**
 * Get click statistics for a user
 * @param {string} psid - User's PSID
 * @returns {Promise<object>} - Click statistics
 */
async function getClickStats(psid) {
  const total = await ClickLog.countDocuments({ psid });
  const clicked = await ClickLog.countDocuments({ psid, clicked: true });
  const converted = await ClickLog.countDocuments({ psid, converted: true });

  return {
    total,
    clicked,
    converted,
    clickRate: total > 0 ? (clicked / total) * 100 : 0,
    conversionRate: clicked > 0 ? (converted / clicked) * 100 : 0
  };
}

module.exports = {
  generateClickLink,
  getClickData,
  recordClick,
  recordConversion,
  getClickStats
};
