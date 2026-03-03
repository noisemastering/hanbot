// ai/utils/intentDBHandler.js
// Handles intents configured in the DB (auto_response, human_handoff, ai_generate, flow).
const Intent = require("../../models/Intent");
const { updateConversation } = require("../../conversationManager");
const { getHandoffTimingMessage } = require("./businessHours");
const { startFlow, getFlowByIntent } = require("../flowExecutor");

/**
 * Handle intent based on DB configuration (responseTemplate + handlerType)
 * @param {string} intentKey - The classified intent key
 * @param {object} classification - Full classification result
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @param {string|null} userMessage - Original user message
 * @returns {object|null} Response if handled, null to continue to flows
 */
async function handleIntentFromDB(intentKey, classification, psid, convo, userMessage = null) {
  try {
    const intent = await Intent.findOne({ key: intentKey, active: true });

    if (!intent) {
      console.log(`📋 No DB intent found for "${intentKey}", continuing to flows`);
      return null;
    }

    await Intent.updateOne(
      { _id: intent._id },
      { $inc: { hitCount: 1 }, $set: { lastTriggered: new Date() } }
    );

    console.log(`📋 DB Intent matched: ${intent.name} (${intent.handlerType})`);

    switch (intent.handlerType) {
      case 'auto_response':
        if (intent.responseTemplate) {
          console.log(`✅ Auto-response from DB template`);
          return {
            type: "text",
            text: intent.responseTemplate,
            handledBy: "intent_auto_response"
          };
        }
        console.log(`⚠️ auto_response but no template defined, continuing to flows`);
        return null;

      case 'human_handoff':
        console.log(`🤝 Intent triggers human handoff`);
        await updateConversation(psid, {
          handoffRequested: true,
          handoffReason: `Intent: ${intent.name}`,
          handoffTimestamp: new Date(),
          state: "needs_human"
        });
        return {
          type: "text",
          text: intent.responseTemplate || `Te comunico con un especialista. ${getHandoffTimingMessage()}`,
          handledBy: "intent_human_handoff"
        };

      case 'ai_generate':
        if (intent.responseTemplate) {
          classification.responseGuidance = intent.responseTemplate;
          classification.intentName = intent.name;
          console.log(`🤖 AI will use template as guidance: "${intent.responseTemplate.substring(0, 50)}..."`);
        }
        return null;

      case 'flow':
        const linkedFlow = await getFlowByIntent(intentKey);
        if (linkedFlow) {
          console.log(`🔀 Intent has linked flow: ${linkedFlow.name}`);
          return await startFlow(linkedFlow.key, psid, convo, userMessage);
        }
        console.log(`⚠️ handlerType=flow but no linked flow found`);
        return null;

      default:
        return null;
    }
  } catch (error) {
    console.error(`❌ Error handling intent from DB:`, error.message);
    return null;
  }
}

module.exports = { handleIntentFromDB };
