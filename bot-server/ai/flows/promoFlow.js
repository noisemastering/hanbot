// ai/flows/promoFlow.js
// Model flow — handles special offers/promotions.
// Presents promo products right away, can override prices, has timeframes and T&C.
// Switches off if client is not interested, letting the convo_flow continue normally.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Default terms and conditions — used when no custom T&C is set.
 */
const DEFAULT_TERMS = `Términos y condiciones de la promoción:
- Precios y disponibilidad sujetos a cambio sin previo aviso
- Válida hasta agotar existencias
- No acumulable con otras promociones
- Aplica únicamente para los productos incluidos en la promoción
- Envío no incluido en el precio promocional (salvo que el canal de venta lo incluya)`;

/**
 * Check if the promo is still active based on timeframe.
 * @param {Object} timeframe - { startDate, endDate } or null
 * @returns {{ active: boolean, expiryText: string }}
 */
function checkTimeframe(timeframe) {
  if (!timeframe || (!timeframe.startDate && !timeframe.endDate)) {
    return { active: true, expiryText: 'Hasta agotar existencias' };
  }

  const now = new Date();

  if (timeframe.startDate && now < new Date(timeframe.startDate)) {
    return { active: false, expiryText: `Inicia el ${new Date(timeframe.startDate).toLocaleDateString('es-MX')}` };
  }

  if (timeframe.endDate && now > new Date(timeframe.endDate)) {
    return { active: false, expiryText: 'Esta promoción ya no está vigente' };
  }

  const endText = timeframe.endDate
    ? `Válida hasta el ${new Date(timeframe.endDate).toLocaleDateString('es-MX')}`
    : 'Hasta agotar existencias';

  return { active: true, expiryText: endText };
}

/**
 * Apply promo prices to products. Overrides product_flow prices when set.
 * @param {Array} products - Products from product_flow
 * @param {Array} promoPrices - [{ productId, price }] — promo-specific prices
 * @returns {Array} Products with promo prices applied
 */
function applyPromoPrices(products, promoPrices = []) {
  if (!promoPrices.length) return products;

  const priceMap = new Map(promoPrices.map(p => [String(p.productId), p.price]));

  return products.map(product => {
    const promoPrice = priceMap.get(String(product.productId));
    if (promoPrice != null) {
      return {
        ...product,
        originalPrice: product.price,
        price: promoPrice,
        isPromoPrice: true
      };
    }
    return product;
  });
}

/**
 * AI-driven: classify if the client is interested, asking about terms, or not interested.
 * @param {string} userMessage
 * @param {Object} options - { conversationHistory }
 * @returns {Promise<'interested'|'not_interested'|'terms_request'>}
 */
async function classifyPromoIntent(userMessage, options = {}) {
  if (!userMessage) return 'interested';
  const { conversationHistory = '' } = options;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `El cliente ya vio una promoción de malla sombra. Clasifica su respuesta. Responde con JSON: { "intent": "<interested|not_interested|terms_request>" }

- "not_interested": El cliente rechaza la promo, pide otra cosa, o dice que no le interesa.
- "terms_request": El cliente pregunta por términos, condiciones, restricciones, o vigencia de la promo.
- "interested": Cualquier otra cosa (pregunta, quiere comprar, pide más info, etc.)`
        },
        { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return parsed.intent || 'interested';
  } catch (err) {
    console.error('❌ [promo] Intent classification error:', err.message);
    return 'interested';
  }
}

/**
 * Build the promo presentation message using AI.
 * @param {Array} products - Products with promo prices applied
 * @param {Object} options - { voice, customerName, expiryText, terms, salesChannel }
 * @returns {Promise<string>}
 */
