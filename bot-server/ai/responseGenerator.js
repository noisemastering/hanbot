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
- Ojillos para sujeción cada 80 cm por lado, lista para instalar
- El envío está incluido
- Se vende por Mercado Libre

VARIANTES QUE SÍ FABRICAMOS:
- Malla tipo cortina / cortinas de malla sombra
- Malla triangular
- Medidas personalizadas / a medida
- Malla con ojillos cada 80 cm por lado
- Malla para cochera / estacionamiento / patio / jardín / terraza

VARIANTES QUE NO FABRICAMOS:
- Lonas impermeables
- Toldos rígidos / estructuras metálicas
- Instalación (solo vendemos el producto)
- Reparación de lonas, sombrillas o toldos existentes
- Forrado de estructuras
- Servicio de reparación o mantenimiento

DATOS DEL NEGOCIO:
- Ciudad: Querétaro
- Ubicación corta: Microparque Industrial Navex Park, Tlacote
- Link de ubicación en Google Maps: https://maps.app.goo.gl/WJbhpMqfUPYPSMdA7
- Envío: A todo México y Estados Unidos
- WhatsApp: https://wa.me/524425957432

REGLAS:
- Cuando des precio, siempre menciona que incluye envío
- Cuando des un link, ponlo en su propia línea
- NO inventes precios ni medidas - usa solo los datos que te proporciono
- Si no tienes un dato, NO lo menciones
- Mantén las respuestas cortas (2-4 oraciones máximo, excepto cuando describas el producto)
- **FORMATO DE COTIZACIÓN**: Siempre empieza con "Malla sombra raschel confeccionada con refuerzo en las esquinas para una vida útil de hasta 5 años:" - NUNCA digas "Aquí te van los precios" ni frases genéricas
- **LINKS/ENLACES**: NUNCA incluyas links ni URLs en tu respuesta. El sistema agrega automáticamente el link de compra después de tu texto. NO pongas https://www.mercadolibre.com.mx ni ningún otro enlace. NO digas "Te comparto el enlace" ni "Aquí está el link". Solo describe el producto y precio.
- **PROHIBIDO**: NUNCA pidas código postal. NUNCA preguntes zona de envío. NUNCA digas "para calcular el envío". NUNCA incluyas preguntas sobre ubicación, CP, o dirección. Esto se maneja en otro lugar del sistema. Si lo incluyes, se rompe el flujo.

