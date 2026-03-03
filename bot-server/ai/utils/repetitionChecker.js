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

    // Check if this is a price/product quote (contains price and dimensions)
    const isPriceQuote = /\$[\d,]+/.test(response.text) &&
                         /\d+\s*[xX×]\s*\d+/.test(response.text);

    if (isPriceQuote) {
      const sizeMatch = response.text.match(/(\d+)\s*[xX×]\s*(\d+)/);
      const priceMatch = response.text.match(/\$([\d,]+)/);
      const linkMatch = response.text.match(/(https:\/\/agente\.hanlob\.com\.mx\/r\/\w+)/);

      if (sizeMatch && priceMatch) {
        const size = `${sizeMatch[1]}x${sizeMatch[2]}`;
        const price = priceMatch[1];

        console.log(`📏 User asking for same size ${size} - sending link again`);
        await updateConversation(psid, { lastIntent: "same_size_confirmation" });

        if (linkMatch) {
          return {
            type: "text",
            text: `¡Claro! Te paso nuevamente el link de la ${size}m a $${price} con envío incluido:\n\n${linkMatch[1]}`
          };
        } else {
          return {
            type: "text",
            text: `Sí, es la misma medida: ${size}m a $${price} con envío incluido.\n\n¿Te paso el link para que puedas comprarlo?`
          };
        }
      }
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
