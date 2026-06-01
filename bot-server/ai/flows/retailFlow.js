// ai/flows/retailFlow.js
// Model flow — handles the retail sales process.
// Does NOT handle products (that's product_flow's job).
// Handles: quoting, purchase links, descriptions, handoff rules, wholesale detection.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { getPrompt } = require("../utils/promptLoader");

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
      const name = (product.name || '').toLowerCase();
      const family = (product.familyName || '').toLowerCase();
      const isConfeccionada = name.includes('confeccionada') || family.includes('confeccionada');
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
 * AI-driven: detect if the customer is asking for wholesale.
 * @param {string} userMessage
 * @param {Object} options - { conversationHistory }
 * @returns {Promise<boolean>}
 */
async function detectWholesale(userMessage, options = {}) {
  if (!userMessage) return false;
  const { conversationHistory = '' } = options;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: await getPrompt('retailFlow', 'detectWholesale', `¿El cliente está preguntando por compra al mayoreo, distribución, reventa, o grandes cantidades? Responde con JSON: { "isWholesale": true/false }`) },
        { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return parsed.isWholesale === true;
  } catch (err) {
    console.error('❌ [retail] Wholesale detection error:', err.message);
    return false;
  }
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
    if (p.attributes && Object.keys(p.attributes).length > 0) {
      const attrs = Object.entries(p.attributes instanceof Map ? Object.fromEntries(p.attributes) : p.attributes)
        .map(([k, v]) => `${k}: ${v}`).join(', ');
      entry += `\nEspecificaciones: ${attrs}`;
    }
    if (p.hasDiscount && p.originalPrice) {
      entry += `\nPrecio regular: $${p.originalPrice}`;
      entry += `\nPrecio con descuento: $${p.price} (${p.discountPercent}% OFF)`;
    } else if (p.price) {
      entry += `\nPrecio: $${p.price}`;
    }
    if (p.link) entry += `\nLink de compra: ${p.link}`;
    if (p.colors?.length) entry += `\nColores: ${p.colors.join(', ')}`;
    return entry;
  }).join('\n\n');

  const multiProduct = products.length > 1;

  const systemPrompt = `Eres asesora de ventas de Hanlob.
${voiceInstructions[voice] || voiceInstructions.casual}

${multiProduct
  ? `El cliente NO especificó una medida — presenta el rango disponible y pregunta cuál le interesa. NO cotices cada producto por separado, da un rango "desde $X (medida más chica) hasta $Y (medida más grande)" y pide que indique cuál quiere.`
  : `Genera un mensaje de cotización natural, como si lo escribiera una persona.`}
- ${channelNote}
${customerName ? `- El cliente se llama ${customerName}` : ''}
${colorNote ? `- ${colorNote}` : ''}

FORMATO:
- Si el mensaje del cliente contiene una pregunta, respóndela naturalmente al inicio antes de dar la cotización
- ${multiProduct ? 'Máximo 3-4 oraciones en total. NO incluyas links cuando hay rango — espera a que el cliente elija la medida.' : 'Máximo 2-4 oraciones por producto. Incluye siempre el precio y el link de compra.'}
- Escribe las URLs como texto plano (ejemplo: https://ejemplo.com)
- El envío ya está incluido — ve directo al precio
- Usa SOLO el precio listado en PRODUCTOS. Si el historial menciona OTRO precio (por ejemplo un precio promocional de otra medida), ese precio NO APLICA aquí — corresponde a un producto distinto.
- Usa SOLO el link listado en PRODUCTOS. NUNCA reutilices links de mensajes anteriores.
- Si en el historial se mencionó un precio promocional, esa promoción es ESPECÍFICA de la medida promocional y no aplica a otras medidas.
- Solo menciona los productos proporcionados
- NUNCA te disculpes ni digas "lamento la confusión" o "disculpa" — no hay nada de qué disculparse
- **NO HUMORES AL CLIENTE — CORRÍGELO**: Si el cliente afirma algo INCORRECTO sobre el producto (porcentaje de sombra que no manejamos, medidas que no tenemos, color que no existe, fabricación que no hacemos, etc.), CORRIGE amablemente. NUNCA confirmes datos falsos. Porcentajes que manejamos: 90% (confeccionada) y 35%/50%/70%/80% (rollos). Si dice "cubre 99%" o "75%" o cualquier otro porcentaje que no tenemos, corrige diciendo qué porcentajes SÍ tenemos.
- **CANTIDAD**: Si el cliente quiere VARIAS unidades del MISMO producto (ej: "necesito dos", "quiero 3", "cuatro mallas"), NO repitas el producto N veces. Cotiza UNA vez y aclara: "Puedes pedir varias en el mismo enlace — en Mercado Libre seleccionas la cantidad antes de pagar." Si quiere MEDIDAS DIFERENTES, pide que las especifique.
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

    let aiText = response.choices[0].message.content.trim();

    // Price/link sanity check — verify the AI didn't hallucinate a wrong price or link
    const validPrices = products.map(p => Math.round(p.price)).filter(Boolean);
    const validLinks = products.map(p => p.link).filter(Boolean);

    // Find $XXX patterns in the response
    const pricesInText = [...aiText.matchAll(/\$\s?(\d{2,5}(?:[.,]\d{1,2})?)/g)].map(m => Math.round(parseFloat(m[1].replace(',', '.'))));
    const linksInText = [...aiText.matchAll(/https?:\/\/[^\s]+/g)].map(m => m[0]);

    // Check for prices that don't match any valid product price (allow ±$1 tolerance)
    const badPrice = pricesInText.find(p => !validPrices.some(vp => Math.abs(vp - p) <= 1));
    if (badPrice && validPrices.length > 0) {
      console.warn(`⚠️ [retail] AI quoted invalid price $${badPrice}. Valid: ${validPrices.join(', ')}. Regenerating with strict prompt.`);
      // Force a deterministic fallback
      return products.map(p => {
        let msg = `${p.name} - $${p.price}`;
        if (p.link) msg += `\n${p.link}`;
        return msg;
      }).join('\n\n');
    }

    // Check for links that aren't in the current product list
    const badLink = linksInText.find(l => !validLinks.includes(l) && !l.includes('hanlob.com.mx/r/'));
    // The /r/ links are tracked, so just verify the exact match
    const wrongTrackedLink = linksInText.find(l => l.includes('/r/') && !validLinks.includes(l));
    if (wrongTrackedLink) {
      console.warn(`⚠️ [retail] AI used wrong tracked link ${wrongTrackedLink}. Valid: ${validLinks.join(', ')}.`);
      // Replace with the correct link
      aiText = aiText.replace(wrongTrackedLink, validLinks[0] || '');
    }

    return aiText;
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

  // ── WHOLESALE DETECTION (AI) ──
  if (await detectWholesale(userMessage, { conversationHistory })) {
    console.log('🏛️ [retail] Wholesale inquiry detected');
    return { type: 'flow_switch', action: 'wholesale', reason: 'Cliente pregunta por mayoreo' };
  }

  // ── ML-PRICE REQUIREMENT ──
  // Policy: only quote prices fetched in real time from Mercado Libre.
  // priceSource MUST be 'ml'. Anything else (including undefined → product
  // wasn't enriched at all) means we don't trust the price → handoff or drop.
  const productsWithMLPrice = products.filter(p => p.priceSource === 'ml');
  if (products.length > 0 && productsWithMLPrice.length === 0) {
    console.log(`🏛️ [retail] No products have live ML price (sources: ${products.map(p => p.priceSource || 'undefined').join(',')}) — handoff`);
    return await executeHandoff(psid, convo, userMessage, {
      reason: 'ML price unavailable — cannot quote',
      responsePrefix: 'Déjame confirmarte el precio actualizado con un especialista, es solo un momento.',
      lastIntent: 'retail_handoff_no_ml_price',
      timingStyle: 'standard'
    });
  }
  // Drop any product without live ML price — never quote DB-sourced numbers
  const quotableProducts = productsWithMLPrice;

  // ── HANDOFF RULES — check each product ──
  for (const product of quotableProducts) {
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
  if (quotableProducts.length === 0) {
    console.log('🏛️ [retail] No products available — handoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: 'Producto no disponible en catálogo',
      responsePrefix: 'Ese producto no lo tenemos en línea, pero te comunico con un especialista para ver cómo te podemos ayudar.',
      lastIntent: 'retail_handoff_no_product',
      timingStyle: 'elaborate'
    });
  }

  // ── QUOTE — build AI-generated message ──
  const quoteText = await buildQuoteMessage(quotableProducts, { voice, customerName, salesChannel, colorNote, conversationHistory });

  // Only store lastSharedProductLink for single-product quotes where we actually
  // shared a specific tracked link. For multi-product range presentations, don't
  // store anything — the customer hasn't picked a size yet and the follow-up job
  // would re-share a random product's raw URL.
  const singleProductLink = quotableProducts.length === 1 ? quotableProducts[0]?.link : null;
  await updateConversation(psid, {
    lastIntent: 'retail_quote',
    ...(singleProductLink ? { lastSharedProductLink: singleProductLink } : {}),
    unknownCount: 0
  });

  console.log(`🏛️ [retail] Quote generated for ${quotableProducts.length} product(s) (ML-sourced)`);
  return { type: 'text', text: quoteText, products: quotableProducts };
}

module.exports = {
  handle,
  checkHandoffRules,
  detectWholesale,
  buildQuoteMessage,
  HANDOFF_RULES
};
