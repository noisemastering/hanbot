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
 * Detect if the customer is asking for retail (not wholesale).
 * @param {string} userMessage
 * @returns {boolean}
 */
function detectRetail(userMessage) {
  if (!userMessage) return false;
  const retailPatterns = /\b(menudeo|una\s*sola|solo\s*una|para\s*mi\s*casa|uso\s*personal|particular|individual)\b/i;
  return retailPatterns.test(userMessage);
}

/**
 * Extract client data from a message using AI.
 * @param {string} userMessage
 * @param {Object} existingData - Already collected fields
 * @param {Object} options - { voice }
 * @returns {Promise<{ extracted: Object, nextQuestion: string|null, allCollected: boolean }>}
 */
async function extractClientData(userMessage, existingData = {}, options = {}) {
  const { voice = 'professional' } = options;

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

Tu trabajo es extraer datos del cliente de su mensaje y pedir los que falten.

DATOS YA RECOLECTADOS:
${collectedSummary}

DATOS QUE FALTAN (obligatorios):
${missingFields.length > 0 ? missingFields.join(', ') : 'Todos recolectados'}

Analiza el mensaje del cliente y responde con JSON:
{
  "extracted": {
    "name": "<nombre si lo mencionó o null>",
    "zipCode": "<código postal si lo mencionó o null>",
    "phone": "<teléfono si lo mencionó o null>",
    "email": "<email si lo mencionó o null>",
    "product": "<producto si lo mencionó o null>",
    "quantity": "<cantidad si la mencionó o null>"
  },
  "nextQuestion": "<pregunta natural para el siguiente dato faltante, o null si ya tenemos todo>",
  "allCollected": <true si ya tenemos todos los obligatorios, false si no>
}

REGLAS:
- Solo extrae datos que el cliente CLARAMENTE proporcionó
- NO inventes datos
- Pide TODOS los datos faltantes en un solo mensaje, un dato por línea
- Si ya tienes todos los obligatorios, pon allCollected: true
- Solo devuelve JSON, nada más`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
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
  const { voice = 'professional', customerName = null, allowListing = false, offersCatalog = false } = options;

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

Presenta el catálogo de productos disponibles al cliente. El mensaje debe:
- Sonar natural, como si lo escribiera una persona
- Listar los productos de forma clara
- Si hay más de 3 productos, muestra un rango "desde X hasta Y" en lugar de listar todos
- Invitar al cliente a indicar cuál le interesa
${customerName ? `- El cliente se llama ${customerName}` : ''}

PRODUCTOS:
${productList}

Solo devuelve el mensaje, nada más.`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Presenta el catálogo." }
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
    offersCatalog = false
  } = context;

  // ── RETAIL DETECTION ──
  if (detectRetail(userMessage)) {
    console.log('🏛️ [wholesale] Retail inquiry detected');
    return { type: 'flow_switch', action: 'retail', reason: 'Cliente pregunta por menudeo' };
  }

  // ── CATALOG PRESENTATION (if applicable and not yet shown) ──
  if ((allowListing || offersCatalog) && products.length > 0 && !clientData.product) {
    const catalogText = await buildCatalogMessage(products, { voice, customerName, allowListing, offersCatalog });
    if (catalogText) {
      console.log(`🏛️ [wholesale] Catalog presented (${products.length} products)`);
      return { type: 'text', text: catalogText };
    }
  }

  // ── DATA GATHERING ──
  const extraction = await extractClientData(userMessage, clientData, { voice });

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
