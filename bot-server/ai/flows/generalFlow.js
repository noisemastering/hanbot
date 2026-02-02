// ai/flows/generalFlow.js
// Handles general queries: shipping, location, payment, delivery time, greetings, etc.
// These are non-product-specific queries that can occur at any point in conversation

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");
const { getAvailableSizes } = require("../../measureHandler");

/**
 * Business information constants
 */
const BUSINESS_INFO = {
  name: "Hanlob",
  address: "Calle Loma de San Gremal 108, bodega 73, Navex Park, C.P. 76137, Santiago de Querétaro",
  city: "Querétaro",
  phones: ["442 352 1646"],
  hours: "Lunes a Viernes 9am - 6pm",
  website: "mercadolibre.com/sec/1991696"
};

/**
 * Handle general queries
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  let { intent, entities } = classification;
  const msg = (userMessage || '').toLowerCase();

  // Check for opt-out patterns FIRST (overrides other intents)
  if (/ya\s+(hice|realic[eé]|tengo)\s+(pedido|orden|contacto)|no\s+necesito|de\s+momento\s+no|por\s+ahora\s+no|ya\s+compr[eé]|ya\s+lo\s+ped[ií]/i.test(msg)) {
    intent = "opt_out";
  }

  console.log(`📋 General flow - Intent: ${intent}`);

  // Note: responseGuidance (ai_generate handler) is now handled at the router level
  // using generateGuidedResponse() for AI-powered contextual responses

  switch (intent) {
    case INTENTS.GREETING:
      return handleGreeting(convo, psid);

    case INTENTS.THANKS:
      return handleThanks(convo, psid);

    case INTENTS.GOODBYE:
      return handleGoodbye(convo, psid);

    case INTENTS.SHIPPING_QUERY:
      return handleShipping(entities, convo, psid);

    case INTENTS.LOCATION_QUERY:
      return handleLocation(convo, psid);

    case INTENTS.PAYMENT_QUERY:
      return handlePayment(entities, convo, psid);

    case INTENTS.DELIVERY_TIME_QUERY:
      return handleDeliveryTime(convo, psid);

    case INTENTS.HUMAN_REQUEST:
      return handleHumanRequest(convo, psid);

    case INTENTS.CONFIRMATION:
      return handleConfirmation(convo, psid);

    case INTENTS.REJECTION:
      return handleRejection(convo, psid);

    case INTENTS.MULTI_QUESTION:
      return handleMultiQuestion(entities, convo, psid);

    case "opt_out":
      return handleOptOut(convo, psid);

    default:
      return null; // Let other flows handle it
  }
}

/**
 * Handle greeting
 */
async function handleGreeting(convo, psid) {
  await updateConversation(psid, { lastIntent: "greeting" });

  // Check if returning user
  if (convo?.messageCount > 1) {
    return {
      type: "text",
      text: "¡Hola de nuevo! ¿En qué te puedo ayudar?"
    };
  }

  // Cold start greeting
  return {
    type: "text",
    text: "Hola, ¿qué producto te interesa?"
  };
}

/**
 * Handle thanks
 */
async function handleThanks(convo, psid) {
  await updateConversation(psid, { lastIntent: "thanks" });

  return {
    type: "text",
    text: "¡Con gusto! Si tienes más preguntas, aquí estamos 😊"
  };
}

/**
 * Handle goodbye
 */
async function handleGoodbye(convo, psid) {
  await updateConversation(psid, {
    lastIntent: "goodbye",
    state: "closed"
  });

  return {
    type: "text",
    text: "¡Gracias por contactarnos! Que tengas excelente día 🌿"
  };
}

/**
 * Handle opt-out (already ordered, not interested, etc.)
 */
async function handleOptOut(convo, psid) {
  await updateConversation(psid, {
    lastIntent: "opt_out",
    state: "closed"
  });

  return {
    type: "text",
    text: "¡Perfecto! Gracias por tu preferencia. Cualquier cosa aquí estamos 🌿"
  };
}

/**
 * Handle shipping query
 */
