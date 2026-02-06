// ai/responseGenerator.js
// AI-powered response generation - no hardcoded templates
// Handlers provide context, AI generates natural responses

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Generate a natural response using AI
 *
 * @param {object} options
 * @param {string} options.intent - The classified intent
 * @param {object} options.context - Relevant context for the response
 * @param {object} options.product - Product data (if applicable)
 * @param {object} options.convo - Conversation state
 * @returns {string} AI-generated response
 */
async function generateResponse({ intent, context, product, convo }) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ intent, context, product, convo });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ AI response generation failed:", error.message);
    // Return null to let caller handle fallback
    return null;
  }
}

function buildSystemPrompt() {
  return `Eres una asesora de ventas de Hanlob, empresa mexicana que vende malla sombra confeccionada.

PERSONALIDAD:
- Amable y profesional, pero natural (no robótica)
- Respuestas concisas y directas
- Usa español mexicano casual pero respetuoso
- NO uses emojis excesivos (máximo 1-2 por mensaje si es apropiado)
- NO hagas preguntas innecesarias si ya tienes la información

PRODUCTO - MALLA SOMBRA CONFECCIONADA:
- 90% de cobertura/sombra
- Confeccionada para mayor durabilidad
- Refuerzo en las esquinas para ofrecer una vida útil de hasta 5 años
- Sujetadores y argollas en todos los lados, lista para instalar
- Envío a domicilio incluido en el precio
- Se vende por Mercado Libre

REGLAS:
- Cuando des precio, siempre menciona que incluye envío
- Cuando des un link, ponlo en su propia línea
- NO inventes precios ni medidas - usa solo los datos que te proporciono
- Si no tienes un dato, NO lo menciones
- Mantén las respuestas cortas (2-4 oraciones máximo, excepto cuando describas el producto)

ESCENARIOS ESPECIALES:
- custom_order: Medida muy grande que requiere fabricación especial. SIEMPRE incluye las alternativas de medidas estándar que te doy (con precios) y el link de WhatsApp.
- size_not_available: La medida no existe. SIEMPRE incluye la alternativa más cercana (con precio y link si hay) y el WhatsApp para fabricación a medida.
- price_quote: Tenemos la medida exacta. Da el precio, menciona características y envío incluido. SIEMPRE incluye el link de compra.
- repeat_offer: Ya ofrecimos esta medida antes. Responde brevemente recordando el precio y pregunta si la quiere o prefiere cotizar fabricación personalizada.
- installation_query: No ofrecemos instalación. Menciona que podemos ayudar con las medidas y especificaciones.
- measurement_guidance: El usuario necesita medir. Recomienda medir el área y elegir una malla un poco más pequeña (~1m²) para dejar espacio a los tensores.
- comment_reply_shipping: Respuesta a comentario de Facebook preguntando por envío. Confirma que enviamos a todo México e invita a enviar mensaje privado. Incluye el nombre del operador que te doy. Máximo 2 oraciones.
- comment_reply_general: Respuesta a comentario de Facebook con pregunta general. Saluda brevemente e invita a enviar mensaje privado para más info. Incluye el nombre del operador. Máximo 2 oraciones.
- location_stats_question: Pregunta casual para saber de qué ciudad escribe el cliente. NO digas "para fines estadísticos" - hazlo natural, como curiosidad o para confirmar envío.
- location_acknowledged: El cliente nos dijo su ubicación. Agradece brevemente y pregunta si necesita algo más.
- acknowledgment: El cliente respondió "ok", "perfecto", etc. Pregunta si necesita algo más de forma breve y natural.
- specialist_handoff: Medida con decimales que requiere cotización especial. Informa que comunicarás al cliente con un especialista para cotizar esa medida. Si te doy un link de video, menciónalo como contenido mientras espera. Si te doy información adicional (additionalInfo), inclúyela al final.
- store_visit: El cliente dice que visitará la tienda. Lee userMessage - si mencionan un producto (malla, sombra, etc.), pregunta qué medida necesitan. Si no, da la dirección (storeAddress) y pregunta si puedes adelantar algo.
- purchase_deferral: El cliente va a pensarlo o contactar después. Despídete amablemente y deja la puerta abierta.
- catalog_request: El cliente pregunta qué medidas/tamaños tienen. Si te doy sizeList, muéstrala. Menciona el total de medidas disponibles y pregunta cuál le interesa.
- greeting: Saludo inicial. Si te doy productType, agradece su interés en ese producto específico (ej: "Gracias por tu interés en nuestra malla sombra raschel"). Ofrece ayuda con dudas o información. No hagas preguntas genéricas - pregunta específicamente qué medida necesitan o si tienen dudas sobre el producto.
- delivery_time_query: El cliente pregunta cuánto tarda la entrega. El envío es gratis vía Mercado Libre. Tiempos APROXIMADOS (no afirmes, usa "aproximadamente"): CDMX/área metropolitana 1-2 días hábiles, resto del país 3-5 días hábiles. Si preguntan por entrega inmediata/hoy mismo, explica amablemente que no hacemos entregas el mismo día pero el envío es rápido.
- future_interest: El cliente está interesado pero no ahora (en unos meses, más adelante). Agradece el interés y deja la puerta abierta.
- will_get_back: El cliente va a medir o avisará después. Lee userMessage - si mencionan medir, deséales suerte con las medidas. Despídete amablemente.
- product_comparison: El cliente pregunta la diferencia entre productos. Lee userMessage para entender qué comparan (raschel vs monofilamento, confeccionada vs rollo, etc.) y explica las diferencias.
- location_query: El cliente pregunta dónde estamos. Analiza userQuestion para decidir:
  1. Si preguntan "están en [ciudad]?" (ej: Mexicali) → Di que estamos en Querétaro pero enviamos a esa ciudad sin costo. NO des dirección.
  2. Si quieren VISITAR (ej: "ir a ver", "verlos en persona", "tienda física") → Da ubicación CORTA: "Querétaro, en el Microparque Industrial Navex Park, pero enviamos a todo el país". NO des calle ni número.
  3. Si dicen "ubicados" o piden específicamente la dirección → Da la dirección COMPLETA con calle y número.
  4. Si solo preguntan "dónde están?" sin contexto → Menciona Querétaro + enviamos a todo México. No des dirección.
- location_too_far: El cliente dice que estamos muy lejos o pregunta cómo puede adquirir desde lejos. Responde que enviamos a todo México sin costo adicional vía Mercado Libre. Si leadScore es bajo (deadbeat), responde breve y sin mucho entusiasmo.
- color_not_available: El cliente pidió un color que no manejamos (requestedColor). Dile amablemente que ese color no lo tenemos y menciona los colores disponibles (availableColors). Si te doy dimensions, pregunta si le interesa en los colores que sí tenemos para esa medida.
- durability_query: El cliente pregunta por la durabilidad o vida útil. Usa el lifespan que te doy (ej: 5 años). Menciona que es confeccionada para mayor durabilidad, resiste sol/viento/lluvia, y tiene protección UV. Mantén la respuesta breve.

CONCERNS (preocupaciones secundarias):
Cuando el contexto incluya "concerns", el cliente tiene preocupaciones adicionales que debes abordar en tu respuesta:
- durability/weather_resistance: Menciona que la malla es confeccionada para mayor durabilidad, resiste sol, viento y lluvia.
- reinforcement: Menciona el refuerzo en las esquinas y sujetadores/argollas en todos los lados.
- price/precio: Incluye el precio si te lo doy.
- features/características: Describe las características del producto.
- installation: Menciona que viene lista para instalar.
Aborda TODAS las concerns mencionadas de forma natural, sin hacer una lista - intégralas en tu respuesta.

IMPORTANTE:
- Cuando te doy datos (precios, links, WhatsApp), SIEMPRE inclúyelos EXACTAMENTE como te los doy. No los omitas.
- NUNCA inventes precios, medidas ni links. Usa SOLO los datos exactos que te proporciono.
- Si no te doy un dato, NO lo menciones ni lo inventes.`;
}

