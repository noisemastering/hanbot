// ai/flows/generalFlow.js
// Handles general queries: shipping, location, payment, delivery time, greetings, etc.
// These are non-product-specific queries that can occur at any point in conversation

const { updateConversation } = require("../../conversationManager");
const { MAPS_URL } = require("../../businessInfoManager");
const { INTENTS } = require("../classifier");
const { getAvailableSizes, getMallaSizeRange, parseDimensions } = require("../../measureHandler");
const { isBusinessHours } = require("../utils/businessHours");
const ProductFamily = require("../../models/ProductFamily");

/**
 * Cache for roll sizes from DB (weekly refresh)
 */
let rollSizesCache = null;
let rollSizesCacheExpiry = 0;
const ROLL_SIZES_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Business information constants
 */
const BUSINESS_INFO = {
  name: "Hanlob",
  address: MAPS_URL,
  city: "Querétaro",
  phones: ["442 352 1646"],
  hours: "Lunes a Viernes 9am - 6pm",
  website: "mercadolibre.com/sec/1991696"
};

/**
 * Fetch available roll sizes from DB (cached, 7-day TTL).
 * Returns a display string like "4.20x100m y 2.10x100m" or null if unavailable.
 */
async function getRollSizesText() {
  if (rollSizesCache && Date.now() < rollSizesCacheExpiry) {
    return rollSizesCache;
  }

  try {
    const rolls = await ProductFamily.find({
      sellable: true, active: true,
      size: { $regex: /\d+(?:\.\d+)?\s*x\s*100/i }
    }).select('size').lean();

    // Extract unique roll sizes (e.g., "4.20x100m", "2.10x100m")
    const sizesSet = new Set();
    for (const r of rolls) {
      const m = r.size?.match(/(\d+(?:\.\d+)?)\s*x\s*(100)/i);
      if (m) sizesSet.add(`${m[1]}x${m[2]}m`);
    }

    if (sizesSet.size === 0) {
      console.warn("⚠️ No roll products found in DB");
      return rollSizesCache || null;
    }

    // Sort by width descending (widest first)
    const sorted = [...sizesSet].sort((a, b) => {
      const wa = parseFloat(a), wb = parseFloat(b);
      return wb - wa;
    });

    rollSizesCache = sorted.join(' y ');
    rollSizesCacheExpiry = Date.now() + ROLL_SIZES_TTL;
    console.log(`🔄 Roll sizes cache refreshed: ${rollSizesCache}`);

    return rollSizesCache;
  } catch (err) {
    console.error("❌ Error fetching roll sizes:", err.message);
    return rollSizesCache || null; // Use stale cache if available
  }
}

/**
 * Handle general queries
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  let { intent, entities } = classification;
  const msg = (userMessage || '').toLowerCase();

  // Check for opt-out patterns FIRST (overrides other intents)
  if (/ya\s+(hice|realic[eé]|tengo)\s+(pedido|orden|contacto)|no\s+necesito|de\s+momento\s+no|por\s+ahora\s+no|ya\s+compr[eé]|ya\s+lo\s+ped[ií]/i.test(msg)) {
    intent = "opt_out";
  }

  console.log(`📋 General flow - Intent: ${intent}`);

  // Note: responseGuidance (ai_generate handler) is now handled at the router level
  // using generateGuidedResponse() for AI-powered contextual responses

  switch (intent) {
    case INTENTS.GREETING:
      return handleGreeting(convo, psid);

    case INTENTS.THANKS:
      return handleThanks(convo, psid);

    case INTENTS.GOODBYE:
      return handleGoodbye(convo, psid);

    case INTENTS.SHIPPING_QUERY:
      return handleShipping(entities, convo, psid);

    case INTENTS.LOCATION_QUERY:
      return handleLocation(convo, psid);

    case INTENTS.PAYMENT_QUERY:
      return handlePayment(entities, convo, psid);

    case INTENTS.DELIVERY_TIME_QUERY:
      return handleDeliveryTime(convo, psid);

    case INTENTS.HUMAN_REQUEST:
      return handleHumanRequest(convo, psid);

    case INTENTS.CONFIRMATION:
      return handleConfirmation(convo, psid);

    case INTENTS.REJECTION:
      return handleRejection(convo, psid);

    case INTENTS.MULTI_QUESTION:
      return handleMultiQuestion(entities, convo, psid, userMessage);

    case "opt_out":
      return handleOptOut(convo, psid);

    default:
      return null; // Let other flows handle it
  }
}

/**
 * Handle greeting
 */