async function handleShipping(entities, convo, psid) {
  await updateConversation(psid, { lastIntent: "shipping_query" });

  // Check if they mentioned a location
  if (entities.location) {
    await updateConversation(psid, { city: entities.location });
    return {
      type: "text",
      text: `¡Sí! Enviamos a ${entities.location} y a todo el país a través de Mercado Libre 📦\n\n` +
            `El envío está incluido en la mayoría de los productos.\n\n` +
            `¿Qué tipo de producto te interesa?`
    };
  }

  return {
    type: "text",
    text: "¡Sí! Enviamos a todo el país por Mercado Libre 📦\n\n" +
          "El envío está incluido en la mayoría de los productos.\n\n" +
          "¿Qué tipo de producto te interesa?"
  };
}

/**
 * Handle location query
 * IMPORTANT: Lead with shipping info - users often think they can't buy if they're far away
 */
async function handleLocation(convo, psid) {
  await updateConversation(psid, { lastIntent: "location_query" });

  return {
    type: "text",
    text: `¡Enviamos a todo México y también a Estados Unidos! 📦\n\n` +
          `Nuestra tienda física está en ${BUSINESS_INFO.city}:\n📍 ${BUSINESS_INFO.address}\n\n` +
          `Pero no necesitas visitarnos, te lo enviamos a domicilio.`
  };
}

/**
 * Handle multi-question (e.g., "precio y ubicación")
 * Combines responses for multiple intents in one message
 */
async function handleMultiQuestion(entities, convo, psid) {
  await updateConversation(psid, { lastIntent: "multi_question" });

  const subIntents = entities.subIntents || [];
  const responses = [];

  // Response snippets for each intent type (emoji as bullet, no markdown)
  const intentResponses = {
    'price_query': `💰 Los precios dependen de la medida que necesites. ¿Qué medida te interesa?`,
    'location_query': `📍 ¡Enviamos a todo México y USA! Nuestra tienda está en ${BUSINESS_INFO.city}, pero te lo enviamos a domicilio.`,
    'shipping_query': `📦 Enviamos a todo México y también a Estados Unidos. El envío está incluido en la mayoría de nuestros productos.`,
    'payment_query': `💳 Aceptamos tarjeta, efectivo en OXXO, o meses sin intereses a través de Mercado Libre.`,
    'availability_query': `✅ Manejamos malla sombra confeccionada desde 2x2m hasta 6x10m, lista para instalar.`,
    'delivery_time_query': `🚚 Normalmente de 3 a 5 días hábiles dependiendo de tu ubicación.`,
    'installation_query': `🔧 No ofrecemos servicio de instalación, pero la malla viene lista para instalar con argollas en todo el perímetro.`,
    'product_inquiry': `ℹ️ Tenemos malla sombra confeccionada lista para instalar en diferentes medidas y porcentajes de sombra.`
  };

  // Special handling for pay-on-delivery question
  if (entities.payOnDelivery) {
    intentResponses['payment_query'] = `💳 El pago es por adelantado a través de Mercado Libre. No manejamos pago contra entrega. Aceptan tarjeta, OXXO, o meses sin intereses.`;
  }

  // Build combined response
  for (const intent of subIntents) {
    if (intentResponses[intent]) {
      responses.push(intentResponses[intent]);
    }
  }

  if (responses.length === 0) {
    return null; // Let other flows handle it
  }

  return {
    type: "text",
    text: responses.join('\n\n')
  };
}

/**
 * Handle payment query
 */
