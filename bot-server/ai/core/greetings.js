// ai/core/greetings.js
const { updateConversation, isHumanActive } = require("../../conversationManager");

async function handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  // Don't respond to greetings if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring greeting");
    return null;
  }

  if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
    // Check if the message contains an actual question/request after the greeting
    const hasProductQuestion = /\b(precio|medida|rollo|cuanto|cuánto|cuesta|vale|metro|malla|tien[ea]s?|vend[ea]s?|disponible|cotiz|ofrece|comprar)\b/i.test(cleanMsg);

    // If the user is asking a product question, don't intercept - let other handlers process it
    if (hasProductQuestion) {
      console.log("📝 Greeting with product question detected, passing to other handlers");
      // Still mark as greeted but don't respond - let the question be processed
      await updateConversation(psid, {
        greeted: true,
        state: "active",
        lastGreetTime: Date.now(),
        unknownCount: 0
      });
      return null;
    }

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

async function handleThanks(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  // Don't respond to thanks if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring thanks");
    return null;
  }

  // Don't respond if conversation is already closed (user is just acknowledging our goodbye)
  if (convo.state === "closed" || convo.lastIntent === "closed") {
    console.log("🚫 Conversation already closed, not responding to farewell acknowledgment");
    return { type: "no_response" };
  }

  // Check for continuation phrases - if user is continuing, don't close
  const hasContinuation = /\b(pero|aun|todavía|todavia|aún|tengo\s+(una\s+)?(duda|pregunta)|quiero\s+saber|me\s+gustaría|quisiera)\b/i.test(cleanMsg);

  // Check if message contains actual product/size requests
  const hasProductRequest = /\b(\d+\s*x\s*\d+|precio|medida|rollo|metro|malla|sombra|tien[ea]s?|cuanto|cuánto|cotiz|ofrece|disponible)\b/i.test(cleanMsg);

  // Expanded goodbye patterns to include common Mexican closing phrases and deferment messages
  const isGoodbye = /\b(gracias|perfecto|excelente|muy amable|adiós|adios|bye|nos vemos|hasta luego|nos hablamos|te hablo|luego hablo|después|despu[ée]s\s+(te\s+)?(contacto|hablo|comunico|escribo)|ma[ñn]ana\s+(me\s+|te\s+)?(comunico|hablo|contacto|escribo)|analizar|lo\s+(voy\s+a\s+)?analizo|escribo\s+(más\s+|mas\s+)?tarde|te\s+escribo|lo\s+pienso|más\s+tarde|mas\s+tarde)\b/i.test(cleanMsg);

  // Only treat as goodbye if: no continuation, has goodbye words, AND no product request
  if (!hasContinuation && !hasProductRequest && isGoodbye) {
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

// 📅 Handle purchase deferral: when user says they'll take measurements or contact later
async function handlePurchaseDeferral(cleanMsg, psid, convo) {
  // Don't respond to deferrals if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring deferral");
    return null;
  }

  // Detect deferral phrases - when user wants to think about it, take measurements, contact later, etc.
  const isDeferral = /\b(voy\s+a\s+tomar\s+medidas?|boy\s+a\s+tomar\s+medidas?|tomar\s+medidas?|despu[eé]s\s+(me\s+)?(pongo\s+en\s+)?contacto|despu[eé]s\s+(te\s+|me\s+)?(hablo|comunico|escribo|contacto)|luego\s+(te\s+|me\s+)?(hablo|comunico|escribo|contacto)|ma[ñn]ana\s+(te\s+|me\s+)?(hablo|comunico|escribo|contacto)|lo\s+(voy\s+a\s+)?analiz[oa]r?|lo\s+(voy\s+a\s+)?pensar|te\s+(escribo|hablo|contacto)\s+(despu[eé]s|luego|m[aá]s\s+tarde)|m[aá]s\s+tarde\s+(te\s+)?(escribo|hablo|contacto)|ahorita\s+no|por\s+ahora\s+no|de\s+momento\s+no)\b/i.test(cleanMsg);

  if (isDeferral) {
    console.log("📅 Purchase deferral detected:", cleanMsg);
    await updateConversation(psid, {
      state: "deferred",
      lastIntent: "purchase_deferred",
      unknownCount: 0
    });

    return {
      type: "text",
      text: "Perfecto, quedamos a tus órdenes.\n\nVer tienda en línea\nIngresa al siguiente link:\n\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¡Cuando estés listo, con gusto te ayudo!"
    };
  }

  return null;
}

// 👍 Handle acknowledgment emojis and confirmations
async function handleAcknowledgment(cleanMsg, psid, convo) {
  // Don't respond to acknowledgments if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring acknowledgment");
    return null;
  }

  // Check for acknowledgment emojis or simple confirmations (with or without text)
  // Also includes common Mexican chat abbreviations: ntp (no te preocupes), np (no problem), sta bien (está bien)
  const isAcknowledgment = /^(👍|👌|✅|❤️|😊|🙂|👏|💯|ok|vale|perfecto|excelente|entendido|si|sí|dale|claro|listo|ntp|np|sta\s*bien|esta\s*bien|está\s*bien)[\s!]*$/i.test(cleanMsg) ||
                            /^(ntp|np)\s+(está|esta|sta)\s+bien[\s!]*$/i.test(cleanMsg);

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

module.exports = { handleGreeting, handleThanks, handleOptOut, handleAcknowledgment, handlePurchaseDeferral };
