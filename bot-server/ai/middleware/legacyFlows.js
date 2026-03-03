/**
 * Routing middleware: legacyFlows
 *
 * Thin wrapper around the legacy flow system's processMessage(). This is the
 * older flow routing layer (ai/flows/index.js) that handles cold starts,
 * product routing, and fallback flow logic. It runs after the newer
 * flowManager so it only fires when the newer system doesn't handle the
 * message.
 */

const { processMessage: processWithFlows } = require("../flows");

module.exports = async function legacyFlows(ctx, next) {
  const { userMessage, psid, convo, classification, sourceContext, campaign } = ctx;

  try {
    const response = await processWithFlows(
      classification, sourceContext, convo, psid, userMessage, campaign
    );
    if (response) {
      console.log(`\u2705 Legacy flow system handled message (${response.handledBy})`);
      ctx.response = response;
      ctx.handledBy = response.handledBy || "legacy_flows";
      return;
    }
  } catch (legacyError) {
    console.error(`\u274C Error in legacy flows:`, legacyError.message);
  }

  await next();
};
