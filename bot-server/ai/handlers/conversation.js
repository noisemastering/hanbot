// ai/handlers/conversation.js
// Handlers for conversation flow intents: future interest, will get back

const { updateConversation } = require("../../conversationManager");
const { generateBotResponse } = require("../responseGenerator");

/**
 * Handle future interest - "En un par de meses", "Más adelante"
 * User is interested but not ready to buy now
 */
async function handleFutureInterest({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "future_interest",
    leadStatus: "future",
    unknownCount: 0
  });

  const response = await generateBotResponse("future_interest", {
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle will get back - "Mañana te aviso", "Voy a medir"
 * User needs to take action before continuing
 */
async function handleWillGetBack({ psid, convo, userMessage }) {
  // Detect if they mentioned measuring
  const isMeasuring = /\b(medir|medidas|mido)\b/i.test(userMessage);

  await updateConversation(psid, {
    lastIntent: "will_get_back",
    leadStatus: "pending_action",
    unknownCount: 0
  });

  const response = await generateBotResponse("will_get_back", {
    isMeasuring,
    convo
  });

  return { type: "text", text: response };
}

// Note: CONFIRMATION and REJECTION intents are context-dependent
// They are handled by product flows (mallaFlow, defaultFlow, etc.)
// rather than here because they need to know what was offered

module.exports = {
  handleFutureInterest,
  handleWillGetBack
};
