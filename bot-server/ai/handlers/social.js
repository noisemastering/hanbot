// ai/handlers/social.js
// Handlers for social intents: greeting, thanks, goodbye

const { updateConversation } = require("../../conversationManager");
const { generateBotResponse } = require("../responseGenerator");

/**
 * Handle greeting intent
 * @param {object} context - { intent, entities, confidence, psid, convo, userMessage }
 */
async function handleGreeting({ psid, convo }) {
  // Check if returning user
  const isReturningUser = convo?.greeted && convo?.lastMessageAt;
  let hoursSinceLastMessage = null;

  if (isReturningUser) {
    hoursSinceLastMessage = (Date.now() - new Date(convo.lastMessageAt).getTime()) / (1000 * 60 * 60);
  }

  await updateConversation(psid, {
    greeted: true,
    lastIntent: "greeting",
    unknownCount: 0
  });

  const response = await generateBotResponse("greeting", {
    isReturningUser,
    hoursSinceLastMessage,
    productInterest: convo?.productInterest,
    userName: convo?.userName,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle thanks intent
 */
async function handleThanks({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "thanks",
    unknownCount: 0
  });

  const response = await generateBotResponse("thanks", { convo });

  return { type: "text", text: response };
}

/**
 * Handle goodbye intent
 */
async function handleGoodbye({ psid, convo, entities }) {
  await updateConversation(psid, {
    lastIntent: "goodbye",
    state: "closed",
    unknownCount: 0
  });

  // Spam/inappropriate content - close silently, don't engage
  if (entities?.spam) {
    console.log(`🚫 Spam detected for ${psid} - closing silently`);
    return null;
  }

  const response = await generateBotResponse("goodbye", {
    userName: convo?.userName,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleGreeting,
  handleThanks,
  handleGoodbye
};
