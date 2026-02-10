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
 * Also handles purchase intent: "Me interesa", "Lo quiero"
 */
async function handleConfirmation({ psid, convo, userMessage }) {
  // If we just responded to an acknowledgment, don't repeat - close the conversation
  if (convo?.lastIntent === "confirmation") {
    console.log("👋 Repeated acknowledgment detected, closing conversation gracefully");
    await updateConversation(psid, {
      lastIntent: "goodbye",
      state: "closed",
      unknownCount: 0
    });
    // Stay silent - no need to respond to repeated "Ok"
    return null;
  }

  // Defer to flow manager when a flow is waiting for this confirmation
  const flowAwaitingStates = [
    "awaiting_alternatives_confirmation",
    "custom_order_awaiting_decision",
    "custom_order_awaiting_purpose",
    "custom_order_awaiting_zipcode",
    "awaiting_zipcode",
    "roll_awaiting_width",
    "lead_awaiting_catalog_choice",
    "lead_awaiting_name",
    "lead_awaiting_zipcode",
    "lead_awaiting_products"
  ];

  if (flowAwaitingStates.some(s => convo?.lastIntent === s)) {
    console.log(`✋ Confirmation deferred to flow (lastIntent: ${convo.lastIntent})`);
    return null;
  }

  await updateConversation(psid, { lastIntent: "confirmation", unknownCount: 0 });

  // Check if this is purchase intent ("me interesa", "lo quiero") after a price quote
  const isPurchaseIntent = /\b(m[eé]?\s*interesa|lo\s*quiero|la\s*quiero)\b/i.test(userMessage);
  const hadPriceQuote = convo?.lastIntent?.includes('quoted') || convo?.requestedSize;

  if (isPurchaseIntent && hadPriceQuote) {
    // User is interested in buying - re-share the purchase link
    const { generateClickLink } = require("../../tracking");
    const ProductFamily = require("../../models/ProductFamily");

    // Try to find the product they were quoted
    let link = convo?.lastProductLink;
    let size = convo?.requestedSize;

    if (!link && size) {
      // Try to regenerate the link
      const [w, h] = size.split('x').map(Number);
      if (w && h) {
        const sizeRegex = new RegExp(`^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`, 'i');
        const product = await ProductFamily.findOne({
          sellable: true,
          active: true,
          size: sizeRegex
        }).lean();

        if (product) {
          const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                               product.onlineStoreLinks?.[0]?.url;
          if (preferredLink) {
            link = await generateClickLink(psid, preferredLink, {
              productName: product.name,
              productId: product._id
            });
          }
        }
      }
    }

    if (link) {
      return {
        type: "text",
        text: `¡Perfecto! Aquí está el link para que puedas realizar tu compra:\n\n${link}\n\nSi tienes alguna duda, aquí estoy para ayudarte.`
      };
    }
  }

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
    storeAddress: "https://maps.app.goo.gl/WJbhpMqfUPYPSMdA7",
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