async function handleGreeting(convo, psid) {
  await updateConversation(psid, { lastIntent: "greeting" });

  // Check if returning user
  if (convo?.messageCount > 1) {
    return {
      type: "text",
      text: "¡Hola de nuevo! ¿En qué te puedo ayudar?"
    };
  }

  // Cold start greeting
  return {
    type: "text",
    text: "Hola, ¿qué producto te interesa?"
  };
}

/**
 * Handle thanks
 */
async function handleThanks(convo, psid) {
  const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
  await updateConversation(psid, { lastIntent: "thanks" });

  const isMalla = convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' || convo?.poiRootId;
  const videoSuffix = isMalla
    ? `\n\n📽️ Conoce más sobre nuestra malla sombra en este video: ${VIDEO_LINK}`
    : '';

  return {
    type: "text",
    text: `¡Con gusto! Si tienes más preguntas, aquí estamos 😊${videoSuffix}`
  };
}

/**
 * Handle goodbye
 */
async function handleGoodbye(convo, psid) {
  const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
  await updateConversation(psid, {
    lastIntent: "goodbye",
    state: "closed"
  });

  const isMalla = convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' || convo?.poiRootId;
  const videoSuffix = isMalla
    ? `\n\n📽️ Conoce más sobre nuestra malla sombra en este video: ${VIDEO_LINK}`
    : '';

  return {
    type: "text",
    text: `¡Gracias por contactarnos! Que tengas excelente día 🌿${videoSuffix}`
  };
}

/**
 * Handle opt-out (already ordered, not interested, etc.)
 */
async function handleOptOut(convo, psid) {
  await updateConversation(psid, {
    lastIntent: "opt_out",
    state: "closed"
  });

  return {
    type: "text",
    text: "¡Perfecto! Gracias por tu preferencia. Cualquier cosa aquí estamos 🌿"
  };
}

/**
 * Handle shipping query
 */
async function handleShipping(entities, convo, psid) {
  await updateConversation(psid, { lastIntent: "shipping_query" });

  // Check if they mentioned a location
  if (entities.location) {
    await updateConversation(psid, { city: entities.location });
    return {
      type: "text",
      text: `¡Sí! Enviamos a ${entities.location} y a todo el país a través de Mercado Libre 📦\n\n` +
            `El envío está incluido en la mayoría de los productos.\n\n` +
            `¿Qué tipo de producto te interesa?`
    };
  }

  return {
    type: "text",
    text: "¡Sí! Enviamos a todo el país por Mercado Libre 📦\n\n" +
          "El envío está incluido en la mayoría de los productos.\n\n" +
          "¿Qué tipo de producto te interesa?"
  };
}

/**
 * Handle location query
 * IMPORTANT: Lead with shipping info - users often think they can't buy if they're far away
 */
async function handleLocation(convo, psid) {
  await updateConversation(psid, { lastIntent: "location_query" });

  return {
    type: "text",
    text: `¡Enviamos a todo México y también a Estados Unidos! 📦\n\n` +
          `Nuestra tienda física está en ${BUSINESS_INFO.city}. Te comparto nuestra ubicación en Google Maps:\n${BUSINESS_INFO.address}\n\n` +
          `Pero no necesitas visitarnos, te lo enviamos a domicilio.`
  };
}

/**
 * Handle multi-question (e.g., "precio y ubicación")
 * Combines responses for multiple intents in one message
 */
