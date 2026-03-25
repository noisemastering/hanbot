// ai/flows/retailFlow.js
// Model flow — handles the retail sales process.
// Does NOT handle products (that's product_flow's job).
// Handles: quoting, purchase links, descriptions, handoff rules, wholesale detection.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Handoff rules — coded per product type.
 * Each rule receives the product data and returns { shouldHandoff, reason } or null.
 */
const HANDOFF_RULES = [
  // Oversized confeccionada
  {
    name: 'oversized_confeccionada',
    check: (product) => {
      if (!product || !product.name) return null;
      const isConfeccionada = /confeccionada/i.test(product.name);
      if (!isConfeccionada) return null;
      // Dimensions beyond what ML listings cover
      const width = product.requestedWidth;
      const length = product.requestedLength;
      if (width && length && (width > 6 || length > 12)) {
        return { shouldHandoff: true, reason: `Confeccionada ${width}x${length}m excede medidas estándar` };
      }
      return null;
    }
  }
];

/**
 * Check if any handoff rule triggers for a product.
 * @param {Object} product - Product data from product_flow
 * @returns {{ shouldHandoff: boolean, reason: string }|null}
 */
function checkHandoffRules(product) {
  for (const rule of HANDOFF_RULES) {
    const result = rule.check(product);
    if (result?.shouldHandoff) return result;
  }
  return null;
}

/**
 * Detect if the customer is asking for wholesale.
 * @param {string} userMessage
 * @returns {boolean}
 */
function detectWholesale(userMessage) {
  if (!userMessage) return false;
  const wholesalePatterns = /\b(mayoreo|al\s*por\s*mayor|distribuidor|lote|grandes\s*cantidades|precio\s*por\s*volumen|revend|negocio|tienda|local\s*comercial)\b/i;
  return wholesalePatterns.test(userMessage);
}

/**
 * Build a quote message using AI — mimics human interaction.
 * @param {Array} products - Products from product_flow [{ productId, name, description, price, link, colors, variants }]
 * @param {Object} options - { voice, customerName, salesChannel }
 * @returns {Promise<string>} AI-generated quote message
 */
async function buildQuoteMessage(products, options = {}) {
  const { voice = 'casual', customerName = null, salesChannel = 'mercado_libre', colorNote = null, conversationHistory = '' } = options;

  const voiceInstructions = {
    casual: 'Habla de manera amigable y relajada, como un vendedor joven y accesible. Usa "tú".',
    professional: 'Habla de manera profesional pero cálida. Usa "usted" cuando sea apropiado.',
    technical: 'Sé preciso y detallado en las especificaciones técnicas. Incluye datos relevantes del producto.'
  };

  const channelNote = salesChannel === 'mercado_libre'
    ? 'La compra se realiza por Mercado Libre. El envío está incluido y tiene compra protegida.'
    : 'La compra es directa con nosotros.';

  const productList = products.map((p, i) => {
    let entry = `Producto ${i + 1}: ${p.name}`;
    if (p.description) entry += `\nDescripción: ${p.description}`;
    if (p.price) entry += `\nPrecio: $${p.price}`;
    if (p.link) entry += `\nLink de compra: ${p.link}`;
    if (p.colors?.length) entry += `\nColores: ${p.colors.join(', ')}`;
    return entry;
  }).join('\n\n');

  const systemPrompt = `Eres asesora de ventas de Hanlob.
${voiceInstructions[voice] || voiceInstructions.casual}

Genera un mensaje de cotización natural, como si lo escribiera una persona.
- ${channelNote}
${customerName ? `- El cliente se llama ${customerName}` : ''}
${colorNote ? `- ${colorNote}` : ''}

FORMATO:
- Máximo 2-4 oraciones por producto
- Incluye siempre el precio y el link de compra
- Escribe las URLs como texto plano (ejemplo: https://ejemplo.com)
- El envío ya está incluido — ve directo al precio y link
- Usa solo los datos proporcionados, nada inventado
- Solo menciona los productos proporcionados
- Solo devuelve el mensaje, nada más`;

  const userPrompt = `PRODUCTOS:
${productList}
${conversationHistory ? `\n${conversationHistory}` : ''}
Genera el mensaje de cotización.`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 500
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('❌ [retail] AI quote error:', err.message);
    // Fallback: build a simple text quote
    return products.map(p => {
      let msg = `${p.name}`;
      if (p.price) msg += ` - $${p.price}`;
      if (p.link) msg += `\n${p.link}`;
      return msg;
    }).join('\n\n');
  }
}

/**
 * Handle a retail sales interaction.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context - { products, voice, salesChannel, customerName }
 *   products: array from product_flow [{ productId, name, description, price, link, colors, variants, requestedWidth, requestedLength }]
 *   voice: 'casual' | 'professional' | 'technical'
 *   salesChannel: 'mercado_libre' | 'direct' (default: 'mercado_libre', structure ready for 'amazon', 'walmart', etc.)
 *   customerName: string|null
 * @returns {{ type: string, text?: string, action?: string, products?: Array }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const { products = [], voice = 'casual', salesChannel = 'mercado_libre', customerName = null, colorNote = null, conversationHistory = '' } = context;

  // ── WHOLESALE DETECTION ──
  if (detectWholesale(userMessage)) {
    console.log('🏛️ [retail] Wholesale inquiry detected');
    return { type: 'flow_switch', action: 'wholesale', reason: 'Cliente pregunta por mayoreo' };
  }

  // ── HANDOFF RULES — check each product ──
  for (const product of products) {
    const handoff = checkHandoffRules(product);
    if (handoff) {
      console.log(`🏛️ [retail] Handoff triggered: ${handoff.reason}`);
      return await executeHandoff(psid, convo, userMessage, {
        reason: handoff.reason,
        responsePrefix: 'Para esa medida te comunico con un especialista que te puede ayudar mejor.',
        lastIntent: 'retail_handoff',
        timingStyle: 'elaborate'
      });
    }
  }

  // ── PRODUCT NOT FOUND — handoff ──
  if (products.length === 0) {
    console.log('🏛️ [retail] No products available — handoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: 'Producto no disponible en catálogo',
      responsePrefix: 'Ese producto no lo tenemos en línea, pero te comunico con un especialista para ver cómo te podemos ayudar.',
      lastIntent: 'retail_handoff_no_product',
      timingStyle: 'elaborate'
    });
  }

  // ── QUOTE — build AI-generated message ──
  const quoteText = await buildQuoteMessage(products, { voice, customerName, salesChannel, colorNote, conversationHistory });

  await updateConversation(psid, {
    lastIntent: 'retail_quote',
    lastSharedProductLink: products.some(p => p.link) ? true : undefined,
    unknownCount: 0
  });

  console.log(`🏛️ [retail] Quote generated for ${products.length} product(s)`);
  return { type: 'text', text: quoteText, products };
}

module.exports = {
  handle,
  checkHandoffRules,
  detectWholesale,
  buildQuoteMessage,
  HANDOFF_RULES
};
