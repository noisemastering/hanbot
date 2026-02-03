// ai/handlers/conversation.js
// Handlers for conversation flow intents: future interest, will get back

const { updateConversation } = require("../../conversationManager");

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

  return {
    type: "text",
    text: "¡Perfecto! Sin problema.\n\n" +
          "Cuando estés listo, solo escríbenos y con gusto te ayudamos.\n\n" +
          "Recuerda que enviamos a todo el país y tenemos inventario listo para envío inmediato."
  };
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

  if (isMeasuring) {
    return {
      type: "text",
      text: "¡Perfecto! Mide con calma.\n\n" +
            "Cuando tengas las medidas exactas me escribes y te paso el precio con link de compra.\n\n" +
            "Recuerda medir ancho x largo en metros."
    };
  }

  return {
    type: "text",
    text: "¡Claro! Quedo pendiente.\n\n" +
          "Cuando estés listo, escríbeme y te ayudo con tu pedido."
  };
}

// Note: CONFIRMATION and REJECTION intents are context-dependent
// They are handled by product flows (mallaFlow, defaultFlow, etc.)
// rather than here because they need to know what was offered

module.exports = {
  handleFutureInterest,
  handleWillGetBack
};