async function handleMultiQuestion(entities, convo, psid, userMessage = '') {
  // If the message contains dimensions, skip multi-question and let the product flow handle it
  // This prevents "Perfecto, anotado + Los precios dependen de la medida" when user already gave dimensions
  if (entities.width && entities.height) {
    console.log(`📏 Multi-question has dimensions (${entities.width}x${entities.height}), deferring to product flow`);
    return null;
  }

  await updateConversation(psid, { lastIntent: "multi_question" });

  const subIntents = entities.subIntents || [];
  const responses = [];

  // Non-ML flows: rollo, groundcover, monofilamento, wholesale
  const isNonML = convo?.currentFlow === 'rollo' ||
    convo?.currentFlow === 'groundcover' ||
    convo?.currentFlow === 'monofilamento' ||
    convo?.productInterest === 'rollo' ||
    convo?.productInterest === 'groundcover' ||
    convo?.productInterest === 'monofilamento' ||
    convo?.isWholesaleInquiry;

  // Response snippets for each intent type (emoji as bullet, no markdown)
  const sizeRange = await getMallaSizeRange(convo);
  const intentResponses = {
    'confirmation': `✅ Perfecto, anotado.`,
    'price_query': `💰 Los precios dependen de la medida que necesites. ¿Qué medida te interesa?`,
    'location_query': `📍 ¡Enviamos a todo México y Estados Unidos! Nuestra tienda está en ${BUSINESS_INFO.city}, pero te lo enviamos a domicilio.`,
    'shipping_query': `📦 Enviamos a todo México y también a Estados Unidos. El envío está incluido en la mayoría de nuestros productos.`,
    'payment_query': isNonML
      ? `El pago es 100% por adelantado a través de transferencia o depósito bancario.`
      : `En compras a través de Mercado Libre el pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega, llega defectuoso o es diferente a lo solicitado, se te devuelve tu dinero.`,
    'availability_query': `✅ Manejamos malla sombra confeccionada desde ${sizeRange.smallest} hasta ${sizeRange.largest}, lista para instalar.`,
    'delivery_time_query': `🚚 Normalmente de 3 a 5 días hábiles dependiendo de tu ubicación.`,
    'installation_query': `En Hanlob no contamos con servicio de instalación, pero nuestra malla sombra confeccionada es muy fácil de instalar. Para saber la medida te sugiero medir el área y restar un metro por lado, por ejemplo si tu área mide 4x5, la malla sombra que ocupas sería la de 3x4 metros.`,
    'product_inquiry': `ℹ️ Tenemos malla sombra confeccionada lista para instalar en diferentes medidas y porcentajes de sombra.`
  };

  // Special handling for pay-on-delivery question
  // Detect from entity flag OR directly from message text — payment upfront must ALWAYS be clarified
  const payOnDeliveryDetected = entities.payOnDelivery ||
    /\b(pago\s+(al\s+)?(recibir|entregar?)|contra\s*entrega|contraentrega|cuando\s+llegue\s+pago|al\s+recibir|la\s+pago\s+al\s+entregar|cobr[ao]\s+al\s+(recibir|entregar?))\b/i.test(userMessage || '');

  if (payOnDeliveryDetected) {
    intentResponses['payment_query'] = isNonML
      ? `No manejamos pago contra entrega. El pago es 100% por adelantado a través de transferencia o depósito bancario.`
      : `No manejamos pago contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero.`;
    // Ensure payment_query is in subIntents so the response actually gets included
    if (!subIntents.includes('payment_query')) {
      subIntents.push('payment_query');
    }
  }

  // Build combined response
  for (const intent of subIntents) {
    if (intentResponses[intent]) {
      responses.push(intentResponses[intent]);
    }
  }

  if (responses.length === 0) {
    return null; // Let other flows handle it
  }

  return {
    type: "text",
    text: responses.join('\n\n')
  };
}

/**
 * Handle payment query
 * Response varies by flow (confeccionada vs wholesale)
 */
async function handlePayment(entities, convo, psid) {
  await updateConversation(psid, { lastIntent: "payment_query" });

  // Determine if wholesale flow (rollo, etc.) or retail (confeccionada)
  const isWholesale = convo?.currentFlow === 'rollo' ||
    convo?.productInterest === 'rollo' ||
    convo?.currentFlow === 'ground_cover' ||
    convo?.currentFlow === 'monofilamento';

  // Check for pay-on-delivery question
  if (entities.payOnDelivery) {
    if (isWholesale) {
      return {
        type: "text",
        text: "No manejamos pago contra entrega. El pago es 100% por adelantado a través de transferencia o depósito bancario."
      };
    }
    return {
      type: "text",
      text: "No manejamos pago contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero."
    };
  }

  // Check for alternative payment question
  if (entities.alternativePayment) {
    return {
      type: "text",
      text: `La única alternativa al pago por Mercado Libre es venir directamente a nuestras oficinas en Querétaro y pagar en efectivo o con tarjeta.\n\n` +
            `📍 ${BUSINESS_INFO.address}\n` +
            `📞 ${BUSINESS_INFO.phones.join(" / ")}\n` +
            `🕓 ${BUSINESS_INFO.hours}\n\n` +
            `¿Te encuentras en Querétaro?`
    };
  }

  // Flow-specific payment response
  if (isWholesale) {
    return {
      type: "text",
      text: "En nuestra tienda física aceptamos efectivo y tarjetas, en envíos aceptamos transferencia bancaria."
    };
  }

  return {
    type: "text",
    text: "En compras a través de Mercado Libre el pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega, llega defectuoso o es diferente a lo solicitado, se te devuelve tu dinero."
  };
}

