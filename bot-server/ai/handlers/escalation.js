// ai/handlers/escalation.js
// Handlers for escalation intents: frustration, human request, complaints

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { generateBotResponse } = require("../responseGenerator");
const { isBusinessHours } = require("../utils/businessHours");
const { executeHandoff } = require("../utils/executeHandoff");

const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";

function isMallaContext(convo) {
  return convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' ||
    convo?.currentFlow === 'rollo' ||
    convo?.poiRootId;
}

/**
 * Handle frustration - "Ya te dije!", "No entienden", "No leen"
 *
 * This is CRITICAL for customer experience. When a user is frustrated,
 * the bot must acknowledge, apologize, and try to recover.
 */
async function handleFrustration({ psid, convo, userMessage }) {
  // Check if we have context to recover from
  const hasSize = convo?.productSpecs?.width && convo?.productSpecs?.height;
  const hasRequestedSize = convo?.requestedSize;

  await updateConversation(psid, {
    lastIntent: "frustration_handled",
    unknownCount: 0
  });

  const inBusinessHours = isBusinessHours();

  // If we have dimensions in context, acknowledge and continue with them
  if (hasSize || hasRequestedSize) {
    const size = hasRequestedSize ||
                 `${convo.productSpecs.width}x${convo.productSpecs.height}`;

    const response = await generateBotResponse("frustration_recovery", {
      hasSizeContext: true,
      previousSize: size,
      isAfterHours: !inBusinessHours,
      convo
    });

    return { type: "text", text: response };
  }

  // Check if we have product context
  if (convo?.productInterest) {
    const response = await generateBotResponse("frustration_recovery", {
      hasProductContext: true,
      productInterest: convo.productInterest,
      isAfterHours: !inBusinessHours,
      convo
    });

    return { type: "text", text: response };
  }

  // No context - hand off to human
  const response = await generateBotResponse("frustration_handoff", {
    needsHuman: true,
    isAfterHours: !inBusinessHours,
    convo
  });

  return await executeHandoff(psid, convo, userMessage, {
    reason: `User frustrated - no context to recover`,
    responsePrefix: response,
    skipChecklist: true,
    timingStyle: 'none',
    includeVideo: isMallaContext(convo),
    notificationText: `Cliente frustrado: "${userMessage.substring(0, 100)}"`
  });
}

/**
 * Handle human request - "Quiero hablar con alguien", "Un agente"
 */
async function handleHumanRequest({ psid, convo, userMessage }) {
  const inBusinessHours = isBusinessHours();

  const response = await generateBotResponse("human_request", { isAfterHours: !inBusinessHours, convo });

  return await executeHandoff(psid, convo, userMessage || '', {
    reason: 'User requested human agent',
    responsePrefix: response,
    lastIntent: 'human_request',
    skipChecklist: true,
    timingStyle: 'none',
    includeVideo: isMallaContext(convo),
    notificationText: 'Cliente solicitó hablar con un agente'
  });
}

/**
 * Handle general complaint
 */
async function handleComplaint({ psid, convo, userMessage }) {
  const inBusinessHours = isBusinessHours();

  const response = await generateBotResponse("complaint", { isAfterHours: !inBusinessHours, convo });

  return await executeHandoff(psid, convo, userMessage, {
    reason: `Complaint: ${userMessage.substring(0, 100)}`,
    responsePrefix: response,
    lastIntent: 'complaint',
    skipChecklist: true,
    timingStyle: 'none',
    includeVideo: isMallaContext(convo),
    notificationText: `Queja de cliente: "${userMessage.substring(0, 100)}"`
  });
}

/**
 * Handle price confusion - "Es otro precio?", "Me dijiste diferente"
 */
async function handlePriceConfusion({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "price_confusion",
    unknownCount: 0
  });

  const response = await generateBotResponse("price_confusion", {
    requestedSize: convo?.requestedSize,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle out of stock report - "Dice agotado", "No hay en stock"
 */
async function handleOutOfStock({ psid, convo, userMessage }) {
  const businessInfo = await getBusinessInfo();
  const inBusinessHours = isBusinessHours();

  await updateConversation(psid, {
    lastIntent: "out_of_stock_report",
    unknownCount: 0
  });

  // If they mentioned a specific size
  if (convo?.requestedSize) {
    const response = await generateBotResponse("out_of_stock", {
      requestedSize: convo.requestedSize,
      phone: businessInfo?.phones?.[0] || '442 352 1646',
      whatsapp: "https://wa.me/524425957432",
      needsHuman: true,
      isAfterHours: !inBusinessHours,
      convo
    });

    return await executeHandoff(psid, convo, userMessage, {
      reason: `Product out of stock: ${convo.requestedSize}`,
      responsePrefix: response,
      skipChecklist: true,
      timingStyle: 'none',
      notificationText: `Producto agotado: ${convo.requestedSize}`
    });
  }

  const response = await generateBotResponse("out_of_stock", {
    isAfterHours: !inBusinessHours,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle custom modification request - "3x2 con argollas extras a 1.7"
 * These require human quoting — bot can't handle non-standard specs.
 */
async function handleCustomModification({ psid, convo, userMessage }) {
  const inBusinessHours = isBusinessHours();

  const response = await generateBotResponse("custom_modification", {
    userMessage,
    isAfterHours: !inBusinessHours,
    convo
  });

  return await executeHandoff(psid, convo, userMessage, {
    reason: `Custom modification: ${userMessage.substring(0, 150)}`,
    responsePrefix: response,
    lastIntent: 'custom_modification',
    timingStyle: 'none',
    notificationText: `Solicitud especial: "${userMessage.substring(0, 120)}"`
  });
}

module.exports = {
  handleFrustration,
  handleHumanRequest,
  handleComplaint,
  handlePriceConfusion,
  handleOutOfStock,
  handleCustomModification
};
