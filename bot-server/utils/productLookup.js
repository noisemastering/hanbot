// utils/productLookup.js
const Ad = require("../models/Ad");
const AdSet = require("../models/AdSet");
const Campaign = require("../models/Campaign");
const ProductFamily = require("../models/ProductFamily");

/**
 * Get products for a user based on their conversation's ad/campaign association
 * Checks in order: Ad -> AdSet -> Campaign
 * @param {Object} conversation - The conversation object with adId, campaignId
 * @returns {Array} - Array of populated Product documents
 */
async function getProductsForConversation(conversation) {
  try {
    // If there's an adId, try to get products from the ad
    if (conversation.adId) {
      const ad = await Ad.findOne({ fbAdId: conversation.adId }).populate("productIds");
      if (ad && ad.productIds && ad.productIds.length > 0) {
        console.log(`✅ Found ${ad.productIds.length} products from Ad ${conversation.adId}`);
        return ad.productIds;
      }

      // If ad has no products, try the parent ad set
      if (ad && ad.adSetId) {
        const adSet = await AdSet.findById(ad.adSetId).populate("productIds");
        if (adSet && adSet.productIds && adSet.productIds.length > 0) {
          console.log(`✅ Found ${adSet.productIds.length} products from AdSet ${adSet.fbAdSetId}`);
          return adSet.productIds;
        }

        // If ad set has no products, try the parent campaign
        if (adSet && adSet.campaignId) {
          const campaign = await Campaign.findById(adSet.campaignId).populate("productIds");
          if (campaign && campaign.productIds && campaign.productIds.length > 0) {
            console.log(`✅ Found ${campaign.productIds.length} products from Campaign ${campaign.ref}`);
            return campaign.productIds;
          }
        }
      }
    }

    // Fallback: try to find campaign by campaignRef
    if (conversation.campaignRef) {
      const campaign = await Campaign.findOne({ ref: conversation.campaignRef }).populate("productIds");
      if (campaign && campaign.productIds && campaign.productIds.length > 0) {
        console.log(`✅ Found ${campaign.productIds.length} products from Campaign ref ${conversation.campaignRef}`);
        return campaign.productIds;
      }
    }

    console.log(`⚠️ No products found for conversation. Returning empty array.`);
    return [];
  } catch (error) {
    console.error("❌ Error looking up products for conversation:", error);
    return [];
  }
}

module.exports = {
  getProductsForConversation
};
