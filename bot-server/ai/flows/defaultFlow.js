// ai/flows/defaultFlow.js
// Default flow - handles conversations before a product is identified
// This is still a FLOW - scoring runs, context is tracked
// When product is detected, flow manager transfers to appropriate product flow

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");
const { getAvailableSizes, generateGenericSizeResponse } = require("../../measureHandler");

/**
 * Check if this flow should handle the message
 * Default flow handles everything that isn't product-specific
 */
function shouldHandle(classification, sourceContext, convo, userMessage) {
  // Default flow is the catch-all - it always can handle
  return true;
}

/**
 * Handle message in default flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '', flowContext = {}) {
  const { intent, entities } = classification;
  const msg = (userMessage || '').toLowerCase();

  console.log(`📋 Default flow - Intent: ${intent}`);

  // Track that we're in default flow
  await updateConversation(psid, { lastIntent: intent });

  switch (intent) {
    case INTENTS.GREETING:
      return handleGreeting(convo, psid, flowContext);

    case INTENTS.THANKS:
      return handleThanks(convo, psid);

    case INTENTS.GOODBYE:
      return handleGoodbye(convo, psid);

    case INTENTS.SHIPPING_QUERY:
      return handleShipping(entities, convo, psid);

    case INTENTS.LOCATION_QUERY:
      return handleLocation(convo, psid);

    case INTENTS.PAYMENT_QUERY:
      return handlePayment(convo, psid);

    case INTENTS.HUMAN_REQUEST:
      return handleHumanRequest(convo, psid);

    case INTENTS.PRICE_QUERY:
    case INTENTS.PRODUCT_INQUIRY:
      // No product detected yet - ask what they need
      return handleProductInquiry(convo, psid, userMessage);

    case INTENTS.CONFIRMATION:
      return handleConfirmation(convo, psid);

    case INTENTS.REJECTION:
      return handleRejection(convo, psid);

    default:
      // For unclear intents, ask what they're looking for
      return handleUnclear(convo, psid, userMessage, flowContext);
  }
}

/**
 * Greeting handler
 */
async function handleGreeting(convo, psid, flowContext = {}) {
  // Check purchase intent from scoring
  const intentLevel = flowContext.intentScore?.intent || 'medium';

  if (convo?.greeted && convo?.lastMessageAt) {
    // Returning user
    const hoursSince = (Date.now() - new Date(convo.lastMessageAt).getTime()) / (1000 * 60 * 60);

    if (hoursSince < 1) {
      return {
        type: "text",
        text: "¡Hola de nuevo! ¿En qué más te puedo ayudar?"
      };
    }
  }

  await updateConversation(psid, { greeted: true });

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
 * Thanks handler
 */
async function handleThanks(convo, psid) {
  return {
    type: "text",
    text: "¡Con gusto! ¿Hay algo más en lo que pueda ayudarte?"
  };
}

/**
 * Goodbye handler
 */
async function handleGoodbye(convo, psid) {
  await updateConversation(psid, { state: "closed" });

  return {
    type: "text",
    text: "¡Gracias por contactarnos! Que tengas excelente día. 🌿"
  };
}

/**
 * Shipping query - general (no product context yet)
 */
async function handleShipping(entities, convo, psid) {
  return {
    type: "text",
    text: "¡Claro! Enviamos a todo México con envío gratis en la mayoría de los productos a través de Mercado Libre.\n\n" +
          "¿Qué producto te interesa para darte más detalles?"
  };
}

/**
 * Location query
 */
async function handleLocation(convo, psid) {
  return {
    type: "text",
    text: "Estamos ubicados en Querétaro:\n\n" +
          "📍 Calle Loma de San Gremal 108, bodega 73\n" +
          "Parque Industrial Navex, C.P. 76137\n" +
          "Santiago de Querétaro\n\n" +
          "🕓 Lunes a Viernes 9am - 6pm\n" +
          "📞 442 352 1646\n\n" +
          "¿Te gustaría ver nuestros productos?"
  };
}

/**
 * Payment query
 */
async function handlePayment(convo, psid) {
  return {
    type: "text",
    text: "Puedes pagar de forma segura a través de Mercado Libre:\n\n" +
          "💳 Tarjeta de crédito/débito\n" +
          "🏦 Transferencia bancaria\n" +
          "💵 Efectivo en OXXO/7-Eleven\n" +
          "📅 Hasta 12 meses sin intereses\n\n" +
          "¿Qué producto te interesa?"
  };
}

/**
 * Human request
 */
async function handleHumanRequest(convo, psid) {
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User requested human",
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  return {
    type: "text",
    text: "¡Claro! Te comunico con un asesor. En un momento te atienden."
  };
}

/**
 * Product inquiry without specific product - ask what they need
 */
async function handleProductInquiry(convo, psid, userMessage) {
  return {
    type: "text",
    text: "¿Qué producto te interesa?\n\n" +
          "• **Malla sombra confeccionada** - Lista para instalar, desde 2x2m hasta 6x10m\n" +
          "• **Rollos de malla sombra** - 100m de largo, para proyectos grandes\n" +
          "• **Borde separador** - Para delimitar jardines"
  };
}

/**
 * Confirmation without context
 */
async function handleConfirmation(convo, psid) {
  // User said "yes" but we don't have context
  return {
    type: "text",
    text: "¡Perfecto! ¿Qué producto o medida te interesa?"
  };
}

/**
 * Rejection without context
 */
async function handleRejection(convo, psid) {
  return {
    type: "text",
    text: "Entendido. ¿Hay algo más en lo que pueda ayudarte?"
  };
}

/**
 * Unclear intent - guide the conversation
 */
async function handleUnclear(convo, psid, userMessage, flowContext = {}) {
  const intentLevel = flowContext.intentScore?.intent || 'medium';

  // If low intent (possible troll/competitor), keep response minimal
  if (intentLevel === 'low') {
    return {
      type: "text",
      text: "¿En qué puedo ayudarte?"
    };
  }

  // Medium/high intent - be more helpful
  return {
    type: "text",
    text: "¿Qué producto te interesa? Manejamos malla sombra, rollos y borde separador para jardín."
  };
}

module.exports = {
  shouldHandle,
  handle
};
