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

  const MAPS_URL = 'https://maps.app.goo.gl/WJbhpMqfUPYPSMdA7';

  // Let AI decide from context whether to give full address
  let response = await generateBotResponse("location_query", {
    userQuestion: userMessage,
    mentionedCity: locationInfo?.normalized || null,
    city: "Querétaro",
    address: MAPS_URL,
    shipsNationwide: true,
    shipsToUSA: true,
    convo
  });

  // Ensure the actual Google Maps URL is present — AI sometimes replaces it with a placeholder
  if (response) {
    // Remove any bracketed placeholder like [Link de ubicación], [Enlace Google Maps], etc.
    response = response.replace(/\[(?:Link|Enlace)[^\]]*\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    // If URL got lost, append it
    if (!response.includes(MAPS_URL)) {
      response += `\n\n${MAPS_URL}`;
    }
  }

  return { type: "text", text: response };
}

/**
 * Handle location mention - user says where they're from
 * "Soy de Monterrey", "Vivo en Jalisco"
 * Just save the city — a location mention is data, not a question.
 * Don't respond about shipping/location. Let the flow continue.
 */
async function handleLocationMention({ psid, userMessage, convo }) {
  const locationInfo = await detectMexicanLocation(userMessage);

  if (locationInfo) {
    await updateConversation(psid, {
      city: locationInfo.normalized,
      stateMx: locationInfo.state || convo?.stateMx,
      unknownCount: 0
    });
    console.log(`📍 Location mention saved: ${locationInfo.normalized} — not responding (it's data, not a question)`);
  }

  // Return null — let the flow manager handle the message
  return null;
}

/**
 * Handle payment query - "Cómo pago?", "Aceptan tarjeta?"
 * Response varies by flow (confeccionada/borde via ML vs rollo/wholesale via transfer)
 */
async function handlePayment({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "payment_query",
    unknownCount: 0
  });

  // Non-ML flows: rollo, groundcover, monofilamento, wholesale
  const isNonML = convo?.currentFlow === 'rollo' ||
    convo?.currentFlow === 'groundcover' ||
    convo?.currentFlow === 'monofilamento' ||
    convo?.productInterest === 'rollo' ||
    convo?.productInterest === 'groundcover' ||
    convo?.productInterest === 'monofilamento' ||
    convo?.isWholesaleInquiry;

  let response;
  if (isNonML) {
    response = "El pago es 100% por adelantado a través de transferencia o depósito bancario.";
  } else {
    // Confeccionada / borde (retail) - Mercado Libre payment options
    response = "En compras a través de Mercado Libre el pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega, llega defectuoso o es diferente a lo solicitado, se te devuelve tu dinero.";
  }

  return { type: "text", text: response };
}

/**
 * Handle pay on delivery query - "Pago al entregar?", "Contra entrega?", "Se paga al entregar?"
 * Response varies by flow (confeccionada/borde via ML vs rollo/wholesale via transfer)
 */
async function handlePayOnDelivery({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "pay_on_delivery_query",
    unknownCount: 0
  });

  // Non-ML flows: rollo, groundcover, monofilamento, wholesale
  const isNonML = convo?.currentFlow === 'rollo' ||
    convo?.currentFlow === 'groundcover' ||
    convo?.currentFlow === 'monofilamento' ||
    convo?.productInterest === 'rollo' ||
    convo?.productInterest === 'groundcover' ||
    convo?.productInterest === 'monofilamento' ||
    convo?.isWholesaleInquiry;

  let response;
  if (isNonML) {
    response = "No manejamos pago contra entrega. El pago es 100% por adelantado a través de transferencia o depósito bancario.";
  } else {
    // Confeccionada / borde (retail) - Mercado Libre protected purchase
    response = "No manejamos pago contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero.";
  }

  return { type: "text", text: response };
}

/**
 * Handle delivery time query - "Cuándo llega?", "Tiempo de entrega?", "Pueden entregarme hoy?"
 */
async function handleDeliveryTime({ psid, convo, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "delivery_time_query",
    unknownCount: 0
  });

  // Check if asking for same-day delivery
  const wantsSameDay = /\b(hoy|ahora|ahorita|inmediato|ya|mismo\s*d[ií]a|de\s*inmediato)\b/i.test(userMessage);

  const response = await generateBotResponse("delivery_time_query", {
    cdmxDays: 'aproximadamente 1-2 días hábiles',
    interiorDays: 'aproximadamente 3-5 días hábiles',
    wantsSameDay,
    userMessage,
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
