// ai/flows/defaultFlow.js
// Default flow - handles conversations before a product is identified
// This is still a FLOW - scoring runs, context is tracked
// When product is detected, flow manager transfers to appropriate product flow

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");
const { getAvailableSizes, generateGenericSizeResponse } = require("../../measureHandler");
const { generateBotResponse } = require("../responseGenerator");

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
  const response = await generateBotResponse("thanks", { convo });
  return { type: "text", text: response };
}

/**
 * Goodbye handler
 */
async function handleGoodbye(convo, psid) {
  await updateConversation(psid, { state: "closed" });

  const response = await generateBotResponse("goodbye", {
    userName: convo?.userName,
    convo
  });

  return { type: "text", text: response };
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
    address: 'Calle Loma de San Gremal 108, bodega 73, Parque Industrial Navex',
    phone: '442 352 1646',
    hours: 'Lunes a Viernes 9am - 6pm',
    whatsapp: "https://wa.me/524425957432",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Payment query
 */
async function handlePayment(convo, psid) {
  const response = await generateBotResponse("payment_query", {
    paymentMethods: ['Tarjeta de crédito/débito', 'Transferencia bancaria', 'Efectivo en OXXO/7-Eleven'],
    monthsWithoutInterest: 12,
    convo
  });

  return { type: "text", text: response };
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

  const response = await generateBotResponse("human_request", { convo });
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
