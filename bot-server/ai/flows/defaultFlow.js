// ai/flows/defaultFlow.js
// Default flow - handles conversations before a product is identified
// This is still a FLOW - scoring runs, context is tracked
// When product is detected, flow manager transfers to appropriate product flow

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");
const { getAvailableSizes, generateGenericSizeResponse } = require("../../measureHandler");
const { generateBotResponse } = require("../responseGenerator");
const { isBusinessHours } = require("../utils/businessHours");

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
  const isReturningUser = convo?.greeted && convo?.lastMessageAt;
  let hoursSinceLastMessage = null;

  if (isReturningUser) {
    hoursSinceLastMessage = (Date.now() - new Date(convo.lastMessageAt).getTime()) / (1000 * 60 * 60);
  }

  await updateConversation(psid, { greeted: true });

  const response = await generateBotResponse("greeting", {
    isReturningUser,
    hoursSinceLastMessage,
    productInterest: convo?.productInterest,
    intentLevel,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Thanks handler
 */
async function handleThanks(convo, psid) {
  const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
  const response = await generateBotResponse("thanks", { convo });

  const isMalla = convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' || convo?.poiRootId;
  const videoSuffix = isMalla
    ? `\n\n📽️ Conoce más sobre nuestra malla sombra en este video: ${VIDEO_LINK}`
    : '';

  return { type: "text", text: response + videoSuffix };
}

/**
 * Goodbye handler
 */
async function handleGoodbye(convo, psid) {
  const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
  await updateConversation(psid, { state: "closed" });

  const response = await generateBotResponse("goodbye", {
    userName: convo?.userName,
    convo
  });

  const isMalla = convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' || convo?.poiRootId;
  const videoSuffix = isMalla
    ? `\n\n📽️ Conoce más sobre nuestra malla sombra en este video: ${VIDEO_LINK}`
    : '';

  return { type: "text", text: response + videoSuffix };
}

/**
 * Shipping query - general (no product context yet)
 */
async function handleShipping(entities, convo, psid) {
  const response = await generateBotResponse("shipping_query", {
    shipsNationwide: true,
    freeShipping: true,
    carrier: "Mercado Libre",
    noProductContext: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Location query
 */
async function handleLocation(convo, psid) {
  const response = await generateBotResponse("location_query", {
    address: 'https://maps.app.goo.gl/WJbhpMqfUPYPSMdA7',
    phone: '442 352 1646',
    hours: 'Lunes a Viernes 9am - 6pm',
    whatsapp: "https://wa.me/524425957432",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Payment query - response varies by flow
 */
async function handlePayment(convo, psid) {
  // Determine if wholesale flow (rollo, etc.) or retail (confeccionada)
  const isWholesale = convo?.currentFlow === 'rollo' ||
    convo?.productInterest === 'rollo' ||
    convo?.currentFlow === 'ground_cover' ||
    convo?.currentFlow === 'monofilamento';

  let response;
  if (isWholesale) {
    response = "En nuestra tienda física aceptamos efectivo y tarjetas, en envíos aceptamos transferencia bancaria.";
  } else {
    response = "En compras a través de Mercado Libre el pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega, llega defectuoso o es diferente a lo solicitado, se te devuelve tu dinero.";
  }

  return { type: "text", text: response };
}

/**
 * Human request
 */
async function handleHumanRequest(convo, psid) {
  const inBusinessHours = isBusinessHours();

  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User requested human",
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  const response = await generateBotResponse("human_request", { isAfterHours: !inBusinessHours, convo });
  return { type: "text", text: response };
}

/**
 * Product inquiry without specific product - ask what they need
 */
async function handleProductInquiry(convo, psid, userMessage) {
  const response = await generateBotResponse("product_inquiry", {
    noProductContext: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Confirmation without context
 */
async function handleConfirmation(convo, psid) {
  const response = await generateBotResponse("confirmation_no_context", { convo });
  return { type: "text", text: response };
}

/**
 * Rejection without context
 */
async function handleRejection(convo, psid) {
  const response = await generateBotResponse("rejection", { convo });
  return { type: "text", text: response };
}

/**
 * Unclear intent - guide the conversation
 */
async function handleUnclear(convo, psid, userMessage, flowContext = {}) {
  const intentLevel = flowContext.intentScore?.intent || 'medium';

  const response = await generateBotResponse("unclear_intent", {
    intentLevel,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  shouldHandle,
  handle
};
