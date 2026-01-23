// ai/flows/generalFlow.js
// Handles general queries: shipping, location, payment, delivery time, greetings, etc.
// These are non-product-specific queries that can occur at any point in conversation

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");

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
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

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
            `¿Qué producto te interesa?`
    };
  }

  return {
    type: "text",
    text: "¡Sí! Enviamos a todo el país por Mercado Libre 📦\n\n" +
          "El envío está incluido en la mayoría de los productos.\n\n" +
          "¿Qué producto te interesa?"
  };
}

/**
 * Handle location query
 */
async function handleLocation(convo, psid) {
  await updateConversation(psid, { lastIntent: "location_query" });

  return {
    type: "text",
    text: `Estamos en ${BUSINESS_INFO.city}, pero enviamos a todo el país por Mercado Libre 📦`
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

  return {
    type: "text",
    text: "¡Claro! Un asesor te contactará a la brevedad.\n\n" +
          "También puedes llamarnos al 📞 " + BUSINESS_INFO.phones[0] +
          "\n🕓 " + BUSINESS_INFO.hours
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

  // Generic confirmation
  await updateConversation(psid, { lastIntent: "confirmed" });

  return {
    type: "text",
    text: "¿Qué producto te interesa?"
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
function shouldHandle(classification, sourceContext, convo) {
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
