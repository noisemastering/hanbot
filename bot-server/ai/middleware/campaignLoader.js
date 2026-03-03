/**
 * Enrichment middleware: campaignLoader
 *
 * Attempts to load the active Campaign document through three strategies
 * (in priority order):
 *   1. referral.ref / convo.campaignRef  — direct campaign lookup
 *   2. sourceContext.ad.campaign         — already resolved by sourceContext
 *   3. convo.adId                        — reverse-resolve via campaignResolver
 *
 * Sets ctx.campaign and ctx.campaignContext for downstream middleware.
 * Always calls next() — never sets ctx.response.
 */

const Campaign = require("../../models/Campaign");
const { updateConversation } = require("../../conversationManager");

module.exports = async function campaignLoader(ctx, next) {
  const { referral, convo, psid, sourceContext } = ctx;

  let campaign = null;
  let campaignContext = null;

  // Strategy 1: lookup by ref
  const campaignRef = referral?.ref || convo?.campaignRef;
  if (campaignRef) {
    try {
      campaign = await Campaign.findOne({ ref: campaignRef, active: true });
      if (campaign) {
        campaignContext = campaign.toAIContext();
        if (!convo?.campaignRef && referral?.ref) {
          await updateConversation(psid, { campaignRef: campaign.ref });
        }
      }
    } catch (err) {
      console.error(`⚠️ Error loading campaign:`, err.message);
    }
  }

  // Strategy 2: already resolved by sourceContext middleware
  if (!campaign && sourceContext?.ad?.campaign) {
    campaign = sourceContext.ad.campaign;
  }

  // Strategy 3: reverse-resolve from Facebook ad ID
  if (!campaign && convo?.adId) {
    try {
      const { resolveByAdId } = require("../../utils/campaignResolver");
      const resolved = await resolveByAdId(convo.adId);
      if (resolved?.campaignId) {
        campaign = await Campaign.findById(resolved.campaignId);
        if (campaign) {
          campaignContext = campaign.toAIContext?.() || null;
        }
      }
    } catch (err) {
      console.error(`⚠️ Error resolving campaign from adId:`, err.message);
    }
  }

  ctx.campaign = campaign;
  ctx.campaignContext = campaignContext;

  await next();
};
