// ai/core/greetings.js
const { updateConversation, isHumanActive } = require("../../conversationManager");
const { getAudienceLanguage } = require("../utils/adContextHelper");

async function handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  // Don't respond to greetings if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring greeting");
    return null;
  }

  if (/^(hola|ola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
    // Check if the message contains an actual question/request after the greeting
    // Use optional 's' for plurals: costos, mallas, precios, medidas, etc.
    const hasProductQuestion = /\b(precios?|costos?|medidas?|rollos?|cuanto|cuánto|cuesta|vale|metros?|mallas?|tien[ea]s?|vend[ea]s?|disponibles?|cotiz|ofrece|comprar|env[ií]os?)\b/i.test(cleanMsg);
    const hasDimensions = /\d+\s*[xX×]\s*\d+/.test(cleanMsg);

    // If the user is asking a product question, don't intercept - let other handlers process it
    if (hasProductQuestion || hasDimensions) {
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
      const userName = convo.userName;
      if (userName) {
        return { type: "text", text: `¡Hola de nuevo, ${userName}! Soy ${BOT_PERSONA_NAME}. ¿Qué estás buscando esta vez?` };
      }
      return { type: "text", text: `¡Hola de nuevo! Soy ${BOT_PERSONA_NAME}. ¿Qué estás buscando esta vez?` };
    }

    await updateConversation(psid, {
      greeted: true,
      state: "active",
      lastIntent: "greeting",
      lastGreetTime: now,
      unknownCount: 0
    });

    const userName = convo.userName;

    // Check for audience-specific greeting from ad context
    const adContext = convo.adContext;
    const audienceLanguage = adContext?.adIntent?.audienceType
      ? getAudienceLanguage(adContext.adIntent.audienceType)
      : null;

    let greeting;
    if (audienceLanguage?.greeting) {
      // Use audience-specific greeting
      greeting = userName
        ? `¡Hola ${userName}! ${audienceLanguage.greeting.replace(/^¡?Hola!?\s*/i, '')} Soy ${BOT_PERSONA_NAME}.`
        : `${audienceLanguage.greeting} Soy ${BOT_PERSONA_NAME}.`;
      console.log(`🎯 Using audience-specific greeting for: ${adContext.adIntent.audienceType}`);
    } else {
      // Default greeting
      greeting = userName
        ? `Hola ${userName}, te atiende ${BOT_PERSONA_NAME} ¿en qué puedo ayudarte?`
        : `¡Hola! Te atiende ${BOT_PERSONA_NAME} ¿en qué puedo ayudarte?`;
    }

    return { type: "text", text: greeting };
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
  // "otra pregunta", "una duda", "tengo pregunta", etc.
  const hasContinuation = /\b(pero|aun|todavía|todavia|aún|otra\s+(duda|pregunta|cosa)|tengo\s+(una\s+)?(duda|pregunta)|quiero\s+saber|me\s+gustaría|quisiera)\b/i.test(cleanMsg);

  // Check if message contains actual product/size requests
  // Exclude "gracias por la cotización" - that's a thank you, not a quote request
  const isThankingForQuote = /\b(gracias\s+por\s+(la\s+)?cotizaci[oó]n|gracias\s+por\s+cotizar)\b/i.test(cleanMsg);
  const hasProductRequest = !isThankingForQuote && /\b(\d+\s*x\s*\d+|precio|medida|rollo|metro|malla|sombra|tien[ea]s?|cuanto|cuánto|cotiz|ofrece|disponible)\b/i.test(cleanMsg);

  // Check if message contains ANY question (location, hours, contact, payment, etc.)
  // "ubicación, gracias" or "forma de pago, gracias" is a question, not a goodbye
  const hasQuestion = /\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde|horarios?|tel[eé]fono|n[uú]mero|contacto|env[ií]o|entrega|forma\s+de\s+pago|c[oó]mo\s+(llego|pago|compro)|pago|pagar|tarjeta|efectivo|transferencia|cu[aá]nto\s+(cuesta|vale|tarda)|qu[eé]\s+(precio|medida|tamaño)|tienen|manejan|hacen|instalan)\b/i.test(cleanMsg);

  // Expanded goodbye patterns to include common Mexican closing phrases and deferment messages
  const isGoodbye = /\b(gracias|perfecto|excelente|muy amable|adiós|adios|bye|nos vemos|hasta luego|nos hablamos|te hablo|luego hablo|después|despu[ée]s\s+(te\s+)?(contacto|hablo|comunico|escribo)|ma[ñn]ana\s+(me\s+|te\s+)?(comunico|hablo|contacto|escribo)|analizar|lo\s+(voy\s+a\s+)?analizo|escribo\s+(más\s+|mas\s+)?tarde|te\s+escribo|lo\s+pienso|más\s+tarde|mas\s+tarde|estamos\s+en\s+contacto|estaremos\s+en\s+contacto|seguimos\s+en\s+contacto)\b/i.test(cleanMsg);

  // Only treat as goodbye if: no continuation, has goodbye words, AND no product request OR question
  if (!hasContinuation && !hasProductRequest && !hasQuestion && isGoodbye) {
    await updateConversation(psid, { state: "closed", unknownCount: 0, lastIntent: "closed" });
    const userName = convo.userName;
    if (userName) {
      return {
        type: "text",
        text: `¡Gracias a ti, ${userName}! Soy ${BOT_PERSONA_NAME} y fue un gusto ayudarte. ¡Que tengas un excelente día!`
      };
    }
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
async function handlePurchaseDeferral(cleanMsg, psid, convo, BOT_PERSONA_NAME) {
  // Don't respond to deferrals if human is active
  if (await isHumanActive(psid)) {
    console.log("🚫 Human is active, ignoring deferral");
    return null;
  }

  // Detect deferral phrases - when user wants to think about it, take measurements, contact later, etc.
  // Common patterns:
  // - "voy a checar que me conviene" / "voy a ver" / "déjame checar"
  // - "deja checo medidas" / "deja checo primero" (check measurements first)
  // - "hay luego le mando mensaje" / "ay luego te escribo" (with "hay/ay" prefix)
  // - "luego te hablo" / "luego me comunico" / "luego le mando mensaje"
  // - "después te contacto" / "te escribo más tarde"
  // - "voy a tomar medidas" / "deja tomo medidas"
  // - "lo voy a pensar/analizar" / "ahorita no"
  // - "coordinamos" (we'll coordinate later)
  const isDeferral = /\b(voy\s+a\s+chec?ar|voy\s+a\s+ver|d[ée]ja(me)?\s+chec?[oa]r?|d[ée]ja(me)?\s+ver|d[ée]ja\s+checo|voy\s+a\s+tomar\s+medidas?|boy\s+a\s+tomar\s+medidas?|tomar\s+medidas?|tomo\s+medidas?|d[ée]ja(me)?\s+tomo\s+medidas?|voy\s+a\s+medir|deja\s+mido|ya\s+(que|k|q)\s+tome\s+medidas?|cuando\s+tome\s+medidas?|despu[eé]s\s+(me\s+)?(pongo\s+en\s+)?contacto|despu[eé]s\s+(te\s+|me\s+|le\s+)?(hablo|comunico|escribo|contacto|mando)|(h?ay\s+)?luego\s+(te\s+|me\s+|le\s+)?(hablo|comunico|escribo|contacto|mando(\s+mensaje)?)|ma[ñn]ana\s+(te\s+|me\s+|le\s+)?(hablo|comunico|escribo|contacto)|lo\s+(voy\s+a\s+)?analiz[oa]r?|lo\s+(voy\s+a\s+)?pensar|(te\s+|le\s+)?(escribo|hablo|contacto|mando)\s+(despu[eé]s|luego|m[aá]s\s+tarde)|m[aá]s\s+tarde\s+(te\s+|le\s+)?(escribo|hablo|contacto|mando)|ahorita\s+no|por\s+ahora\s+no|de\s+momento\s+no|(te\s+|le\s+)?mando\s+mensaje|me\s+pongo\s+en\s+contacto|y\s+coordinamos|luego\s+coordinamos)\b/i.test(cleanMsg);

  if (isDeferral) {
    console.log("📅 Purchase deferral detected:", cleanMsg);
    await updateConversation(psid, {
      state: "deferred",
      lastIntent: "purchase_deferred",
      unknownCount: 0
    });

    return {
      type: "text",
      text: `Excelente, quedamos a tus órdenes. Te atendió ${BOT_PERSONA_NAME || 'Hanlob'}.`
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
  // "aok" is common typo/variant of "ok" / "a ok"
  const isAcknowledgment = /^(👍|👌|✅|❤️|😊|🙂|👏|💯|a?ok|vale|perfecto|excelente|entendido|si|sí|dale|claro|listo|ntp|np|sta\s*bien|esta\s*bien|está\s*bien)[\s!]*$/i.test(cleanMsg) ||
                            /^(ntp|np)\s+(está|esta|sta)\s+bien[\s!]*$/i.test(cleanMsg);

  if (isAcknowledgment) {
    console.log("👍 Acknowledgment detected:", cleanMsg);
    await updateConversation(psid, { lastIntent: "acknowledgment", unknownCount: 0 });

    const userName = convo.userName;
    if (userName) {
      return {
        type: "text",
        text: `Perfecto, ${userName}! ¿Hay algo más en lo que pueda ayudarte?`
      };
    }
    return {
      type: "text",
      text: "Perfecto! ¿Hay algo más en lo que pueda ayudarte?"
    };
  }
  return null;
}

// 🏪 Handle store visit intention: when user says they'll visit the physical store
async function handleStoreVisit(cleanMsg, psid, convo) {
  // Don't respond if human is active
  if (await isHumanActive(psid)) {
    return null;
  }

  // Detect store visit intentions
  // "la visito en su tienda", "los visito", "paso a su tienda", "voy a ir a la tienda"
  // "la siguiente semana", "próxima semana", "mañana", "en estos días"
  const isStoreVisitIntent = /\b(l[oa]s?\s+visit[oa]|visit[oa]\s+(en\s+)?(su\s+)?tienda|pas[oa]\s+(a\s+)?(su\s+)?tienda|voy\s+a\s+(ir\s+)?(a\s+)?(la\s+|su\s+)?tienda|ir\s+a\s+(la\s+|su\s+)?tienda)\b/i.test(cleanMsg);

  if (!isStoreVisitIntent) {
    return null;
  }

  console.log("🏪 Store visit intention detected:", cleanMsg);

  // Check if they also mentioned a product interest
  const mentionsMalla = /\b(malla|sombra)\b/i.test(cleanMsg);
  const mentionsProduct = /\b(malla|sombra|rollo|borde|ground\s*cover|monofilamento)\b/i.test(cleanMsg);

  await updateConversation(psid, {
    lastIntent: "store_visit_planned",
    state: "active",
    unknownCount: 0
  });

  // If they mentioned a product, ask about specifics
  if (mentionsMalla) {
    return {
      type: "text",
      text: "¡Perfecto! Te esperamos. ¿Qué medida de malla sombra ocupas?"
    };
  }

  if (mentionsProduct) {
    return {
      type: "text",
      text: "¡Perfecto! Te esperamos. ¿Qué producto te interesa?"
    };
  }

  // General store visit
  return {
    type: "text",
    text: "¡Perfecto! Te esperamos. Estamos en Querétaro: Calle Loma de San Gremal 108, bodega 73, Navex Park.\n\n¿Hay algo que pueda adelantarte?"
  };
}

module.exports = { handleGreeting, handleThanks, handleOptOut, handleAcknowledgment, handlePurchaseDeferral, handleStoreVisit };
