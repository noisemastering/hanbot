/**
 * Enrichment middleware: wholesaleFlag
 *
 * Automatically marks the conversation as a wholesale inquiry when the
 * campaign audience type is "reseller".  This ensures that downstream
 * pricing and quoting middleware use wholesale rates.
 *
 * Always calls next() — never sets ctx.response.
 */

const { updateConversation } = require("../../conversationManager");

module.exports = async function wholesaleFlag(ctx, next) {
  const { convo, campaign, sourceContext, psid } = ctx;

  if (!convo.isWholesaleInquiry && campaign) {
    const audienceType =
      sourceContext?.ad?.campaignAudience?.type || campaign.audience?.type;

    if (audienceType === "reseller") {
      await updateConversation(psid, { isWholesaleInquiry: true });
      convo.isWholesaleInquiry = true;
      console.log(
        `🏪 Reseller audience detected from campaign "${campaign.name}" — marking as wholesale`
      );
    }
  }

  await next();
};
