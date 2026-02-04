// ai/handlers/conversation.js
// Handlers for conversation flow intents: future interest, will get back

const { updateConversation } = require("../../conversationManager");
const { generateBotResponse } = require("../responseGenerator");

/**
 * Handle future interest - "En un par de meses", "Más adelante"
 * User is interested but not ready to buy now
 */
async function handleFutureInterest({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "future_interest",
    leadStatus: "future",
    unknownCount: 0
  });

  const response = await generateBotResponse("future_interest", {
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle will get back - "Mañana te aviso", "Voy a medir"
 * User needs to take action before continuing
 */
async function handleWillGetBack({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "will_get_back",
    leadStatus: "pending_action",
    unknownCount: 0
  });

  const response = await generateBotResponse("will_get_back", {
    userMessage,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle confirmation/acknowledgment - "Ok", "De acuerdo", "Perfecto", 👍
 * User acknowledges info we provided
 */
async function handleConfirmation({ psid, convo, userMessage }) {
  await updateConversation(psid, { lastIntent: "confirmation", unknownCount: 0 });

  // Check if we should ask for location stats (after they acknowledged receiving a link)
  const { askLocationStatsQuestion } = require("../utils/locationStats");
  const locationQuestion = await askLocationStatsQuestion(psid, convo);
  if (locationQuestion) {
    console.log("📊 Asking location stats after confirmation");
    return locationQuestion;
  }

  // Otherwise, ask if they need anything else
  const response = await generateBotResponse("acknowledgment", {
    userName: convo?.userName,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle store visit intention - "Los visito en su tienda"
 */
async function handleStoreVisit({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "store_visit_planned",
    unknownCount: 0
  });

  const response = await generateBotResponse("store_visit", {
    userMessage,
    storeAddress: "Calle Loma de San Gremal 108, bodega 73, Navex Park, Querétaro",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle purchase deferral - "Lo voy a pensar", "Mañana te aviso"
 */
async function handlePurchaseDeferral({ psid, convo }) {
  await updateConversation(psid, {
    state: "deferred",
    lastIntent: "purchase_deferred",
    unknownCount: 0
  });

  const response = await generateBotResponse("purchase_deferral", { convo });

  return { type: "text", text: response };
}

/**
 * Handle location too far - "Muy lejos", "Cómo puedo adquirir"
 */
async function handleLocationTooFar({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "location_too_far",
    unknownCount: 0
  });

  const response = await generateBotResponse("location_too_far", {
    userMessage,
    leadScore: convo?.leadScore || null,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleFutureInterest,
  handleWillGetBack,
  handleConfirmation,
  handleStoreVisit,
  handlePurchaseDeferral,
  handleLocationTooFar
};