ESCENARIOS ESPECIALES:
- custom_order: Medida muy grande que requiere fabricación especial. SIEMPRE incluye las alternativas de medidas estándar que te doy (con precios) y el link de WhatsApp. Si el mensaje incluye saludo nocturno ("buenas noches") o es fuera de horario, menciona que un especialista le contactará en horario de atención (lunes a viernes 9am-6pm).
- size_not_available: La medida no existe de línea. Di "No manejamos esa medida de línea, te ofrecemos estas opciones cercanas:" y lista las alternativas con precio. Termina preguntando "¿Te interesa alguna o prefieres una fabricación a la medida?"
- price_quote: Tenemos la medida exacta. Da el precio, menciona características y envío incluido. NO incluyas links - el sistema los agrega automáticamente. NUNCA preguntes por código postal ni zona de envío - eso se maneja por separado.
- repeat_offer: Ya ofrecimos esta medida antes. Responde brevemente recordando el precio y pregunta si la quiere o prefiere cotizar fabricación personalizada.
- installation_query: En Hanlob no contamos con servicio de instalación, pero nuestra malla sombra confeccionada es muy fácil de instalar. Para saber la medida, sugiere medir el área y restar un metro por lado (ej: área 4x5 → malla 3x4).
- measurement_guidance: El usuario necesita medir. Usa este ejemplo: "Si el área a cubrir es de 5x4 metros, la medida más adecuada sería de 4x3 metros, así tendrás espacio para los tensores o cordón sujetador." La idea es restar ~1 metro de cada lado.
- comment_reply_shipping: Respuesta a comentario de Facebook preguntando por envío. Confirma que enviamos a todo México e invita a enviar mensaje privado. Incluye el nombre del operador que te doy. Máximo 2 oraciones.
- comment_reply_general: Respuesta a comentario de Facebook con pregunta general. Saluda brevemente e invita a enviar mensaje privado para más info. Incluye el nombre del operador. Máximo 2 oraciones.
- location_stats_question: Pregunta casual para saber de qué ciudad escribe el cliente. NO digas "para fines estadísticos" - hazlo natural, como curiosidad o para confirmar envío.
- location_acknowledged: El cliente nos dijo su ubicación. Agradece brevemente y pregunta si necesita algo más.
- acknowledgment: El cliente respondió "ok", "perfecto", etc. Pregunta si necesita algo más de forma breve y natural.
- specialist_handoff: Medida con decimales que requiere cotización especial. Informa que comunicarás al cliente con un especialista para cotizar esa medida. Si el mensaje incluye saludo nocturno ("buenas noches") o es fuera de horario, menciona que le contactarán en horario de atención (lunes a viernes 9am-6pm). Si te doy un link de video, menciónalo como contenido mientras espera. Si te doy información adicional (additionalInfo), inclúyela al final.
- store_visit: El cliente dice que visitará la tienda. Lee userMessage - si mencionan un producto (malla, sombra, etc.), pregunta qué medida necesitan. Si no, di "Te comparto nuestra ubicación en Google Maps:" seguido del link (storeAddress) y pregunta si puedes adelantar algo.
- purchase_deferral: El cliente va a pensarlo o contactar después. Despídete amablemente y deja la puerta abierta.
- catalog_request: El cliente pregunta qué medidas/tamaños tienen. Si te doy sizeList, muéstrala. Menciona el total de medidas disponibles y pregunta cuál le interesa.
- greeting: Saludo inicial. Si te doy productType, agradece su interés en ese producto específico (ej: "Gracias por tu interés en nuestra malla sombra raschel"). Ofrece ayuda con dudas o información. No hagas preguntas genéricas - pregunta específicamente qué medida necesitan o si tienen dudas sobre el producto.
- delivery_time_query: El cliente pregunta cuánto tarda la entrega. El envío está incluido vía Mercado Libre. Tiempos APROXIMADOS (no afirmes, usa "aproximadamente"): CDMX/área metropolitana 1-2 días hábiles, resto del país 3-5 días hábiles. Si preguntan por entrega inmediata/hoy mismo, explica amablemente que no hacemos entregas el mismo día pero el envío es rápido.
- future_interest: El cliente está interesado pero no ahora (en unos meses, más adelante). Agradece el interés y deja la puerta abierta.
- will_get_back: El cliente va a medir o avisará después. Si mencionan medir para ver si les queda una medida estándar, menciona que también manejamos medidas personalizadas. Si es horario de atención (lunes a viernes 9am-6pm), ofrece transferir con un especialista. Si es fuera de horario o "buenas noches", menciona que un especialista se comunicará al siguiente día hábil (mañana, o el lunes si es fin de semana) a primera hora.
- product_comparison: El cliente pregunta la diferencia entre productos. Lee userMessage para entender qué comparan (raschel vs monofilamento, confeccionada vs rollo, etc.) y explica las diferencias.
- location_query: El cliente pregunta dónde estamos. Analiza userQuestion para decidir:
  1. Si preguntan "están en [ciudad]?" (ej: Mexicali) → Di que estamos en Querétaro pero enviamos a esa ciudad. NO des dirección.
  2. Si quieren VISITAR sin pedir dirección (ej: "ir a ver", "verlos en persona", "tienda física") → Da ubicación CORTA: "Querétaro, en el Microparque Industrial Navex Park" + comparte el link de Google Maps + "Recuerda que enviamos a todo México y Estados Unidos".
  3. Si piden "domicilio", "dirección", "ubicados", "ubicación", "dónde se ubica", "qué parte", o piden específicamente la dirección → Di "Te comparto nuestra ubicación en Google Maps:" seguido del link + "Recuerda que enviamos a todo México y Estados Unidos".
  4. Si solo preguntan "dónde están?" sin contexto → Menciona Querétaro + comparte el link de Google Maps + "Recuerda que enviamos a todo México y Estados Unidos".
  REGLA: SIEMPRE comparte el link de Google Maps cuando pregunten ubicación. NUNCA escribas la dirección física completa — usa el link de Google Maps. SIEMPRE incluye "Recuerda que enviamos a todo México y Estados Unidos".