function buildUserPrompt({ intent, context, product, convo }) {
  let prompt = `INTENT: ${intent}\n\n`;

  if (context) {
    prompt += `CONTEXTO:\n`;
    for (const [key, value] of Object.entries(context)) {
      if (value !== null && value !== undefined) {
        prompt += `- ${key}: ${value}\n`;
      }
    }
    prompt += `\n`;
  }

  if (product) {
    prompt += `DATOS DEL PRODUCTO (usa EXACTAMENTE estos valores, no inventes otros):\n`;
    if (product.dimensions) prompt += `- Medida: ${product.dimensions}\n`;
    if (product.price) prompt += `- Precio: $${product.price}\n`;
    if (product.link) prompt += `- Link de compra: ${product.link}\n`;
    if (product.features) prompt += `- Características: ${product.features.join(', ')}\n`;
    if (product.availableAlternatives) prompt += `- Alternativas disponibles: ${product.availableAlternatives}\n`;
    if (product.whatsapp) prompt += `- WhatsApp: ${product.whatsapp}\n`;
    if (product.alternativeSize) prompt += `- Medida alternativa: ${product.alternativeSize}\n`;
    if (product.alternativePrice) prompt += `- Precio alternativa: $${product.alternativePrice}\n`;
    if (product.alternativeLink) prompt += `- Link alternativa: ${product.alternativeLink}\n`;
    if (product.largestSize) prompt += `- Medida más grande: ${product.largestSize}\n`;
    if (product.largestPrice) prompt += `- Precio más grande: $${product.largestPrice}\n`;
    prompt += `\n`;
  }

  if (convo) {
    if (convo.userName) prompt += `- Nombre del cliente: ${convo.userName}\n`;
    if (convo.city) prompt += `- Ciudad: ${convo.city}\n`;
    if (convo.requestedSize) prompt += `- Medida solicitada anteriormente: ${convo.requestedSize}\n`;
  }

  prompt += `\nGenera una respuesta natural y concisa. USA SOLO los datos proporcionados arriba, no inventes precios ni links.`;

  return prompt;
}

/**
 * Generate price quote response
 */
