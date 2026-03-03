/**
 * Routing middleware: activeFlowCheck
 *
 * Checks whether the user is currently inside a DB-driven flow (via
 * flowExecutor). If so, processes the current flow step. This runs early
 * in the pipeline so active flows take priority over general intent
 * dispatching.
 */

const { isInFlow, processFlowStep } = require("../flowExecutor");

module.exports = async function activeFlowCheck(ctx, next) {
  const { userMessage, psid, convo } = ctx;

  if (isInFlow(convo)) {
    console.log(`\u{1F504} User is in active flow: ${convo.activeFlow.flowKey}`);
    const flowResponse = await processFlowStep(userMessage, psid, convo);
    if (flowResponse) {
      ctx.response = flowResponse;
      ctx.handledBy = flowResponse.handledBy || "active_flow";
      return;
    }
    console.log(`\u26A0\uFE0F Flow returned null, continuing with normal processing`);
  }

  await next();
};
