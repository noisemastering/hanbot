// ai/handlers/purchase.js
// Handlers for purchase-related intents: store link, how to buy, bulk discount, phone

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { getBusinessInfo } = require("../../businessInfoManager");
const { generateBotResponse } = require("../responseGenerator");
const { getCatalogUrl } = require("../flowManager");

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
    const { executeHandoff } = require("../utils/executeHandoff");
    return await executeHandoff(psid, convo, '', {
      reason: 'Rollo inquiry asking about ML - needs quote',
      responsePrefix: 'Los rollos de malla sombra se cotizan directamente con nuestro equipo de ventas.\n\n',
      lastIntent: 'rollo_ml_inquiry',
      timingStyle: 'elaborate',
      includeQueretaro: false
    });
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
    return {
      type: "text",
      text: `¡Sí, vendemos por Mercado Libre! Te comparto nuestra tienda:\n\n${trackedLink}\n\n¿Qué producto te interesa?`
    };
  }

  // Has product context - give store link
  return {
    type: "text",
    text: `¡Sí! Puedes comprar en nuestra Tienda Oficial de Mercado Libre:\n\n${trackedLink}\n\n¿Te ayudo a encontrar la medida que necesitas?`
  };
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
 * Handle bulk discount - "Si compro 5 me hacen descuento?", "Precio por cantidad"
 * Buyer wants multiple units for personal use or a project.
 */
async function handleBulkDiscount({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "bulk_discount",
    unknownCount: 0
  });

  let text = "¡Ahora puedes acceder a precio de mayoreo a partir de la compra de 5 mallas en adelante!\n\n" +
    "Es una excelente oportunidad para comenzar o fortalecer tu venta de malla sombra con mejores márgenes, sin compras excesivas y de forma sencilla.\n\n" +
    "Si tienes alguna duda o quieres una cotización personalizada, con gusto te apoyo.";

  // Attach catalog if available
  const catalogUrl = await getCatalogUrl(convo, convo?.currentFlow);
  if (catalogUrl) {
    text += `\n\n📄 Aquí está nuestro catálogo con lista de precios:\n${catalogUrl}`;
  }

  return { type: "text", text };
}

/**
 * Handle reseller inquiry - "Quiero revender", "Soy distribuidor"
 * Prospect wants to become a distributor/reseller.
 */
async function handleResellerInquiry({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "reseller_inquiry",
    unknownCount: 0
  });

  let text = "Somos fabricantes de malla sombra de alta calidad y buscamos revendedores que quieran expandir su negocio.\n\n" +
    "Beneficios para revendedores:\n" +
    "• Descuento por mayoreo para maximizar tu ganancia\n" +
    "• Variedad de medidas y colores para diferentes usos\n" +
    "• Entrega rápida y atención personalizada\n\n" +
    "Si quieres revender un producto rentable, con gusto te preparo una cotización especial.";

  // Attach catalog if available
  const catalogUrl = await getCatalogUrl(convo, convo?.currentFlow);
  if (catalogUrl) {
    text += `\n\n📄 Aquí está nuestro catálogo con lista de precios:\n${catalogUrl}`;
  }

  return { type: "text", text };
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
  handleResellerInquiry,
  handlePhoneRequest,
  handlePricePerSqm
};
