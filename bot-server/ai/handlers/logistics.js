// ai/handlers/logistics.js
// Handlers for logistics intents: shipping, location, payment, delivery time

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { detectMexicanLocation } = require("../../mexicanLocations");
const { generateBotResponse } = require("../responseGenerator");

/**
 * Handle shipping query - "Hacen envíos?", "Envían a mi ciudad?"
 */
async function handleShipping({ entities, psid, convo, userMessage }) {
  // Check if location was mentioned in the query
  const locationInfo = entities.location ? { normalized: entities.location } : await detectMexicanLocation(userMessage);

  if (locationInfo) {
    await updateConversation(psid, {
      lastIntent: "shipping_query",
      city: locationInfo.normalized,
      unknownCount: 0
    });

    const response = await generateBotResponse("shipping_query", {
      userLocation: locationInfo.normalized,
      shipsNationwide: true,
      freeShipping: true,
      carrier: "Mercado Libre",
      convo
    });

    return { type: "text", text: response };
  }

  // Check product context for specific response
  const isRollInterest = convo?.productInterest === 'rollo' || convo?.lastIntent?.includes('roll');

  if (isRollInterest) {
    await updateConversation(psid, {
      lastIntent: "awaiting_zipcode",
      unknownCount: 0
    });

    const response = await generateBotResponse("shipping_query_roll", {
      needsZipcode: true,
      convo
    });

    return { type: "text", text: response };
  }

  await updateConversation(psid, {
    lastIntent: "shipping_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("shipping_query", {
    shipsNationwide: true,
    freeShipping: true,
    carrier: "Mercado Libre",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle location query - "Dónde están?", "Tienen tienda física?"
 */
async function handleLocation({ psid, userMessage, convo }) {
  const businessInfo = await getBusinessInfo();

  // Detect if user mentioned a specific city
  const locationInfo = await detectMexicanLocation(userMessage);

  await updateConversation(psid, {
    lastIntent: "location_query",
    unknownCount: 0
  });

  // Let AI decide from context whether to give full address
  const response = await generateBotResponse("location_query", {
    userQuestion: userMessage,
    mentionedCity: locationInfo?.normalized || null,
    city: "Querétaro",
    address: businessInfo?.address || 'Calle Loma de San Gremal 108, bodega 73, Navex Park',
    shipsNationwide: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle location mention - user says where they're from
 * "Soy de Monterrey", "Vivo en Jalisco"
 */
async function handleLocationMention({ psid, userMessage, convo }) {
  const locationInfo = await detectMexicanLocation(userMessage);

  if (locationInfo) {
    await updateConversation(psid, {
      lastIntent: "location_mentioned",
      city: locationInfo.normalized,
      unknownCount: 0
    });

    const response = await generateBotResponse("location_mentioned", {
      userLocation: locationInfo.normalized,
      shipsNationwide: true,
      convo
    });

    return { type: "text", text: response };
  }

  // Could not detect location
  await updateConversation(psid, {
    lastIntent: "location_mentioned",
    unknownCount: 0
  });

  const response = await generateBotResponse("location_mentioned", {
    shipsNationwide: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle payment query - "Cómo pago?", "Aceptan tarjeta?"
 */
async function handlePayment({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "payment_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("payment_query", {
    paymentMethods: ['Tarjeta de crédito/débito', 'Transferencia bancaria', 'Efectivo en OXXO/7-Eleven'],
    monthsWithoutInterest: 12,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle pay on delivery query - "Pago al entregar?", "Contra entrega?"
 */
async function handlePayOnDelivery({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "pay_on_delivery_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("pay_on_delivery_query", {
    payOnDeliveryAvailable: false,
    requiresAdvancePayment: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle delivery time query - "Cuándo llega?", "Tiempo de entrega?"
 */
async function handleDeliveryTime({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "delivery_time_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("delivery_time_query", {
    cdmxDays: '1-2 días hábiles',
    interiorDays: '3-5 días hábiles',
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle shipping included query - "Ya incluye envío?", "El precio es con entrega?"
 */
async function handleShippingIncluded({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "shipping_included_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("shipping_included_query", {
    shippingIncluded: true,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleShipping,
  handleLocation,
  handleLocationMention,
  handlePayment,
  handlePayOnDelivery,
  handleDeliveryTime,
  handleShippingIncluded
};
