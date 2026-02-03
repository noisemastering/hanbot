// ai/handlers/escalation.js
// Handlers for escalation intents: frustration, human request, complaints

const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getBusinessInfo } = require("../../businessInfoManager");

/**
 * Handle frustration - "Ya te dije!", "No entienden", "No leen"
 *
 * This is CRITICAL for customer experience. When a user is frustrated,
 * the bot must acknowledge, apologize, and try to recover.
 */
async function handleFrustration({ psid, convo, userMessage }) {
  // Check if we have context to recover from
  const hasSize = convo?.productSpecs?.width && convo?.productSpecs?.height;
  const hasRequestedSize = convo?.requestedSize;

  await updateConversation(psid, {
    lastIntent: "frustration_handled",
    unknownCount: 0
  });

  // If we have dimensions in context, acknowledge and continue with them
  if (hasSize || hasRequestedSize) {
    const size = hasRequestedSize ||
                 `${convo.productSpecs.width}x${convo.productSpecs.height}`;

    return {
      type: "text",
      text: `Tienes razón, disculpa. Tenías ${size}m.\n\n¿Te paso el link para esa medida?`
    };
  }

  // Check if we have product context
  if (convo?.productInterest) {
    return {
      type: "text",
      text: `Disculpa la confusión. ¿Me puedes confirmar la medida que necesitas?`
    };
  }

  // No context - hand off to human
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User frustrated - no context to recover",
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  await sendHandoffNotification(psid, convo, `Cliente frustrado: "${userMessage.substring(0, 100)}"`);

  return {
    type: "text",
    text: "Disculpa, parece que hay algo que no estoy entendiendo bien. Déjame contactar a un especialista para que te ayude mejor.\n\n" +
          "En un momento te atienden."
  };
}

/**
 * Handle human request - "Quiero hablar con alguien", "Un agente"
 */
async function handleHumanRequest({ psid, convo }) {
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User requested human agent",
    handoffTimestamp: new Date(),
    state: "needs_human",
    lastIntent: "human_request"
  });

  await sendHandoffNotification(psid, convo, "Cliente solicitó hablar con un agente");

  return {
    type: "text",
    text: "¡Claro! Te comunico con un asesor. En un momento te atienden."
  };
}

/**
 * Handle general complaint
 */
async function handleComplaint({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Complaint: ${userMessage.substring(0, 100)}`,
    handoffTimestamp: new Date(),
    state: "needs_human",
    lastIntent: "complaint"
  });

  await sendHandoffNotification(psid, convo, `Queja de cliente: "${userMessage.substring(0, 100)}"`);

  return {
    type: "text",
    text: "Lamento escuchar eso. Te comunico con un especialista para que te ayude a resolver tu situación.\n\n" +
          "En un momento te atienden."
  };
}

/**
 * Handle price confusion - "Es otro precio?", "Me dijiste diferente"
 */
async function handlePriceConfusion({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "price_confusion",
    unknownCount: 0
  });

  // Try to provide context about the price
  if (convo?.requestedSize) {
    return {
      type: "text",
      text: `Los precios pueden variar según la medida y disponibilidad en Mercado Libre.\n\n` +
            `¿Me confirmas qué medida necesitas para darte el precio actualizado?`
    };
  }

  return {
    type: "text",
    text: "Los precios de nuestros productos se actualizan directamente en Mercado Libre.\n\n" +
          "¿Qué medida te interesa para darte el precio actual?"
  };
}

/**
 * Handle out of stock report - "Dice agotado", "No hay en stock"
 */
async function handleOutOfStock({ psid, convo, userMessage }) {
  const businessInfo = await getBusinessInfo();

  await updateConversation(psid, {
    lastIntent: "out_of_stock_report",
    unknownCount: 0
  });

  // If they mentioned a specific size
  if (convo?.requestedSize) {
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Product out of stock: ${convo.requestedSize}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    await sendHandoffNotification(psid, convo, `Producto agotado: ${convo.requestedSize}`);

    return {
      type: "text",
      text: `Lamento que esa medida aparezca agotada. Te comunico con un especialista para verificar disponibilidad y alternativas.\n\n` +
            `También puedes contactarnos directamente:\n` +
            `📞 ${businessInfo?.phones?.[0] || '442 352 1646'}\n` +
            `💬 WhatsApp: https://wa.me/524425957432`
    };
  }

  return {
    type: "text",
    text: "Lamento que el producto aparezca agotado. ¿Qué medida buscabas? Puedo verificar alternativas disponibles."
  };
}

module.exports = {
  handleFrustration,
  handleHumanRequest,
  handleComplaint,
  handlePriceConfusion,
  handleOutOfStock
};
