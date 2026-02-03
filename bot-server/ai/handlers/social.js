// ai/handlers/social.js
// Handlers for social intents: greeting, thanks, goodbye

const { updateConversation } = require("../../conversationManager");

/**
 * Handle greeting intent
 * @param {object} context - { intent, entities, confidence, psid, convo, userMessage }
 */
async function handleGreeting({ psid, convo }) {
  // Check if returning user
  if (convo?.greeted && convo?.lastMessageAt) {
    const hoursSince = (Date.now() - new Date(convo.lastMessageAt).getTime()) / (1000 * 60 * 60);

    if (hoursSince < 1) {
      return {
        type: "text",
        text: "¡Hola de nuevo! ¿En qué más te puedo ayudar?"
      };
    }
  }

  await updateConversation(psid, {
    greeted: true,
    lastIntent: "greeting",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "¡Hola! ¿Qué producto te interesa?\n\n" +
          "Manejamos:\n" +
          "• Malla sombra (confeccionada lista para instalar)\n" +
          "• Rollos de malla sombra (100m)\n" +
          "• Borde separador para jardín"
  };
}

/**
 * Handle thanks intent
 */
async function handleThanks({ psid }) {
  await updateConversation(psid, {
    lastIntent: "thanks",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "¡Con gusto! ¿Hay algo más en lo que pueda ayudarte?"
  };
}

/**
 * Handle goodbye intent
 */
async function handleGoodbye({ psid }) {
  await updateConversation(psid, {
    lastIntent: "goodbye",
    state: "closed",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "¡Gracias por contactarnos! Que tengas excelente día."
  };
}

module.exports = {
  handleGreeting,
  handleThanks,
  handleGoodbye
};
