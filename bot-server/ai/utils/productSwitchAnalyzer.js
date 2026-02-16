// ai/utils/productSwitchAnalyzer.js
// AI-powered analysis to confirm ambiguous product switches
// Prevents false switches from single keyword matches (e.g., "rollo" typo triggering groundcover switch)

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const PRODUCT_FLOWS = {
  malla_sombra: "malla sombra confeccionada (piezas cortadas a medida)",
  rollo: "rollos de malla sombra (100m de largo, venta por rollo completo)",
  groundcover: "malla antimaleza / ground cover (control de hierbas)",
  monofilamento: "malla monofilamento (uso agrícola)",
  borde_separador: "borde separador para jardín (cinta plástica)"
};

/**
 * Use AI to confirm whether the customer actually wants a different product
 * or is just continuing the same conversation with an ambiguous keyword.
 *
 * @param {string} userMessage - The user's message
 * @param {string} currentFlow - Current product flow name
 * @param {object} convo - Conversation object (for recent messages context)
 * @param {object} sourceContext - Ad/source context
 * @returns {Promise<{shouldSwitch: boolean, targetProduct: string|null, confidence: number}>}
 */
async function analyzeProductSwitch(userMessage, currentFlow, convo, sourceContext) {
  try {
    const currentProductDesc = PRODUCT_FLOWS[currentFlow] || currentFlow;
    const adOrigin = sourceContext?.ad?.product || sourceContext?.ad?.flowRef || 'desconocido';

    // Build recent messages context (last 3)
    const recentMessages = (convo?.lastMessages || []).slice(-3).map(m =>
      `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.text}`
    ).join('\n');

    const availableProducts = Object.entries(PRODUCT_FLOWS)
      .filter(([key]) => key !== currentFlow)
      .map(([key, desc]) => `- ${key}: ${desc}`)
      .join('\n');

    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de intenciones para un chatbot de ventas de mallas sombra.

El cliente está actualmente en el flujo de: ${currentProductDesc}
Origen del anuncio: ${adOrigin}

Otros productos disponibles:
${availableProducts}

${recentMessages ? `Últimos mensajes:\n${recentMessages}\n` : ''}
Analiza si el cliente REALMENTE quiere cambiar a un producto diferente, o si simplemente está continuando la conversación sobre el mismo producto con una palabra ambigua.

IMPORTANTE:
- "rollo" o "royo" pueden ser un typo de "rollo de malla sombra" O referirse al producto en rollo. Si el cliente ya está en malla_sombra y dice "rollo" sin más contexto, probablemente habla del mismo producto en presentación rollo, NO de cambiar a groundcover.
- Si el cliente vino de un anuncio de un producto específico, es MUY probable que siga interesado en ese producto.
- Solo marca shouldSwitch=true si hay clara intención de cambiar de producto.

Responde ÚNICAMENTE con JSON:
{
  "shouldSwitch": true/false,
  "targetProduct": "nombre_del_flujo" o null,
  "confidence": 0.0-1.0,
  "reason": "breve explicación"
}`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 150
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`🤖 Product switch analysis: ${JSON.stringify(result)}`);

    return {
      shouldSwitch: !!result.shouldSwitch,
      targetProduct: result.targetProduct || null,
      confidence: result.confidence || 0.5
    };
  } catch (error) {
    console.error("❌ Error analyzing product switch:", error.message);
    // Fail safe — never switch on error
    return { shouldSwitch: false, targetProduct: null, confidence: 0 };
  }
}

module.exports = { analyzeProductSwitch };
