// ai/context/sourceDetector.js
// Layer 0: Detect where this conversation came from
// This is the FIRST thing we determine before any intent classification

const Conversation = require("../../models/Conversation");

/**
 * Entry point types
 */
const ENTRY_POINTS = {
  AD_CLICK: "ad_click",           // Clicked on Facebook/Instagram ad
  COMMENT: "comment",             // Replied to a comment or post
  DIRECT_MESSAGE: "direct_message", // Cold DM, no referral
  REFERRAL: "referral",           // m.me link with ?ref= parameter
  RETURNING: "returning"          // User returning to existing conversation
};

/**
 * Channel types
 */
const CHANNELS = {
  FACEBOOK: "facebook",
  WHATSAPP: "whatsapp"
};

/**
 * Detect source context from webhook event and conversation
 *
 * @param {object} webhookEvent - Raw webhook event from Facebook/WhatsApp
 * @param {object} convo - Existing conversation document (if any)
 * @param {string} channel - 'facebook' or 'whatsapp'
 * @returns {object} Source context object
 */
async function detectSource(webhookEvent, convo, channel) {
  const source = {
    channel: channel || CHANNELS.FACEBOOK,
    entryPoint: ENTRY_POINTS.DIRECT_MESSAGE,
    isFirstMessage: !convo || convo.state === "new",
    isReturning: false,

    // Ad context (populated if from ad)
    ad: null,

    // Comment context (populated if from comment/post)
    comment: null,

    // User history
    history: {
      previousProducts: [],
      lastConvoDate: null,
      totalConversations: 0
    }
  };

  // Detect entry point
  const referral = webhookEvent?.referral || webhookEvent?.postback?.referral;

  if (referral) {
    // Came from ad or referral link
    if (referral.ad_id) {
      source.entryPoint = ENTRY_POINTS.AD_CLICK;
      source.ad = {
        id: referral.ad_id,
        campaignId: referral.campaign_id || null,
        ref: referral.ref || null,
        // These will be populated by adContextMapper
        product: null,
        angle: null,
        audienceType: null,
        offerHook: null
      };
    } else if (referral.ref) {
      source.entryPoint = ENTRY_POINTS.REFERRAL;
      source.ad = {
        ref: referral.ref,
        product: null
      };
    }
  } else if (convo && convo.adId) {
    // Existing conversation that started from ad
    source.entryPoint = ENTRY_POINTS.AD_CLICK;
    source.ad = {
      id: convo.adId,
      campaignId: convo.campaignId || null,
      ref: convo.campaignRef || null,
      product: convo.productInterest || null,
      angle: null,
      audienceType: null,
      offerHook: null
    };
  }

  // Check if this is a returning user
  if (convo) {
    const hoursSinceLastMessage = convo.lastMessageAt
      ? (Date.now() - new Date(convo.lastMessageAt).getTime()) / (1000 * 60 * 60)
      : 0;

    // Consider "returning" if more than 24 hours since last message
    if (hoursSinceLastMessage > 24) {
      source.isReturning = true;
      source.entryPoint = ENTRY_POINTS.RETURNING;
    }

    source.history = {
      previousProducts: convo.productInterest ? [convo.productInterest] : [],
      lastConvoDate: convo.lastMessageAt,
      totalConversations: 1 // TODO: Count from Message collection
    };
  }

  console.log(`📍 Source detected:`, {
    channel: source.channel,
    entryPoint: source.entryPoint,
    isFirstMessage: source.isFirstMessage,
    isReturning: source.isReturning,
    adId: source.ad?.id || null
  });

  return source;
}

/**
 * Check if this is a truly cold start (no context at all)
 * @param {object} source - Source context from detectSource
 * @returns {boolean}
 */
function isTrulyCold(source) {
  return (
    source.entryPoint === ENTRY_POINTS.DIRECT_MESSAGE &&
    !source.isReturning &&
    source.history.previousProducts.length === 0
  );
}

/**
 * Get the product context from source (ad product or previous interest)
 * @param {object} source - Source context
 * @returns {string|null} Product type or null
 */
function getProductFromSource(source) {
  // Priority: ad product > flow product > previous products
  if (source.ad?.product) {
    return source.ad.product;
  }
  if (source.history?.previousProducts?.length > 0) {
    return source.history.previousProducts[0];
  }
  return null;
}

module.exports = {
  detectSource,
  isTrulyCold,
  getProductFromSource,
  ENTRY_POINTS,
  CHANNELS
};
