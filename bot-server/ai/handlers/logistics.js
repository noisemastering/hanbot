// ai/handlers/logistics.js
// Handlers for logistics intents: shipping, location, payment, delivery time

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo, MAPS_URL, STORE_ADDRESS } = require("../../businessInfoManager");
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
  const locationInfo = await detectMexicanLocation(userMessage);

  // Same-intent loop detection
  const isLocationRepeat = convo?.lastIntent === "location_query" || convo?.lastIntent === "location_detailed";
  const isFrustrated = /\b(no\s+(me\s+)?(sirv|funciona|puedo|encuentro|aparece|abre|jal[ae])|ya\s+no|no\s+carga|no\s+abre|otra\s+vez|de\s+nuevo|referencia|cerca\s+de)\b/i.test(userMessage);

  // Already gave full address and user is STILL asking → hand off
  if (convo?.lastIntent === "location_detailed") {
    console.log("📍 Location query 3rd+ time — handing off to human");
    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Cliente no puede ubicar la tienda después de recibir dirección completa y link`,
      responsePrefix: `Entiendo, déjame comunicarte con alguien que te pueda dar indicaciones más detalladas.`,
      lastIntent: 'location_handoff',
      timingStyle: 'elaborate'
    });
  }

  // Repeat location query OR frustrated → give full street address
  const includeFullAddress = isLocationRepeat || isFrustrated ||
    /\b(direcci[oó]n|calle|referencia|c[oó]mo\s+llego|llegar|cerca\s+de|por\s+d[oó]nde)\b/i.test(userMessage);

  await updateConversation(psid, {
    lastIntent: includeFullAddress ? "location_detailed" : "location_query",
    unknownCount: 0
  });

  let response = await generateBotResponse("location_query", {
    userQuestion: userMessage,
    mentionedCity: locationInfo?.normalized || null,
    city: "Querétaro",
    address: MAPS_URL,
    fullAddress: STORE_ADDRESS,
    includeFullAddress,
    shipsNationwide: true,
    shipsToUSA: true,
    convo
  });

  // Ensure the actual Google Maps URL is present and well-formatted
  if (response) {
    response = response.replace(/\[(?:Link|Enlace)[^\]]*\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    // Clean up broken Maps URL formatting — AI sometimes outputs ": ." or ": \n" before the URL
    response = response.replace(/:\s*\.?\s*\n+\s*(https:\/\/www\.google\.com\/maps)/g, ':\n\n$1');
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