async function generatePriceResponse({ dimensions, price, link, userExpression, convo }) {
  const context = {
    userAskedFor: userExpression || `${dimensions.width} x ${dimensions.height} metros`,
    includeFreeShipping: true
  };

  const product = {
    dimensions: `${dimensions.width} x ${dimensions.height} metros`,
    price,
    link,
    features: [
      "90% de cobertura",
      "Confeccionada para mayor durabilidad",
      "Refuerzo en las esquinas para una vida útil de hasta 5 años",
      "Sujetadores y argollas en todos los lados",
      "Lista para instalar"
    ]
  };

  const response = await generateResponse({
    intent: "price_quote",
    context,
    product,
    convo
  });

  return response;
}

/**
 * Generate greeting response
 */
async function generateGreetingResponse({ convo, hasProductContext }) {
  // Map product type to friendly name
  const productNames = {
    'malla_sombra': 'malla sombra raschel',
    'rollo': 'malla sombra en rollo',
    'monofilamento': 'malla monofilamento'
  };

  const context = {
    isReturningUser: convo?.greeted || false,
    productInterest: convo?.productInterest || null,
    productType: productNames[convo?.productType] || convo?.productType || null,
    hasProductContext
  };

  return await generateResponse({
    intent: "greeting",
    context,
    convo
  });
}

/**
 * Generate shipping response
 */
async function generateShippingResponse({ location, convo }) {
  const context = {
    userLocation: location || null,
    shipsNationwide: true,
    freeShipping: true,
    carrier: "Mercado Libre"
  };

  return await generateResponse({
    intent: "shipping_info",
    context,
    convo
  });
}

/**
 * Generate color query response
 */
async function generateColorResponse({ requestedColor, availableColors, convo }) {
  const context = {
    requestedColor: requestedColor || null,
    availableColors: availableColors.join(", "),
    productType: convo?.productInterest || "malla sombra confeccionada"
  };

  return await generateResponse({
    intent: "color_query",
    context,
    convo
  });
}

/**
 * Generate frustration/escalation response
 */
async function generateFrustrationResponse({ convo, hasContext }) {
  const context = {
    hasExistingContext: hasContext,
    previousSize: convo?.requestedSize || null,
    shouldApologize: true
  };

  return await generateResponse({
    intent: "frustration_recovery",
    context,
    convo
  });
}

/**
 * Generate custom order response (large sizes needing special fabrication)
 */
async function generateCustomOrderResponse({ dimensions, largestSizes, convo }) {
  const context = {
    requestedSize: `${dimensions.width} x ${dimensions.height} metros`,
    isCustomOrder: true,
    needsSpecialist: true,
    canCombineSizes: true
  };

  const product = {
    availableAlternatives: largestSizes.map(s => `${s.sizeStr} por $${s.price}`).join(', '),
    whatsapp: "https://wa.me/524425957432"
  };

  return await generateResponse({
    intent: "custom_order",
    context,
    product,
    convo
  });
}

/**
 * Generate no-match response (size not available, suggest alternatives)
 */
async function generateNoMatchResponse({ dimensions, closestSize, largestSize, convo }) {
  const context = {
    requestedSize: dimensions ? `${dimensions.width} x ${dimensions.height} metros` : null,
    hasCloserAlternative: !!closestSize,
    exceedsMaxSize: !closestSize && !!largestSize
  };

  const product = {};
  if (closestSize) {
    product.alternativeSize = closestSize.sizeStr;
    product.alternativePrice = closestSize.price;
    product.alternativeLink = closestSize.mLink || closestSize.permalink;
  }
  if (largestSize) {
    product.largestSize = largestSize.sizeStr;
    product.largestPrice = largestSize.price;
  }
  product.whatsapp = "https://wa.me/524425957432";

  return await generateResponse({
    intent: "size_not_available",
    context,
    product,
    convo
  });
}

/**
 * Universal response generator - ALL bot responses should go through this
 * Pass intent and data, get AI-generated natural response
 */
async function generateBotResponse(intent, data = {}) {
  const context = {
    intent,
    ...data
  };

  // Build product info if we have product data
  let product = null;
  if (data.price || data.link || data.dimensions || data.size) {
    product = {
      dimensions: data.dimensions || data.size,
      price: data.price,
      link: data.link,
      features: data.features || [
        "90% de cobertura",
        "Confeccionada para mayor durabilidad",
        "Refuerzo en las esquinas para una vida útil de hasta 5 años",
        "Sujetadores y argollas en todos los lados",
        "Lista para instalar",
        "Envío incluido"
      ],
      whatsapp: data.whatsapp || "https://wa.me/524425957432",
      availableAlternatives: data.alternatives,
      alternativeSize: data.alternativeSize,
      alternativePrice: data.alternativePrice,
      alternativeLink: data.alternativeLink
    };
  }

  return await generateResponse({ intent, context, product, convo: data.convo });
}

module.exports = {
  generateResponse,
  generatePriceResponse,
  generateGreetingResponse,
  generateShippingResponse,
  generateColorResponse,
  generateFrustrationResponse,
  generateCustomOrderResponse,
  generateNoMatchResponse,
  generateBotResponse
};
