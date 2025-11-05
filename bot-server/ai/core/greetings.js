// ai/core/greetings.js
const { updateConversation } = require("../../conversationManager");

async function handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
    const now = Date.now();
    const lastGreetTime = convo.lastGreetTime || 0;
    const oneHour = 60 * 60 * 1000;
    const greetedRecently = convo.greeted && (now - lastGreetTime) < oneHour;

    if (greetedRecently) {
      return { type: "text", text: `¡Hola de nuevo! Soy ${BOT_PERSONA_NAME}. ¿Qué estás buscando esta vez?` };
    }

    await updateConversation(psid, {
      greeted: true,
      state: "active",
      lastIntent: "greeting",
      lastGreetTime: now,
      unknownCount: 0
    });

    const greetings = [
      `¡Hola! Soy ${BOT_PERSONA_NAME}, tu asesora virtual en Hanlob. ¿Qué tipo de producto te interesa ver?`,
      `¡Qué gusto saludarte! Soy ${BOT_PERSONA_NAME} del equipo de Hanlob.`,
      `¡Hola! Soy ${BOT_PERSONA_NAME}, asesora de Hanlob. Cuéntame, ¿qué producto te interesa?`,
    ];
    return { type: "text", text: greetings[Math.floor(Math.random() * greetings.length)] };
  }
  return null;
}

async function handleThanks(cleanMsg, psid, BOT_PERSONA_NAME) {
  // Check for continuation phrases - if user is continuing, don't close
  const hasContinuation = /\b(pero|aun|todavía|todavia|aún|tengo\s+(una\s+)?(duda|pregunta)|quiero\s+saber|me\s+gustaría|quisiera)\b/i.test(cleanMsg);

  if (!hasContinuation && /\b(gracias|perfecto|excelente|muy amable|adiós|bye|nos vemos)\b/i.test(cleanMsg)) {
    await updateConversation(psid, { state: "closed", unknownCount: 0, lastIntent: "closed" });
    return {
      type: "text",
      text: `¡Gracias a ti! Soy ${BOT_PERSONA_NAME} y fue un gusto ayudarte. ¡Que tengas un excelente día!`
    };
  }
  return null;
}

// 🚫 Handle opt-out: when conversation is closed and user sends "no", don't respond
async function handleOptOut(cleanMsg, convo) {
  // If conversation is already closed
  if (convo.state === "closed" || convo.lastIntent === "closed") {
    // Check if message is a simple negative opt-out confirmation
    const isOptOutConfirmation = /^(no|nop|nope|no\s*gracias|no,?\s*gracias|ok|vale|entendido)$/i.test(cleanMsg);

    if (isOptOutConfirmation) {
      console.log("🚫 Opt-out detected: conversation is closed, user confirmed with 'no'. Not responding.");
      // Return a special marker to indicate we should not send any response
      return { type: "no_response" };
    }
  }
  return null;
}

// 👍 Handle acknowledgment emojis and confirmations
async function handleAcknowledgment(cleanMsg, psid, convo) {
  // Check for acknowledgment emojis or simple confirmations (with or without text)
  const isAcknowledgment = /^(👍|👌|✅|❤️|😊|🙂|👏|💯|ok|vale|perfecto|excelente|entendido|si|sí|dale|claro|listo)[\s!]*$/i.test(cleanMsg);

  if (isAcknowledgment) {
    console.log("👍 Acknowledgment detected:", cleanMsg);
    await updateConversation(psid, { lastIntent: "acknowledgment", unknownCount: 0 });

    return {
      type: "text",
      text: "Perfecto! ¿Hay algo más en lo que pueda ayudarte?"
    };
  }
  return null;
}

module.exports = { handleGreeting, handleThanks, handleOptOut, handleAcknowledgment };
