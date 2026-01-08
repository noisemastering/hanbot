const { randomUUID } = require('crypto');
const ClickLog = require('./models/ClickLog');

/**
 * Generate a trackable click link
 * @param {string} psid - User's PSID
 * @param {string} originalUrl - The actual destination URL
 * @param {object} options - Additional tracking data
 * @returns {Promise<string>} - The trackable link
 */
async function generateClickLink(psid, originalUrl, options = {}) {
  const clickId = randomUUID().slice(0, 8);

  const clickLog = new ClickLog({
    clickId,
    psid,
    originalUrl,
    productName: options.productName,
    productId: options.productId,
    campaignId: options.campaignId,
    adSetId: options.adSetId,
    adId: options.adId,
    city: options.city,
    stateMx: options.stateMx
  });

  await clickLog.save();

  // Use environment variable for base URL, fallback to localhost
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
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