/**
 * Handle delivery time query
 */
async function handleDeliveryTime(convo, psid) {
  await updateConversation(psid, { lastIntent: "delivery_time_query" });

  return {
    type: "text",
    text: "El tiempo de entrega depende de tu ubicación:\n\n" +
          "• Zona metropolitana: 1-2 días hábiles\n" +
          "• Interior de la república: 2-5 días hábiles\n\n" +
          "Mercado Libre te da la fecha estimada de entrega al hacer tu pedido 📦"
  };
}

/**
 * Handle human request
 */
async function handleHumanRequest(convo, psid) {
  const inBusinessHours = isBusinessHours();

  await updateConversation(psid, {
    lastIntent: "human_request",
    handoffRequested: true,
    handoffReason: "User requested human agent",
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  // Include video if they were talking about malla sombra
  const isMallaContext = convo?.currentFlow === 'malla_sombra' ||
                         convo?.currentFlow === 'rollo' ||
                         convo?.productInterest?.toLowerCase()?.includes('malla');

  const timingNote = inBusinessHours
    ? "Un especialista te contactará a la brevedad."
    : "Nuestro horario de atención es de lunes a viernes de 9am a 6pm. Un especialista te contactará el siguiente día hábil a primera hora.";

  let response = `¡Claro! ${timingNote}\n\n` +
                 "También puedes llamarnos al 📞 " + BUSINESS_INFO.phones[0] +
                 "\n🕓 " + BUSINESS_INFO.hours;

  if (isMallaContext) {
    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    response += `\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;
  }

  return {
    type: "text",
    text: response
  };
}

/**
 * Handle confirmation (yes, ok, that one)
 */
async function handleConfirmation(convo, psid) {
  // The response depends on what we were waiting for
  const lastIntent = convo?.lastIntent;

  // If we were in a product flow and they confirmed
  if (lastIntent?.startsWith("roll_") || lastIntent?.startsWith("malla_") || lastIntent?.startsWith("borde_")) {
    // Let the respective product flow handle it
    return null;
  }

  // User confirmed after "¿Deseas ver la lista?" - show the actual size list!
  if (lastIntent === "generic_measures") {
    console.log("✅ User confirmed to see size list after generic_measures");
    await updateConversation(psid, { lastIntent: "sizes_shown", unknownCount: 0 });

    // Fetch all available sizes
    const availableSizes = await getAvailableSizes(convo);

    if (availableSizes.length > 0) {
      let response = "📐 Aquí están nuestras medidas con precio:\n\n";

      // Show sizes (up to 15)
      const sizesFormatted = availableSizes.slice(0, 15).map(s => `• ${s.sizeStr} - $${s.price}`);
      response += sizesFormatted.join('\n');

      if (availableSizes.length > 15) {
        response += `\n\n... y ${availableSizes.length - 15} medidas más.`;
      }

      const rollSizes = await getRollSizesText();
      if (rollSizes) {
        response += `\n\nTambién manejamos rollos de ${rollSizes}.\n\n`;
      } else {
        response += "\n\n";
      }
      response += "¿Cuál te interesa?";

      return { type: "text", text: response };
    }

    // Fallback if no sizes available (use cached range)
    const fallbackRange = await getMallaSizeRange(convo);
    return {
      type: "text",
      text: `Manejamos medidas desde ${fallbackRange.smallest} hasta ${fallbackRange.largest}. ¿Qué medida necesitas?`
    };
  }

  // Generic confirmation
  await updateConversation(psid, { lastIntent: "confirmed" });

  return {
    type: "text",
    text: "¿Qué tipo de producto te interesa?"
  };
}

/**
 * Handle rejection (no, other, not interested)
 */
async function handleRejection(convo, psid) {
  await updateConversation(psid, { lastIntent: "rejected" });

  return {
    type: "text",
    text: "¿Hay algo más en lo que te pueda ayudar?"
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  const { intent } = classification;

  // Handle social intents
  if ([
    INTENTS.GREETING,
    INTENTS.THANKS,
    INTENTS.GOODBYE,
    INTENTS.HUMAN_REQUEST
  ].includes(intent)) {
    return true;
  }

  // Handle logistics intents
  if ([
    INTENTS.SHIPPING_QUERY,
    INTENTS.LOCATION_QUERY,
    INTENTS.PAYMENT_QUERY,
    INTENTS.DELIVERY_TIME_QUERY
  ].includes(intent)) {
    return true;
  }

  // Handle MULTI_QUESTION only if NO dimensions are present
  // If dimensions are present, let product flows handle it (they can give specific prices)
  if (intent === INTENTS.MULTI_QUESTION) {
    const hasDimensions = /\d+\s*[xX×]\s*\d+/.test(userMessage);
    if (!hasDimensions) {
      return true;
    }
    // Has dimensions - let product flow handle it
    console.log(`📏 MULTI_QUESTION has dimensions, deferring to product flow`);
  }

  // Pattern-based detection for common queries (fallback when intent is unclear)
  if (userMessage) {
    const msg = userMessage.toLowerCase();

    // IMPORTANT: If message contains product dimensions (e.g., "8x4"), defer to product flows
    // They will handle the main query and append secondary answers (location, shipping, etc.)
    const hasDimensions = /\d+\s*[xX×]\s*\d+/.test(msg);
    if (hasDimensions) {
      console.log(`📏 Message has dimensions, deferring to product flow for multi-question handling`);
      return false;
    }

    // Location patterns (sucursal, tienda, donde están, etc.)
    if (/d[oó]nde\s+(est[aá]n|tienen|se\s+ubican|quedan)|ubicaci[oó]n|direcci[oó]n|sucursal|tienda\s+f[ií]sica/i.test(msg)) {
      classification.intent = INTENTS.LOCATION_QUERY; // Override for handler
      return true;
    }

    // Shipping patterns (envían, domicilio, etc.)
    if (/env[ií](an?|os?)\s+(a|hasta)|hacen\s+env[ií]os?|llega\s+a|a\s+domicilio|entregan?\s+(a|en)/i.test(msg)) {
      classification.intent = INTENTS.SHIPPING_QUERY;
      return true;
    }

    // Payment patterns (exclude "contra entrega" - handled by PAY_ON_DELIVERY_QUERY in dispatcher)
    if (/c[oó]mo\s+(se\s+)?paga|formas?\s+de\s+pago|aceptan\s+tarjeta/i.test(msg)) {
      classification.intent = INTENTS.PAYMENT_QUERY;
      return true;
    }

    // Human request patterns
    if (/hablar\s+con\s+(alguien|una?\s+persona|humano|asesor|especialista)|at[ie]ende\s+una?\s+persona/i.test(msg)) {
      classification.intent = INTENTS.HUMAN_REQUEST;
      return true;
    }

    // Opt-out patterns (already ordered, not interested, have contact elsewhere)
    if (/ya\s+(hice|realic[eé]|tengo)\s+(pedido|orden|contacto)|no\s+necesito|de\s+momento\s+no|por\s+ahora\s+no|ya\s+compr[eé]|ya\s+lo\s+ped[ií]/i.test(msg)) {
      classification.intent = "opt_out";
      return true;
    }
  }

  // Handle confirmation/rejection only if not in a product flow
  if ([INTENTS.CONFIRMATION, INTENTS.REJECTION].includes(intent)) {
    const lastIntent = convo?.lastIntent;
    // Don't handle if in a product flow
    if (lastIntent?.startsWith("roll_") ||
        lastIntent?.startsWith("malla_") ||
        lastIntent?.startsWith("borde_")) {
      return false;
    }
    return true;
  }

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  BUSINESS_INFO
};
