/**
 * Routing middleware: intentDB
 *
 * Checks the Intent DB for a matching auto_response or handoff configuration
 * for the classified intent. This allows intent behaviour to be configured
 * in the database without code changes (e.g. toggling auto-responses or
 * handoff rules from the admin panel).
 */

const { handleIntentFromDB } = require("../utils/intentDBHandler");

module.exports = async function intentDB(ctx, next) {
  const { classification, psid, convo, userMessage } = ctx;

  const intentResponse = await handleIntentFromDB(
    classification.intent, classification, psid, convo, userMessage
  );

  if (intentResponse) {
    console.log(`\u2705 Intent handled by DB config (${intentResponse.handledBy})`);
    ctx.response = intentResponse;
    ctx.handledBy = intentResponse.handledBy || "intent_db";
    return;
  }

  await next();
};