async function buildPromoPitch(products, options = {}) {
  const {
    voice = 'casual',
    customerName = null,
    expiryText = 'Hasta agotar existencias',
    terms = null,
    salesChannel = 'mercado_libre',
    colorNote = null,
    conversationHistory = ''
  } = options;

  const voiceInstructions = {
    casual: 'Habla de manera directa y amigable, como un vendedor real por chat. Usa "tú". Sin exageraciones ni frases de infomercial.',
    professional: 'Habla de manera profesional pero cálida. Sin exageraciones.',
    technical: 'Sé preciso con las especificaciones del producto. Sin adornos.'
  };

  const channelNote = salesChannel === 'mercado_libre'
    ? 'La compra se realiza por Mercado Libre. El envío está incluido y tiene compra protegida.'
    : 'La compra es directa con nosotros.';

  const productList = products.map((p, i) => {
    let entry = `Producto ${i + 1}: ${p.name}`;
    if (p.description) entry += `\nDescripción: ${p.description}`;
    if (p.isPromoPrice && p.originalPrice) {
      entry += `\nPrecio regular: $${p.originalPrice}`;
      entry += `\nPrecio promocional: $${p.price}`;
    } else if (p.price) {
      entry += `\nPrecio: $${p.price}`;
    }
    if (p.link) entry += `\nLink de compra: ${p.link}`;
    if (p.colors?.length) entry += `\nColores: ${p.colors.join(', ')}`;
    return entry;
  }).join('\n\n');

  const systemPrompt = `Eres vendedora de Hanlob, fabricante mexicano de malla sombra. Escríbele al cliente por chat.
${voiceInstructions[voice] || voiceInstructions.casual}

Presenta el producto con su precio y link de compra. Sé breve y directa.
- ${channelNote}
${customerName ? `- El cliente se llama ${customerName}` : ''}
${colorNote ? `- ${colorNote}` : ''}

FORMATO:
- Máximo 3-4 oraciones — ve al grano
- Incluye siempre el precio y el link de compra
- Si hay precio promocional, menciónalo de forma natural
- Escribe las URLs como texto plano (ejemplo: https://ejemplo.com)
- El envío ya está incluido — ve directo al precio y link
- Usa máximo 1 emoji, solo si es natural
- Tono tranquilo y directo, como vendedora real por chat
- Solo devuelve el mensaje, nada más`;

  const userPrompt = `PRODUCTOS EN PROMOCIÓN:
${productList}
${conversationHistory ? `\n${conversationHistory}` : ''}
Presenta la promoción.`;

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
    console.error('❌ [promo] AI pitch error:', err.message);
    // Fallback
    return products.map(p => {
      let msg = `${p.name}`;
      if (p.price) msg += ` — $${p.price}`;
      if (p.link) msg += `\n${p.link}`;
      return msg;
    }).join('\n\n');
  }
}

/**
 * Handle a promo interaction.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context
 *   products: array from product_flow
 *   voice: 'casual' | 'professional' | 'technical'
 *   salesChannel: 'mercado_libre' | 'direct'
 *   customerName: string|null
 *   promoPrices: [{ productId, price }] — override prices (optional)
 *   timeframe: { startDate, endDate } — promo dates (optional, null = hasta agotar existencias)
 *   terms: string|null — custom T&C (null = use default)
 *   pitchSent: boolean — whether the promo has been presented already
 * @returns {{ type: string, text?: string, pitchSent?: boolean, products?: Array }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const {
    products = [],
    voice = 'casual',
    salesChannel = 'mercado_libre',
    customerName = null,
    promoPrices = [],
    timeframe = null,
    terms = null,
    colorNote = null,
    pitchSent = false,
    conversationHistory = ''
  } = context;

  // ── CHECK TIMEFRAME ──
  const { active, expiryText } = checkTimeframe(timeframe);
  if (!active) {
    console.log(`🏛️ [promo] Promo not active: ${expiryText}`);
    return null; // Promo expired/not started — let convo_flow continue normally
  }

  // ── CLASSIFY INTENT (AI — not interested / terms / interested) ──
  if (pitchSent) {
    const promoIntent = await classifyPromoIntent(userMessage, { conversationHistory });

    if (promoIntent === 'not_interested') {
      console.log('🏛️ [promo] Client not interested (AI) — switching off');
      return null;
    }

    if (promoIntent === 'terms_request') {
      const activeTerms = terms || DEFAULT_TERMS;
      const termsWithExpiry = activeTerms.replace(
        'Válida hasta agotar existencias',
        expiryText
      );
      console.log('🏛️ [promo] Terms requested (AI)');
      return { type: 'text', text: termsWithExpiry };
    }
  }

  // ── PRESENT PROMO (first interaction) ──
  if (!pitchSent && products.length > 0) {
    const pricedProducts = applyPromoPrices(products, promoPrices);
    const pitchText = await buildPromoPitch(pricedProducts, {
      voice, customerName, expiryText, terms, salesChannel, colorNote, conversationHistory
    });

    if (pitchText) {
      await updateConversation(psid, {
        lastIntent: 'promo_pitch_sent',
        unknownCount: 0
      });

      console.log(`🏛️ [promo] Pitch delivered (${pricedProducts.length} product(s))`);
      return { type: 'text', text: pitchText, pitchSent: true, products: pricedProducts };
    }
  }

  // ── PROMO ALREADY PRESENTED — let convo_flow handle the rest ──
  return null;
}

module.exports = {
  handle,
  checkTimeframe,
  applyPromoPrices,
  classifyPromoIntent,
  buildPromoPitch,
  DEFAULT_TERMS
};