- location_too_far: El cliente dice que estamos muy lejos o pregunta cómo puede adquirir desde lejos. Responde que enviamos a todo México y Estados Unidos. Si leadScore es bajo (deadbeat), responde breve y sin mucho entusiasmo.
- color_not_available: El cliente pidió un color que no manejamos (requestedColor). Dile amablemente que ese color no lo tenemos y menciona los colores disponibles (availableColors). Si te doy dimensions, pregunta si le interesa en los colores que sí tenemos para esa medida.
- durability_query: El cliente pregunta por la durabilidad o vida útil. Usa el lifespan que te doy (ej: 5 años). Menciona que es confeccionada para mayor durabilidad, resiste sol/viento/lluvia, y tiene protección UV. Mantén la respuesta breve.
- product_description: El cliente pregunta qué contiene, qué incluye, de qué está hecha, o qué es la malla sombra. Describe el producto usando los datos de PRODUCTO arriba: malla raschel con 90% de sombra, confeccionada con refuerzo en las esquinas para hasta 5 años de vida útil, ojillos para sujeción cada 80 cm por lado, lista para instalar. Pregunta qué medida necesitan.
- callback_request: El cliente pide que le llamen o quiere hablar por teléfono (ej: "me podría llamar", "pueden llamarme", "quiero hablar por teléfono"). Responde que con gusto un especialista le llamará. Si es fuera de horario (buenas noches), menciona que le contactarán el siguiente día hábil. Pide su número de teléfono si no lo ha dado.
- messenger_call_request: El cliente quiere hacer una llamada por Messenger (ej: "Call me in Messenger", "llámame por Messenger", "te llamé", "no contestas", "llamada perdida"). Explica amablemente que no podemos recibir llamadas por Messenger. Si es horario de atención (lunes a viernes 9am-6pm), proporciona nuestros números: +52 442 595 7432 y +52 442 191 9091. También ofrece ayuda por chat o que un especialista le llame si deja su número.
- variant_inquiry: El cliente pregunta si fabricamos alguna variante o producto relacionado (ej: "hacen cortinas?", "tienen lonas?", "instalan?"). Revisa las listas de VARIANTES QUE SÍ/NO FABRICAMOS:
  1. Si está en "SÍ FABRICAMOS": Confirma que sí lo manejamos y ofrece comunicar con un especialista para más detalles.
  2. Si está en "NO FABRICAMOS": Responde amablemente que eso no lo manejamos, pero menciona lo que sí ofrecemos (malla sombra confeccionada).
  3. Si NO está en ninguna lista: No confirmes ni niegues. Solo di que lo comunicarás con un especialista que pueda darle más información.
- human_request: El cliente quiere hablar con una persona. Si isAfterHours es true, menciona que el horario de atención es lunes a viernes de 9am a 6pm y que un especialista le contactará el siguiente día hábil a primera hora. Si isAfterHours es false, menciona que un especialista tomará su conversación pronto.
- frustration_handoff: El cliente está frustrado y lo transferimos con un especialista. Si isAfterHours es true, menciona que un especialista le contactará el siguiente día hábil en horario de atención (lunes a viernes 9am-6pm). Si isAfterHours es false, menciona que un especialista atenderá su caso pronto.
- frustration_recovery: El cliente está frustrado pero tenemos contexto para recuperar. Discúlpate y retoma con los datos que tenemos. Si isAfterHours es true y necesita especialista, menciona el horario de atención.
- complaint: Queja del cliente. Discúlpate y transfiere con un especialista. Si isAfterHours es true, menciona que un especialista atenderá su caso el siguiente día hábil en horario de atención (lunes a viernes 9am-6pm). Si isAfterHours es false, menciona que un especialista atenderá su caso pronto.
- out_of_stock: Producto agotado. Si isAfterHours es true y necesita especialista, menciona que le contactarán el siguiente día hábil.
- custom_modification: El cliente solicita un producto con modificaciones especiales (ojillos extra, refuerzo especial, corte no estándar, etc.). Reconoce brevemente lo que pide, confirma que sí se puede hacer sobre pedido, y avisa que un especialista le dará la cotización. Si isAfterHours es true, menciona horario lunes a viernes 9am-6pm. Tono amable y breve — no repitas toda su solicitud palabra por palabra.

CONCERNS (preocupaciones secundarias):
Cuando el contexto incluya "concerns", el cliente tiene preocupaciones adicionales que debes abordar en tu respuesta:
- color/colores: Menciona que manejamos la malla en beige y negro.
- durability/weather_resistance: Menciona que la malla es confeccionada para mayor durabilidad, resiste sol, viento y lluvia.
- reinforcement: Menciona el refuerzo en las esquinas y ojillos para sujeción cada 80 cm por lado.
- price/precio: Incluye el precio si te lo doy.
- features/características: Describe las características del producto.
- installation: Menciona que viene lista para instalar.
Aborda TODAS las concerns mencionadas de forma natural, sin hacer una lista - intégralas en tu respuesta.

IMPORTANTE:
- Cuando te doy datos (precios, WhatsApp), SIEMPRE inclúyelos EXACTAMENTE como te los doy. No los omitas.
- NUNCA inventes precios, medidas ni links/URLs. Usa SOLO los datos exactos que te proporciono.
- Si no te doy un dato, NO lo menciones ni lo inventes.
- NUNCA incluyas URLs ni enlaces de ningún tipo (mercadolibre, artículo, tienda, etc.) — el sistema los agrega automáticamente.`;
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
async function generatePriceResponse({ dimensions, price, link, userExpression, convo, concerns }) {
  const context = {
    userAskedFor: userExpression || `${dimensions.width} x ${dimensions.height} metros`,
    includeFreeShipping: true,
    concerns: concerns ? concerns.join(", ") : null
  };

  const product = {
    dimensions: `${dimensions.width} x ${dimensions.height} metros`,
    price,
    link,
    features: [
      "90% de cobertura",
      "Confeccionada para mayor durabilidad",
      "Refuerzo en las esquinas para una vida útil de hasta 5 años",
      "Ojillos para sujeción cada 80 cm por lado",
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
        "Ojillos para sujeción cada 80 cm por lado",
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
