// ai/handlers/escalation.js
// Handlers for escalation intents: frustration, human request, complaints

const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getBusinessInfo } = require("../../businessInfoManager");
const { generateBotResponse } = require("../responseGenerator");

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

  // If we have dimensions in context, acknowledge and continue with them
  if (hasSize || hasRequestedSize) {
    const size = hasRequestedSize ||
                 `${convo.productSpecs.width}x${convo.productSpecs.height}`;

    const response = await generateBotResponse("frustration_recovery", {
      hasSizeContext: true,
      previousSize: size,
      convo
    });

    return { type: "text", text: response };
  }

  // Check if we have product context
  if (convo?.productInterest) {
    const response = await generateBotResponse("frustration_recovery", {
      hasProductContext: true,
      productInterest: convo.productInterest,
      convo
    });

    return { type: "text", text: response };
  }

  // No context - hand off to human
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User frustrated - no context to recover",
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  await sendHandoffNotification(psid, convo, `Cliente frustrado: "${userMessage.substring(0, 100)}"`);

  const response = await generateBotResponse("frustration_handoff", {
    needsHuman: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle human request - "Quiero hablar con alguien", "Un agente"
 */
async function handleHumanRequest({ psid, convo }) {
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: "User requested human agent",
    handoffTimestamp: new Date(),
    state: "needs_human",
    lastIntent: "human_request"
  });

  await sendHandoffNotification(psid, convo, "Cliente solicitó hablar con un agente");

  const response = await generateBotResponse("human_request", { convo });

  return { type: "text", text: response };
}

/**
 * Handle general complaint
 */
async function handleComplaint({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Complaint: ${userMessage.substring(0, 100)}`,
    handoffTimestamp: new Date(),
    state: "needs_human",
    lastIntent: "complaint"
  });

  await sendHandoffNotification(psid, convo, `Queja de cliente: "${userMessage.substring(0, 100)}"`);

  const response = await generateBotResponse("complaint", { convo });

  return { type: "text", text: response };
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

  await updateConversation(psid, {
    lastIntent: "out_of_stock_report",
    unknownCount: 0
  });

  // If they mentioned a specific size
  if (convo?.requestedSize) {
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Product out of stock: ${convo.requestedSize}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    await sendHandoffNotification(psid, convo, `Producto agotado: ${convo.requestedSize}`);

    const response = await generateBotResponse("out_of_stock", {
      requestedSize: convo.requestedSize,
      phone: businessInfo?.phones?.[0] || '442 352 1646',
      whatsapp: "https://wa.me/524425957432",
      needsHuman: true,
      convo
    });

    return { type: "text", text: response };
  }

  const response = await generateBotResponse("out_of_stock", {
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleFrustration,
  handleHumanRequest,
  handleComplaint,
  handlePriceConfusion,
  handleOutOfStock
};
