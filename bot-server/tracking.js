const { randomUUID } = require('crypto');
const ClickLog = require('./models/ClickLog');
const Conversation = require('./models/Conversation');
const Ad = require('./models/Ad');

/**
 * Detect device type from a User-Agent string.
 * Returns: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
 */
function detectDevice(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/bot|crawler|spider|facebookexternalhit|whatsapp|slackbot|googlebot|bingbot/i.test(ua)) return 'bot';
  if (/ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

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
 * @param {string|null} psid - User's PSID (null for direct ad links)
 * @param {string} originalUrl - The actual destination URL
 * @param {object} options - Additional tracking data
 * @returns {Promise<string>} - The trackable link
 */
async function generateClickLink(psid, originalUrl, options = {}) {
  const clickId = randomUUID().slice(0, 8);

  // Extract ML Item ID from URL for exact matching
  const mlItemId = extractMLItemId(originalUrl);

  // Auto-populate adId, campaignId, and source from conversation if not provided
  if (psid && (!options.adId || !options.campaignId || !options.source)) {
    try {
      const convo = await Conversation.findOne({ psid })
        .select('adId campaignRef channel')
        .lean();
      if (convo) {
        if (!options.adId && convo.adId) options.adId = convo.adId;
        if (!options.campaignId && convo.campaignRef) options.campaignId = convo.campaignRef;
        if (!options.source && convo.channel) {
          options.source = convo.channel === 'whatsapp' ? 'whatsapp' : 'messenger';
        }
      }
    } catch (err) {
      // Non-critical — continue without attribution
    }
  }

  const clickLog = new ClickLog({
    clickId,
    psid: psid || null,
    originalUrl,
    mlItemId,  // Store extracted ML Item ID
    source: options.source || null,
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
      device: detectDevice(metadata.userAgent),
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

/**
 * Set a direct tracked link on an ad.
 * Generates a short trackCode; the redirect endpoint /r/d/:trackCode
 * creates a new ClickLog on every click (anonymous, source: 'direct_ad').
 * @param {string} adId - MongoDB _id of the Ad
 * @param {string} url - Destination URL (e.g., ML product page)
 * @returns {Promise<{ trackCode: string, trackedUrl: string }>}
 */
async function setDirectLink(adId, url) {
  const ad = await Ad.findById(adId)
    .populate({ path: 'adSetId', select: 'fbAdSetId campaignId', populate: { path: 'campaignId', select: 'ref' } });
  if (!ad) throw new Error('Ad not found');

  // Reuse existing trackCode if URL hasn't changed, otherwise generate new
  const trackCode = (ad.directLink?.url === url && ad.directLink?.trackCode)
    ? ad.directLink.trackCode
    : randomUUID().slice(0, 8);

  ad.directLink = { url, trackCode };
  await ad.save();

  const baseUrl = process.env.BASE_URL || 'https://agente.hanlob.com.mx';
  return { trackCode, trackedUrl: `${baseUrl}/r/d/${trackCode}` };
}

/**
 * Remove the direct tracked link from an ad.
 */
async function removeDirectLink(adId) {
  await Ad.updateOne({ _id: adId }, { $unset: { directLink: 1 } });
}

/**
 * Handle a click on a direct ad link.
 * Creates a NEW ClickLog per click (anonymous — no psid).
 * @param {string} trackCode - The ad's directLink.trackCode
 * @param {object} metadata - { userAgent, ipAddress, referrer }
 * @returns {Promise<{ originalUrl: string }|null>}
 */
async function recordDirectAdClick(trackCode, metadata = {}) {
  const ad = await Ad.findOne({ 'directLink.trackCode': trackCode })
    .populate({ path: 'adSetId', select: 'fbAdSetId campaignId', populate: { path: 'campaignId', select: 'ref' } });
  if (!ad || !ad.directLink?.url) return null;

  const mlItemId = extractMLItemId(ad.directLink.url);

  const clickLog = new ClickLog({
    clickId: randomUUID().slice(0, 8),
    psid: null,
    originalUrl: ad.directLink.url,
    mlItemId,
    source: 'direct_ad',
    adId: ad.fbAdId,
    adSetId: ad.adSetId?.fbAdSetId || null,
    campaignId: ad.adSetId?.campaignId?.ref || null,
    clicked: true,
    clickedAt: new Date(),
    userAgent: metadata.userAgent,
    device: detectDevice(metadata.userAgent),
    ipAddress: metadata.ipAddress,
    referrer: metadata.referrer
  });

  await clickLog.save();
  return { originalUrl: ad.directLink.url };
}

module.exports = {
  generateClickLink,
  getClickData,
  recordClick,
  recordConversion,
  getClickStats,
  setDirectLink,
  removeDirectLink,
  recordDirectAdClick
};