async function handlePayment(entities, convo, psid) {
  await updateConversation(psid, { lastIntent: "payment_query" });

  // Check for pay-on-delivery question
  if (entities.payOnDelivery) {
    return {
      type: "text",
      text: "El pago es 100% POR ADELANTADO en Mercado Libre al momento de hacer tu pedido.\n\n" +
            "❌ No manejamos pago contra entrega.\n\n" +
            "Aceptan tarjeta, efectivo en OXXO, o meses sin intereses. ¿Te paso el link?"
    };
  }

  // Check for alternative payment question
  if (entities.alternativePayment) {
    return {
      type: "text",
      text: `La única alternativa al pago por Mercado Libre es venir directamente a nuestras oficinas en Querétaro y pagar en efectivo o con tarjeta.\n\n` +
            `📍 ${BUSINESS_INFO.address}\n` +
            `📞 ${BUSINESS_INFO.phones.join(" / ")}\n` +
            `🕓 ${BUSINESS_INFO.hours}\n\n` +
            `¿Te encuentras en Querétaro?`
    };
  }

  return {
    type: "text",
    text: "El pago se realiza a través de Mercado Libre al momento de hacer tu pedido.\n\n" +
          "Aceptan tarjeta, efectivo en OXXO, o meses sin intereses.\n\n" +
          "¿Te paso el link del producto?"
  };
}

/**
 * Handle delivery time query
 */
async function handleDeliveryTime(convo, psid) {
  await updateConversation(psid, { lastIntent: "delivery_time_query" });

  return {
    type: "text",
    text: "El tiempo de entrega depende de tu ubicación:\n\n" +
          "• Zona metropolitana: 1-2 días hábiles\n" +
          "• Interior de la república: 2-5 días hábiles\n\n" +
          "Mercado Libre te da la fecha estimada de entrega al hacer tu pedido 📦"
  };
}

/**
 * Handle human request
 */
