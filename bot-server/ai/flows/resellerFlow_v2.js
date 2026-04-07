// ai/flows/resellerFlow_v2.js
// TODO: Rename to resellerFlow.js once the current resellerFlow.js is retired.
// Model flow — handles the reseller sales process.
// For people looking to resell products. Treats the person as someone looking to make business.
// Handles: investment pitch, catalog, data gathering, handoff to human, buyer detection.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
// getCatalogUrl required lazily inside handler to avoid circular dependency with flowManager
const { sendCatalog } = require("../../utils/sendCatalog");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Fields to gather from the reseller.
 */
const CLIENT_FIELDS = [
  { key: 'name',     label: 'Nombre',              required: true },
  { key: 'zipCode',  label: 'Código postal',       required: true },
  { key: 'phone',    label: 'Teléfono',            required: true },
  { key: 'email',    label: 'Correo electrónico',  required: false },
  { key: 'products', label: 'Productos',           required: true },
  { key: 'quantity', label: 'Cantidades',           required: true }
];

/**
 * AI-driven intent classification for the reseller flow.
 * Detects: buyer (end-customer, not reseller), catalog interest, or reseller continuing.
 * @param {string} userMessage
 * @param {Object} options - { conversationHistory }
 * @returns {Promise<{ intent: 'buyer'|'catalog_interest'|'reseller' }>}
 */
