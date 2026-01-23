// utils/campaignResolver.js
// Resolves effective campaign settings with inheritance: Campaign → AdSet → Ad

const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');

/**
 * Deep merge two objects, with source overriding target for non-null values
 */
function deepMerge(target, source) {
  if (!source) return target;
  if (!target) return source;

  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    // Skip null, undefined, empty strings, and empty arrays
    if (sourceVal === null || sourceVal === undefined || sourceVal === '') continue;
    if (Array.isArray(sourceVal) && sourceVal.length === 0) continue;

    // If both are objects (not arrays), merge recursively
    if (
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      // Otherwise, source overrides target
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Resolve effective settings for a conversation based on Ad ID
 * Merges: Campaign → AdSet → Ad (Ad has highest priority)
 *
 * @param {string} fbAdId - Facebook Ad ID
 * @returns {object} Merged settings object
 */
async function resolveByAdId(fbAdId) {
  try {
    const ad = await Ad.findOne({ fbAdId }).lean();
    if (!ad) return null;

    const adSet = await AdSet.findById(ad.adSetId).lean();
    if (!adSet) return null;

    const campaign = await Campaign.findById(adSet.campaignId).lean();
    if (!campaign) return null;

    return mergeSettings(campaign, adSet, ad);
  } catch (error) {
    console.error('Error resolving campaign by Ad ID:', error);
    return null;
  }
}

/**
 * Resolve effective settings for a conversation based on AdSet ID
 * Merges: Campaign → AdSet
 *
 * @param {string} fbAdSetId - Facebook AdSet ID
 * @returns {object} Merged settings object
 */
async function resolveByAdSetId(fbAdSetId) {
  try {
    const adSet = await AdSet.findOne({ fbAdSetId }).lean();
    if (!adSet) return null;

    const campaign = await Campaign.findById(adSet.campaignId).lean();
    if (!campaign) return null;

    return mergeSettings(campaign, adSet, null);
  } catch (error) {
    console.error('Error resolving campaign by AdSet ID:', error);
    return null;
  }
}

/**
 * Resolve effective settings for a conversation based on Campaign ID
 *
 * @param {string} fbCampaignId - Facebook Campaign ID
 * @returns {object} Campaign settings
 */
async function resolveByCampaignId(fbCampaignId) {
  try {
    const campaign = await Campaign.findOne({ fbCampaignId }).lean();
    if (!campaign) return null;

    return mergeSettings(campaign, null, null);
  } catch (error) {
    console.error('Error resolving campaign by Campaign ID:', error);
    return null;
  }
}

/**
 * Resolve by campaign ref (e.g., "malla_agricola_rollo_2025")
 */
async function resolveByCampaignRef(ref) {
  try {
    const campaign = await Campaign.findOne({ ref }).lean();
    if (!campaign) return null;

    return mergeSettings(campaign, null, null);
  } catch (error) {
    console.error('Error resolving campaign by ref:', error);
    return null;
  }
}

/**
 * Merge settings from Campaign, AdSet, and Ad
 * Returns a unified settings object for the AI
 */
function mergeSettings(campaign, adSet, ad) {
  // Start with campaign-level settings
  let settings = {
    // Identity
    campaignId: campaign._id,
    campaignRef: campaign.ref,
    campaignName: campaign.name,

    // Traffic source
    trafficSource: campaign.trafficSource,

    // Ad context
    adContext: {
      angle: campaign.ad?.angle,
      summary: campaign.ad?.summary,
      cta: campaign.ad?.cta,
      offerHook: campaign.ad?.offerHook
    },

    // Audience
    audience: {
      type: campaign.audience?.type,
      experienceLevel: campaign.audience?.experienceLevel
    },

    // Products
    products: campaign.products || [],
    productIds: campaign.productIds || [],

    // Conversation settings
    conversationGoal: campaign.conversationGoal,
    responseGuidelines: {
      tone: campaign.responseGuidelines?.tone,
      mustNot: campaign.responseGuidelines?.mustNot || [],
      shouldDo: campaign.responseGuidelines?.shouldDo || []
    },

    // Messages
    initialMessage: campaign.initialMessage,
    followupPrompts: campaign.followupPrompts || [],

    // Flow
    flowRef: null
  };

  // Merge AdSet-level overrides
  if (adSet) {
    settings.adSetId = adSet._id;
    settings.adSetName = adSet.name;

    // Merge audience
    if (adSet.audience?.type) settings.audience.type = adSet.audience.type;
    if (adSet.audience?.experienceLevel) settings.audience.experienceLevel = adSet.audience.experienceLevel;

    // Override conversation goal
    if (adSet.conversationGoal) settings.conversationGoal = adSet.conversationGoal;

    // Merge response guidelines
    if (adSet.responseGuidelines?.tone) settings.responseGuidelines.tone = adSet.responseGuidelines.tone;
    if (adSet.responseGuidelines?.mustNot?.length) settings.responseGuidelines.mustNot = adSet.responseGuidelines.mustNot;
    if (adSet.responseGuidelines?.shouldDo?.length) settings.responseGuidelines.shouldDo = adSet.responseGuidelines.shouldDo;

    // Override initial message
    if (adSet.initialMessage) settings.initialMessage = adSet.initialMessage;

    // Override flow
    if (adSet.flowRef) settings.flowRef = adSet.flowRef;

    // Merge ad context
    if (adSet.adContext?.angle) settings.adContext.angle = adSet.adContext.angle;
    if (adSet.adContext?.summary) settings.adContext.summary = adSet.adContext.summary;
    if (adSet.adContext?.cta) settings.adContext.cta = adSet.adContext.cta;
    if (adSet.adContext?.offerHook) settings.adContext.offerHook = adSet.adContext.offerHook;

    // Override products if specified at adSet level
    if (adSet.productIds?.length) settings.productIds = adSet.productIds;
  }

  // Merge Ad-level overrides (highest priority)
  if (ad) {
    settings.adId = ad._id;
    settings.adName = ad.name;
    settings.fbAdId = ad.fbAdId;

    // Merge audience
    if (ad.audience?.type) settings.audience.type = ad.audience.type;
    if (ad.audience?.experienceLevel) settings.audience.experienceLevel = ad.audience.experienceLevel;

    // Override conversation goal
    if (ad.conversationGoal) settings.conversationGoal = ad.conversationGoal;

    // Merge response guidelines
    if (ad.responseGuidelines?.tone) settings.responseGuidelines.tone = ad.responseGuidelines.tone;
    if (ad.responseGuidelines?.mustNot?.length) settings.responseGuidelines.mustNot = ad.responseGuidelines.mustNot;
    if (ad.responseGuidelines?.shouldDo?.length) settings.responseGuidelines.shouldDo = ad.responseGuidelines.shouldDo;

    // Override initial message
    if (ad.initialMessage) settings.initialMessage = ad.initialMessage;

    // Override flow
    if (ad.flowRef) settings.flowRef = ad.flowRef;

    // Merge ad context
    if (ad.adContext?.angle) settings.adContext.angle = ad.adContext.angle;
    if (ad.adContext?.summary) settings.adContext.summary = ad.adContext.summary;
    if (ad.adContext?.cta) settings.adContext.cta = ad.adContext.cta;
    if (ad.adContext?.offerHook) settings.adContext.offerHook = ad.adContext.offerHook;

    // Ad-specific intent
    if (ad.adIntent) {
      settings.adIntent = ad.adIntent;
    }
    if (ad.adAngle) {
      settings.adAngle = ad.adAngle;
    }

    // Override products if specified at ad level
    if (ad.productIds?.length) settings.productIds = ad.productIds;
    if (ad.mainProductId) settings.mainProductId = ad.mainProductId;
  }

  return settings;
}

/**
 * Main resolver - tries Ad ID, then AdSet ID, then Campaign ID
 */
async function resolve({ fbAdId, fbAdSetId, fbCampaignId, campaignRef }) {
  if (fbAdId) {
    const result = await resolveByAdId(fbAdId);
    if (result) return result;
  }

  if (fbAdSetId) {
    const result = await resolveByAdSetId(fbAdSetId);
    if (result) return result;
  }

  if (fbCampaignId) {
    const result = await resolveByCampaignId(fbCampaignId);
    if (result) return result;
  }

  if (campaignRef) {
    const result = await resolveByCampaignRef(campaignRef);
    if (result) return result;
  }

  return null;
}

module.exports = {
  resolve,
  resolveByAdId,
  resolveByAdSetId,
  resolveByCampaignId,
  resolveByCampaignRef,
  mergeSettings
};
