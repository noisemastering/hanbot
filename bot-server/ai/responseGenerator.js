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
- Refuerzo en las esquinas
- Sujetadores y argollas en todos los lados, lista para instalar
- Envío a domicilio incluido en el precio
- Se vende por Mercado Libre

REGLAS:
- Cuando des precio, siempre menciona que incluye envío
- Cuando des un link, ponlo en su propia línea
- NO inventes precios ni medidas - usa solo los datos que te proporciono
- Si no tienes un dato, NO lo menciones
- Mantén las respuestas cortas (2-4 oraciones máximo, excepto cuando describas el producto)`;
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
    prompt += `PRODUCTO:\n`;
    if (product.dimensions) prompt += `- Medida: ${product.dimensions}\n`;
    if (product.price) prompt += `- Precio: $${product.price}\n`;
    if (product.link) prompt += `- Link: ${product.link}\n`;
    if (product.features) prompt += `- Características: ${product.features.join(', ')}\n`;
    prompt += `\n`;
  }

  if (convo) {
    if (convo.userName) prompt += `- Nombre del cliente: ${convo.userName}\n`;
    if (convo.city) prompt += `- Ciudad: ${convo.city}\n`;
    if (convo.requestedSize) prompt += `- Medida solicitada anteriormente: ${convo.requestedSize}\n`;
  }

  prompt += `\nGenera una respuesta natural y concisa para este intent.`;

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
      "Refuerzo en las esquinas",
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
  const context = {
    isReturningUser: convo?.greeted || false,
    productInterest: convo?.productInterest || null,
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

module.exports = {
  generateResponse,
  generatePriceResponse,
  generateGreetingResponse,
  generateShippingResponse,
  generateColorResponse,
  generateFrustrationResponse
};
