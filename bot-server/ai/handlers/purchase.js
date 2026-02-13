// ai/handlers/purchase.js
// Handlers for purchase-related intents: store link, how to buy, bulk discount, phone

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { getBusinessInfo } = require("../../businessInfoManager");
const { generateBotResponse } = require("../responseGenerator");

const STORE_URL = "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
const WHATSAPP_LINK = "https://wa.me/524425957432";

/**
 * Handle store link request - "Link de la tienda", "Mercado Libre?"
 */
async function handleStoreLinkRequest({ psid, convo }) {
  // Check if conversation is about rollos (need human contact, not directly on ML)
  const isRolloContext = convo?.productInterest === 'rollo' ||
                         convo?.lastIntent?.includes('roll') ||
                         convo?.productSpecs?.productType === 'rollo';

  if (isRolloContext) {
    await updateConversation(psid, {
      lastIntent: "rollo_ml_inquiry",
      handoffRequested: true,
      handoffReason: "Rollo inquiry asking about ML - needs quote",
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    const response = await generateBotResponse("store_link_rollo", {
      needsQuote: true,
      convo
    });

    return { type: "text", text: response };
  }

  const trackedLink = await generateClickLink(psid, STORE_URL, {
    productName: "Tienda Oficial",
    campaignId: convo?.campaignId,
    adSetId: convo?.adSetId,
    adId: convo?.adId,
    userName: convo?.userName,
    city: convo?.city,
    stateMx: convo?.stateMx
  });

  await updateConversation(psid, {
    lastIntent: "store_link_requested",
    unknownCount: 0
  });

  // If no product context yet, confirm ML and ask what they need
  if (!convo?.productInterest) {
    const response = await generateBotResponse("store_link_no_context", {
      link: trackedLink,
      convo
    });

    return { type: "text", text: response };
  }

  // Has product context - give store link
  const response = await generateBotResponse("store_link_request", {
    link: trackedLink,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle how to buy - "Cómo compro?", "Proceso de compra?"
 */
async function handleHowToBuy({ psid, convo }) {
  const trackedLink = await generateClickLink(psid, STORE_URL, {
    productName: "Tienda Oficial",
    campaignId: convo?.campaignId,
    city: convo?.city,
    stateMx: convo?.stateMx
  });

  await updateConversation(psid, {
    lastIntent: "how_to_buy",
    unknownCount: 0
  });

  const response = await generateBotResponse("how_to_buy", {
    link: trackedLink,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle bulk discount - "Precio por mayoreo", "Descuento por volumen"
 */
async function handleBulkDiscount({ psid, convo }) {
  const info = await getBusinessInfo();

  // Check if we already gave the bulk discount response recently
  const isRepeat = convo?.lastIntent === "bulk_discount";

  await updateConversation(psid, {
    lastIntent: "bulk_discount",
    state: "needs_human",
    unknownCount: 0
  });

  const response = await generateBotResponse("bulk_discount", {
    isRepeat,
    minimumOrder: '$20,000 MXN',
    whatsapp: WHATSAPP_LINK,
    phone: info?.phones?.join(" / ") || "442 352 1646",
    hours: info?.hours || "Lun-Vie 9am-6pm",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle phone request - "Teléfono?", "Número para llamar?"
 */
async function handlePhoneRequest({ psid, convo }) {
  const info = await getBusinessInfo();

  await updateConversation(psid, {
    lastIntent: "phone_request",
    unknownCount: 0
  });

  const response = await generateBotResponse("phone_request", {
    phone: info?.phones?.[0] || "442 352 1646",
    whatsapp: WHATSAPP_LINK,
    hours: info?.hours || "Lun-Vie 9am-6pm",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle price per square meter - "Precio por metro cuadrado", "Cuánto el m2"
 */
async function handlePricePerSqm({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "price_per_sqm",
    unknownCount: 0
  });

  const response = await generateBotResponse("price_per_sqm", {
    hasPricePerSqm: false,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleStoreLinkRequest,
  handleHowToBuy,
  handleBulkDiscount,
  handlePhoneRequest,
  handlePricePerSqm
};
