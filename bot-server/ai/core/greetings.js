// ai/core/greetings.js
const { updateConversation } = require("../../conversationManager");

async function handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
    const now = Date.now();
    const lastGreetTime = convo.lastGreetTime || 0;
    const oneHour = 60 * 60 * 1000;
    const greetedRecently = convo.greeted && (now - lastGreetTime) < oneHour;

    if (greetedRecently) {
      return { type: "text", text: `¡Hola de nuevo! 🌷 Soy ${BOT_PERSONA_NAME}. ¿Qué estás buscando esta vez?` };
    }

    await updateConversation(psid, {
      greeted: true,
      state: "active",
      lastIntent: "greeting",
      lastGreetTime: now,
      unknownCount: 0
    });

    const greetings = [
      `¡Hola! 👋 Soy ${BOT_PERSONA_NAME}, tu asesora virtual en Hanlob. ¿Qué tipo de producto te interesa ver?`,
      `¡Qué gusto saludarte! 🌿 Soy ${BOT_PERSONA_NAME} del equipo de Hanlob.`,
      `¡Hola! 🙌 Soy ${BOT_PERSONA_NAME}, asesora de Hanlob. Cuéntame, ¿qué producto te interesa?`,
    ];
    return { type: "text", text: greetings[Math.floor(Math.random() * greetings.length)] };
  }
  return null;
}

async function handleThanks(cleanMsg, psid, BOT_PERSONA_NAME) {
  if (/\b(gracias|perfecto|excelente|muy amable|adiós|bye|nos vemos)\b/i.test(cleanMsg)) {
    await updateConversation(psid, { state: "closed", unknownCount: 0, lastIntent: "closed" });
    return {
      type: "text",
      text: `¡Gracias a ti! 🌷 Soy ${BOT_PERSONA_NAME} y fue un gusto ayudarte. ¡Que tengas un excelente día! ☀️`
    };
  }
  return null;
}

module.exports = { handleGreeting, handleThanks };
