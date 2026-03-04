// ai/utils/repetitionChecker.js
// Detects when the bot sends the same response twice and escalates to human.
const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getHandoffTimingMessage } = require("./businessHours");

/**
 * Check if response is a repetition and escalate to human if so.
 * Returns modified response if repetition detected, otherwise returns original.
 */
async function checkForRepetition(response, psid, convo) {
  if (!response || !response.text) return response;

  // Check time since last message - if more than 24 hours, treat as fresh conversation
  const lastMessageTime = convo.lastMessageAt ? new Date(convo.lastMessageAt) : null;
  const hoursSinceLastMessage = lastMessageTime
    ? (Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60)
    : 999;

  if (hoursSinceLastMessage > 24) {
    console.log(`⏰ Conversation resumed after ${hoursSinceLastMessage.toFixed(1)} hours - treating as fresh`);
    await updateConversation(psid, { lastBotResponse: response.text });
    return response;
  }

  // Normalize for comparison (remove emojis, URLs, extra spaces, lowercase)
  const normalizeText = (text) => {
    if (!text) return '';
    return text
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/https?:\/\/\S+/g, '[LINK]')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .substring(0, 300);
  };

  const currentNormalized = normalizeText(response.text);
  const lastNormalized = normalizeText(convo.lastBotResponse);

  if (lastNormalized && currentNormalized === lastNormalized) {
    console.log("🔄 REPETITION DETECTED - checking if it's same size request");

    // If customer already has a quoted product, confirm from conversation state (not bot text)
    const specs = convo.productSpecs || {};
    if (convo.lastSharedProductLink && specs.width && specs.height) {
      const size = `${specs.width}x${specs.height}`;
      const linkMatch = response.text.match(/(https:\/\/agente\.hanlob\.com\.mx\/r\/\w+)/);
      const link = linkMatch?.[1] || convo.lastSharedProductLink;

      console.log(`📏 Repetition with active quote — confirming ${size}m`);
      await updateConversation(psid, { lastIntent: "same_size_confirmation" });

      return {
        type: "text",
        text: `Es correcto, ${size}m con envío incluido. Puedes realizar tu compra aquí:\n\n${link}`
      };
    }

    // Logistics re-asks are valid, not bot loops
    const isLogisticsResponse = /quer[eé]taro|enviamos|env[ií]o|pago|tarjeta|mercado libre/i.test(response.text);
    if (isLogisticsResponse) {
      console.log(`📍 Logistics re-ask detected - allowing repeat response`);
      await updateConversation(psid, { lastBotResponse: response.text });
      return response;
    }

    // Not a price quote or logistics repetition - escalate to human
    console.log("🔄 Non-price repetition - escalating to human");

    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      handoffReason: "Bot attempted to repeat same response"
    });

    await sendHandoffNotification(psid, convo, "Bot detectó repetición - necesita atención humana");

    return {
      type: "text",
      text: `Déjame comunicarte con un especialista que pueda ayudarte mejor.\n\n${getHandoffTimingMessage()}`
    };
  }

  // Save this response for future comparison
  await updateConversation(psid, { lastBotResponse: response.text });

  return response;
}

module.exports = { checkForRepetition };