async function classifyResellerIntent(userMessage, options = {}) {
  if (!userMessage) return { intent: 'reseller' };
  const { conversationHistory = '' } = options;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Clasifica el mensaje del cliente en el contexto de un flujo de REVENDEDORES de malla sombra. Responde solo con JSON: { "intent": "<buyer|catalog_interest|reseller>" }

- "buyer": El cliente es comprador final, NO revendedor. Señales: pide una medida específica para uso propio, menciona su casa/patio/cochera/terraza, quiere solo una pieza, da medidas personales, o dice "comprar"/"solo comprar"/"nada más comprar" (en respuesta a si quiere ser distribuidor o solo comprar). Alguien que dice "busco una de 3x4" o "necesito para mi cochera" es comprador final.
- "catalog_interest": El cliente quiere ver el catálogo, productos, medidas, precios, o muestra interés/aceptación (sí, ok, dale, mándame, me interesa, etc.)
- "reseller": El cliente habla como revendedor — pregunta por mayoreo, cantidades, márgenes, programa de distribución, o da datos de negocio.

En caso de duda entre buyer y reseller, elige buyer — es más común que un comprador final llegue por anuncios.${conversationHistory}`
        },
        { role: 'user', content: userMessage }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('❌ [reseller] Intent classification error:', err.message);
    return { intent: 'reseller' };
  }
}

/**
 * Extract client data from a message using AI.
 * @param {string} userMessage
 * @param {Object} existingData - Already collected fields
 * @param {Object} options - { voice }
 * @returns {Promise<{ extracted: Object, nextQuestion: string|null, allCollected: boolean }>}
 */
async function extractClientData(userMessage, existingData = {}, options = {}) {
  const { voice = 'professional', conversationHistory = '' } = options;

  const voiceInstructions = {
    casual: 'Habla de manera amigable y relajada. Usa "tú".',
    professional: 'Habla de manera profesional pero cálida. Usa "usted" cuando sea apropiado.',
    technical: 'Sé preciso y directo.'
  };

  const collectedSummary = Object.entries(existingData)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n') || 'Ninguno aún';

  const missingFields = CLIENT_FIELDS
    .filter(f => f.required && !existingData[f.key])
    .map(f => f.label);

  const systemPrompt = `Eres asesora de ventas de Hanlob (programa de revendedores).
${voiceInstructions[voice] || voiceInstructions.professional}

Extrae datos del cliente de su mensaje y pide los que falten.
Trata al cliente como alguien que busca hacer negocio — es un revendedor potencial.

Responde con JSON:
{
  "extracted": {
    "name": "<nombre si lo mencionó o null>",
    "zipCode": "<código postal si lo mencionó o null>",
    "phone": "<teléfono si lo mencionó o null>",
    "email": "<email si lo mencionó o null>",
    "products": "<productos que le interesan o null>",
    "quantity": "<cantidades si las mencionó o null>"
  },
  "nextQuestion": "<mensaje natural pidiendo TODOS los datos faltantes, un dato por línea, o null si ya tenemos todo>",
  "allCollected": <true si ya tenemos todos los obligatorios, false si no>
}

FORMATO:
- Solo extrae datos que el cliente CLARAMENTE proporcionó
- Pide todos los datos faltantes en un solo mensaje, un dato por línea
- Si ya tienes todos los obligatorios, pon allCollected: true
- Solo devuelve JSON`;

  const userPrompt = `DATOS YA RECOLECTADOS:
${collectedSummary}

DATOS QUE FALTAN (obligatorios):
${missingFields.length > 0 ? missingFields.join(', ') : 'Todos recolectados'}
${conversationHistory ? `\n${conversationHistory}` : ''}
Mensaje del cliente: ${userMessage}`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('❌ [reseller] AI extraction error:', err.message);
    return { extracted: {}, nextQuestion: null, allCollected: false };
  }
}

/**
 * Build a reseller pitch — stresses investment value, margins, business opportunity.
 * @param {Array} products - Products from product_flow
 * @param {Object} options - { voice, customerName, allowListing, offersCatalog }
 * @returns {Promise<string>}
 */
async function buildResellerPitch(products, options = {}) {
  const { voice = 'professional', customerName = null, allowListing = false, offersCatalog = false, conversationHistory = '' } = options;

  const voiceInstructions = {
    casual: 'Habla de manera amigable y relajada. Usa "tú".',
    professional: 'Habla de manera profesional pero cálida.',
    technical: 'Sé preciso con las especificaciones.'
  };

  const productList = products.map((p, i) => {
    let entry = `${i + 1}. ${p.name}`;
    if (p.description) entry += ` — ${p.description}`;
    if (p.price) entry += ` (Precio mayoreo: $${p.price})`;
    return entry;
  }).join('\n');

  const catalogNote = offersCatalog ? '\n- Menciona que tenemos un catálogo disponible si quiere verlo.' : '';
  const listingNote = allowListing ? '' : '\n- Si hay más de 3 productos, muestra un rango "desde X hasta Y" en lugar de listar todos.';

  const systemPrompt = `Eres asesora de ventas de Hanlob (programa de revendedores).
${voiceInstructions[voice] || voiceInstructions.professional}

Presenta brevemente la oportunidad de negocio. Somos FABRICANTES de malla sombra — mejores precios para el revendedor.
${customerName ? `El cliente se llama ${customerName}.` : ''}

FORMATO:
- Máximo 2-3 oraciones — ve al grano
- Usa solo datos reales, tono directo y profesional
- Ofrece enviar el catálogo con medidas y precios
- Solo devuelve el mensaje, nada más`;

  const userPrompt = `${conversationHistory ? `${conversationHistory}\n\n` : ''}Presenta la oportunidad de negocio.`;

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
    console.error('❌ [reseller] AI pitch error:', err.message);
    return null;
  }
}

/**
 * Handle a reseller sales interaction.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context
 *   products: array from product_flow
 *   voice: 'casual' | 'professional' | 'technical'
 *   customerName: string|null
 *   clientData: { name, zipCode, phone, email, products, quantity } — already collected fields
 *   allowListing: boolean — whether to list products
 *   offersCatalog: boolean — whether to offer a catalog
 *   pitchSent: boolean — whether the reseller pitch has been delivered
 * @returns {{ type: string, text?: string, action?: string, clientData?: Object, pitchSent?: boolean }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const {
    products = [],
    voice = 'professional',
    customerName = null,
    clientData = {},
    allowListing = false,
    offersCatalog = false,
    pitchSent = false,
    catalogSent = false,
    conversationHistory = ''
  } = context;

  // ── AI INTENT CLASSIFICATION (buyer vs catalog interest vs reseller) ──
  const { intent } = await classifyResellerIntent(userMessage, { conversationHistory });

  if (intent === 'buyer') {
    console.log('🏛️ [reseller] End-buyer intent detected (AI)');
    return { type: 'flow_switch', action: 'buyer', reason: 'Cliente es comprador final, no revendedor' };
  }

  // ── RESELLER PITCH (first interaction) ──
  if (!pitchSent && products.length > 0) {
    const pitchText = await buildResellerPitch(products, { voice, customerName, allowListing, offersCatalog, conversationHistory });
    if (pitchText) {
      console.log(`🏛️ [reseller] Pitch delivered (${products.length} products)`);
      await updateConversation(psid, {
        lastIntent: 'reseller_pitch_sent',
        unknownCount: 0
      });
      return { type: 'text', text: pitchText, pitchSent: true };
    }
  }

  // ── CATALOG DELIVERY (when user shows interest — never gated behind data) ──
  if (pitchSent && !catalogSent && intent === 'catalog_interest') {
    console.log('🏛️ [reseller] Catalog interest detected — sending catalog');

    // Try to send the PDF catalog (lazy require to break circular dep)
    const { getCatalogUrl } = require("../flowManager");
    const catalogUrl = await getCatalogUrl(convo, convo?.currentFlow);
    if (catalogUrl) {
      const rawPsid = psid.startsWith('fb:') ? psid.replace('fb:', '') : psid;
      const result = await sendCatalog(rawPsid, catalogUrl);
      if (result?.fileSent) {
        console.log(`📄 [reseller] Catalog PDF sent`);
        await updateConversation(psid, {
          lastIntent: 'reseller_catalog_sent',
          unknownCount: 0
        });
        return {
          type: 'text',
          text: 'Ahí te va el catálogo con medidas y precios. Cuando veas algo que te interese, dime y platicamos cantidades y precios de revendedor.',
          catalogSent: true
        };
      }
    }

    // No PDF available — build a text product listing as fallback
    const productList = products.length > 3
      ? `Manejamos ${products.length} medidas, desde ${products[0]?.name} hasta ${products[products.length - 1]?.name}.`
      : products.map(p => `- ${p.name}${p.price ? ` — $${p.price}` : ''}`).join('\n');

    await updateConversation(psid, {
      lastIntent: 'reseller_catalog_sent',
      unknownCount: 0
    });
    return {
      type: 'text',
      text: `${productList}\n\nDime qué medidas y cantidades te interesan y te paso los precios de revendedor.`,
      catalogSent: true
    };
  }

  // ── DATA GATHERING (after catalog has been sent) ──
  const extraction = await extractClientData(userMessage, clientData, { voice, conversationHistory });

  const updatedData = { ...clientData };
  if (extraction.extracted) {
    for (const [key, value] of Object.entries(extraction.extracted)) {
      if (value && !updatedData[key]) {
        updatedData[key] = value;
      }
    }
  }

  await updateConversation(psid, {
    lastIntent: 'reseller_data_gathering',
    unknownCount: 0
  });

  // ── ALL DATA COLLECTED — handoff to human ──
  if (extraction.allCollected) {
    console.log('🏛️ [reseller] All client data collected — handoff');
    const summary = CLIENT_FIELDS
      .filter(f => updatedData[f.key])
      .map(f => `${f.label}: ${updatedData[f.key]}`)
      .join('\n');

    return await executeHandoff(psid, convo, userMessage, {
      reason: `Revendedor interesado — datos recolectados:\n${summary}`,
      responsePrefix: 'Excelente, ya tengo tus datos. Te comunico con un especialista para darte los mejores precios de revendedor.',
      lastIntent: 'reseller_handoff',
      timingStyle: 'elaborate'
    });
  }

  // ── ASK FOR MISSING DATA ──
  if (extraction.nextQuestion) {
    console.log('🏛️ [reseller] Asking for client data');
    return { type: 'text', text: extraction.nextQuestion, clientData: updatedData };
  }

  return null;
}

module.exports = {
  handle,
  extractClientData,
  classifyResellerIntent,
  buildResellerPitch,
  CLIENT_FIELDS
};
