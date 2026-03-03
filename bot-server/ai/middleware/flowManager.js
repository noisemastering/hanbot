/**
 * Routing middleware: flowManager
 *
 * Thin wrapper around the flow manager's processMessage(). The flow manager
 * handles product-specific conversational flows (malla sombra, rollo, borde,
 * groundcover, monofilamento, etc.) including spec collection, quoting, and
 * catalog navigation.
 */

const { processMessage: processWithFlowManager } = require("../flowManager");

module.exports = async function flowManager(ctx, next) {
  const { userMessage, psid, convo, classification, sourceContext, campaign } = ctx;

  try {
    const response = await processWithFlowManager(
      userMessage, psid, convo, classification, sourceContext, campaign
    );
    if (response) {
      console.log(`\u2705 Flow manager handled message (${response.handledBy})`);
      ctx.response = response;
      ctx.handledBy = response.handledBy || "flow_manager";
      return;
    }
  } catch (flowError) {
    console.error(`\u274C Error in flow manager:`, flowError.message);
  }

  await next();
};
