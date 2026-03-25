// ai/flows/wholesaleFlow.js
// Model flow — handles the wholesale sales process.
// Does NOT handle products (that's product_flow's job).
// Handles: data gathering (name, zip, phone, email, product, quantity),
//          catalog presentation, retail detection, handoff to human.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Fields to gather from the client.
 * 'required' fields must be collected before handoff.
 * 'optional' fields are collected if the client provides them.
 */
const CLIENT_FIELDS = [
  { key: 'name',     label: 'Nombre',           required: true },
  { key: 'zipCode',  label: 'Código postal',    required: true },
  { key: 'phone',    label: 'Teléfono',         required: true },
  { key: 'email',    label: 'Correo electrónico', required: false },
  { key: 'product',  label: 'Producto',         required: true },
  { key: 'quantity', label: 'Cantidad',         required: true }
];

/**
 * AI-driven: detect if the customer is asking for retail (not wholesale).
 * @param {string} userMessage
 * @param {Object} options - { conversationHistory }
 * @returns {Promise<boolean>}
 */
async function detectRetail(userMessage, options = {}) {
  if (!userMessage) return false;
  const { conversationHistory = '' } = options;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `¿El cliente es comprador final (uso personal, una sola pieza, para su casa/patio/cochera)? Responde con JSON: { "isRetail": true/false }` },
        { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return parsed.isRetail === true;
  } catch (err) {
    console.error('❌ [wholesale] Retail detection error:', err.message);
    return false;
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

  const systemPrompt = `Eres asesora de ventas de Hanlob (venta al por mayor).
${voiceInstructions[voice] || voiceInstructions.professional}

Extrae datos del cliente de su mensaje y pide los que falten.

Responde con JSON:
{
  "extracted": {
    "name": "<nombre si lo mencionó o null>",
    "zipCode": "<código postal si lo mencionó o null>",
    "phone": "<teléfono si lo mencionó o null>",
    "email": "<email si lo mencionó o null>",
    "product": "<producto si lo mencionó o null>",
    "quantity": "<cantidad si la mencionó o null>"
  },
  "nextQuestion": "<pregunta natural pidiendo TODOS los datos faltantes, un dato por línea, o null si ya tenemos todo>",
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
    console.error('❌ [wholesale] AI extraction error:', err.message);
    return { extracted: {}, nextQuestion: null, allCollected: false };
  }
}

/**
 * Build a catalog presentation message using AI.
 * @param {Array} products - Products from product_flow
 * @param {Object} options - { voice, customerName, allowListing, offersCatalog }
 * @returns {Promise<string>}
 */
async function buildCatalogMessage(products, options = {}) {
  const { voice = 'professional', customerName = null, allowListing = false, offersCatalog = false, conversationHistory = '' } = options;

  if ((!allowListing && !offersCatalog) || !products.length) return null;

  const voiceInstructions = {
    casual: 'Habla de manera amigable y relajada. Usa "tú".',
    professional: 'Habla de manera profesional pero cálida.',
    technical: 'Sé preciso con las especificaciones.'
  };

  const productList = products.map((p, i) => {
    let entry = `${i + 1}. ${p.name}`;
    if (p.description) entry += ` — ${p.description}`;
    if (p.price) entry += ` ($${p.price})`;
    return entry;
  }).join('\n');

  const systemPrompt = `Eres asesora de ventas de Hanlob (venta al por mayor).
${voiceInstructions[voice] || voiceInstructions.professional}

Presenta el catálogo de productos disponibles al cliente de forma natural y clara.
${customerName ? `El cliente se llama ${customerName}.` : ''}

FORMATO:
- Si hay más de 3 productos, muestra un rango "desde X hasta Y" en lugar de listar todos
- Invita al cliente a indicar cuál le interesa
- Solo devuelve el mensaje, nada más`;

  const userPrompt = `PRODUCTOS:
${productList}
${conversationHistory ? `\n${conversationHistory}` : ''}
Presenta el catálogo.`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 400
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('❌ [wholesale] AI catalog error:', err.message);
    return null;
  }
}

/**
 * Handle a wholesale sales interaction.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context - { products, voice, salesChannel, customerName, clientData, hasCatalog }
 *   products: array from product_flow
 *   voice: 'casual' | 'professional' | 'technical'
 *   salesChannel: 'direct' (wholesale is always direct)
 *   customerName: string|null
 *   clientData: { name, zipCode, phone, email, product, quantity } — already collected fields
 *   allowListing: boolean — whether to list products
 *   offersCatalog: boolean — whether to offer a downloadable/viewable catalog
 * @returns {{ type: string, text?: string, action?: string, clientData?: Object }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const {
    products = [],
    voice = 'professional',
    customerName = null,
    clientData = {},
    allowListing = false,
    offersCatalog = false,
    conversationHistory = ''
  } = context;

  // ── RETAIL DETECTION (AI) ──
  if (await detectRetail(userMessage, { conversationHistory })) {
    console.log('🏛️ [wholesale] Retail inquiry detected');
    return { type: 'flow_switch', action: 'retail', reason: 'Cliente pregunta por menudeo' };
  }

  // ── CATALOG PRESENTATION (if applicable and not yet shown) ──
  if ((allowListing || offersCatalog) && products.length > 0 && !clientData.product) {
    const catalogText = await buildCatalogMessage(products, { voice, customerName, allowListing, offersCatalog, conversationHistory });
    if (catalogText) {
      console.log(`🏛️ [wholesale] Catalog presented (${products.length} products)`);
      return { type: 'text', text: catalogText };
    }
  }

  // ── DATA GATHERING ──
  const extraction = await extractClientData(userMessage, clientData, { voice, conversationHistory });

  // Merge extracted data with existing
  const updatedData = { ...clientData };
  if (extraction.extracted) {
    for (const [key, value] of Object.entries(extraction.extracted)) {
      if (value && !updatedData[key]) {
        updatedData[key] = value;
      }
    }
  }

  await updateConversation(psid, {
    lastIntent: 'wholesale_data_gathering',
    unknownCount: 0
  });

  // ── ALL DATA COLLECTED — handoff to human ──
  if (extraction.allCollected) {
    console.log('🏛️ [wholesale] All client data collected — handoff');
    const summary = CLIENT_FIELDS
      .filter(f => updatedData[f.key])
      .map(f => `${f.label}: ${updatedData[f.key]}`)
      .join('\n');

    return await executeHandoff(psid, convo, userMessage, {
      reason: `Venta mayoreo — datos recolectados:\n${summary}`,
      responsePrefix: 'Perfecto, ya tengo todos tus datos. Te comunico con un especialista para finalizar tu pedido.',
      lastIntent: 'wholesale_handoff',
      timingStyle: 'elaborate'
    });
  }

  // ── ASK FOR NEXT FIELD ──
  if (extraction.nextQuestion) {
    console.log(`🏛️ [wholesale] Asking next field`);
    return { type: 'text', text: extraction.nextQuestion, clientData: updatedData };
  }

  return null;
}

module.exports = {
  handle,
  extractClientData,
  detectRetail,
  buildCatalogMessage,
  CLIENT_FIELDS
};