async function handleHumanRequest(convo, psid) {
  await updateConversation(psid, {
    lastIntent: "human_request",
    handoffRequested: true,
    handoffReason: "User requested human agent",
    handoffTimestamp: new Date()
  });

  // Include video if they were talking about malla sombra
  const isMallaContext = convo?.currentFlow === 'malla_sombra' ||
                         convo?.currentFlow === 'rollo' ||
                         convo?.productInterest?.toLowerCase()?.includes('malla');

  let response = "¡Claro! Un especialista te contactará a la brevedad.\n\n" +
                 "También puedes llamarnos al 📞 " + BUSINESS_INFO.phones[0] +
                 "\n🕓 " + BUSINESS_INFO.hours;

  if (isMallaContext) {
    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    response += `\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;
  }

  return {
    type: "text",
    text: response
  };
}

/**
 * Handle confirmation (yes, ok, that one)
 */
async function handleConfirmation(convo, psid) {
  // The response depends on what we were waiting for
  const lastIntent = convo?.lastIntent;

  // If we were in a product flow and they confirmed
  if (lastIntent?.startsWith("roll_") || lastIntent?.startsWith("malla_") || lastIntent?.startsWith("borde_")) {
    // Let the respective product flow handle it
    return null;
  }

  // User confirmed after "¿Deseas ver la lista?" - show the actual size list!
  if (lastIntent === "generic_measures") {
    console.log("✅ User confirmed to see size list after generic_measures");
    await updateConversation(psid, { lastIntent: "sizes_shown", unknownCount: 0 });

    // Fetch all available sizes
    const availableSizes = await getAvailableSizes(convo);

    if (availableSizes.length > 0) {
      let response = "📐 Aquí están nuestras medidas con precio:\n\n";

      // Show sizes (up to 15)
      const sizesFormatted = availableSizes.slice(0, 15).map(s => `• ${s.sizeStr} - $${s.price}`);
      response += sizesFormatted.join('\n');

      if (availableSizes.length > 15) {
        response += `\n\n... y ${availableSizes.length - 15} medidas más.`;
      }

      response += "\n\nTambién manejamos rollos de 4.20x100m y 2.10x100m.\n\n";
      response += "¿Cuál te interesa?";

      return { type: "text", text: response };
    }

    // Fallback if no sizes available
    return {
      type: "text",
      text: "Manejamos medidas desde 2x2m hasta 6x10m. ¿Qué medida necesitas?"
    };
  }

  // Generic confirmation
  await updateConversation(psid, { lastIntent: "confirmed" });

  return {
    type: "text",
    text: "¿Qué tipo de producto te interesa?"
  };
}

/**
 * Handle rejection (no, other, not interested)
 */
async function handleRejection(convo, psid) {
  await updateConversation(psid, { lastIntent: "rejected" });

  return {
    type: "text",
    text: "¿Hay algo más en lo que te pueda ayudar?"
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  const { intent } = classification;

  // Handle social intents
  if ([
    INTENTS.GREETING,
    INTENTS.THANKS,
    INTENTS.GOODBYE,
    INTENTS.HUMAN_REQUEST
  ].includes(intent)) {
    return true;
  }

  // Handle logistics intents
  if ([
    INTENTS.SHIPPING_QUERY,
    INTENTS.LOCATION_QUERY,
    INTENTS.PAYMENT_QUERY,
    INTENTS.DELIVERY_TIME_QUERY
  ].includes(intent)) {
    return true;
  }

  // Handle MULTI_QUESTION only if NO dimensions are present
  // If dimensions are present, let product flows handle it (they can give specific prices)
  if (intent === INTENTS.MULTI_QUESTION) {
    const hasDimensions = /\d+\s*[xX×]\s*\d+/.test(userMessage);
    if (!hasDimensions) {
      return true;
    }
    // Has dimensions - let product flow handle it
    console.log(`📏 MULTI_QUESTION has dimensions, deferring to product flow`);
  }

  // Pattern-based detection for common queries (fallback when intent is unclear)
  if (userMessage) {
    const msg = userMessage.toLowerCase();

    // IMPORTANT: If message contains product dimensions (e.g., "8x4"), defer to product flows
    // They will handle the main query and append secondary answers (location, shipping, etc.)
    const hasDimensions = /\d+\s*[xX×]\s*\d+/.test(msg);
    if (hasDimensions) {
      console.log(`📏 Message has dimensions, deferring to product flow for multi-question handling`);
      return false;
    }

    // Location patterns (sucursal, tienda, donde están, etc.)
    if (/d[oó]nde\s+(est[aá]n|tienen|se\s+ubican|quedan)|ubicaci[oó]n|direcci[oó]n|sucursal|tienda\s+f[ií]sica/i.test(msg)) {
      classification.intent = INTENTS.LOCATION_QUERY; // Override for handler
      return true;
    }

    // Shipping patterns (envían, domicilio, etc.)
    if (/env[ií](an?|os?)\s+(a|hasta)|hacen\s+env[ií]os?|llega\s+a|a\s+domicilio|entregan?\s+(a|en)/i.test(msg)) {
      classification.intent = INTENTS.SHIPPING_QUERY;
      return true;
    }

    // Payment patterns
    if (/c[oó]mo\s+(se\s+)?paga|formas?\s+de\s+pago|pago\s+contra\s+entrega|aceptan\s+tarjeta/i.test(msg)) {
      classification.intent = INTENTS.PAYMENT_QUERY;
      return true;
    }

    // Human request patterns
    if (/hablar\s+con\s+(alguien|una?\s+persona|humano|asesor|especialista)|at[ie]ende\s+una?\s+persona/i.test(msg)) {
      classification.intent = INTENTS.HUMAN_REQUEST;
      return true;
    }

    // Opt-out patterns (already ordered, not interested, have contact elsewhere)
    if (/ya\s+(hice|realic[eé]|tengo)\s+(pedido|orden|contacto)|no\s+necesito|de\s+momento\s+no|por\s+ahora\s+no|ya\s+compr[eé]|ya\s+lo\s+ped[ií]/i.test(msg)) {
      classification.intent = "opt_out";
      return true;
    }
  }

  // Handle confirmation/rejection only if not in a product flow
  if ([INTENTS.CONFIRMATION, INTENTS.REJECTION].includes(intent)) {
    const lastIntent = convo?.lastIntent;
    // Don't handle if in a product flow
    if (lastIntent?.startsWith("roll_") ||
        lastIntent?.startsWith("malla_") ||
        lastIntent?.startsWith("borde_")) {
      return false;
    }
    return true;
  }

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  BUSINESS_INFO
};
