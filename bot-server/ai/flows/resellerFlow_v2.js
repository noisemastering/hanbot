// ai/flows/resellerFlow_v2.js
// TODO: Rename to resellerFlow.js once the current resellerFlow.js is retired.
// Model flow — handles the reseller sales process.
// For people looking to resell products. Treats the person as someone looking to make business.
// Handles: investment pitch, catalog, data gathering, handoff to human, buyer detection.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { getCatalogUrl } = require("../flowManager");
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
 * Detect if the person is actually an end buyer, not a reseller.
 * @param {string} userMessage
 * @returns {boolean}
 */
function detectBuyer(userMessage) {
  if (!userMessage) return false;
  const buyerPatterns = /\b(para\s*mi\s*casa|uso\s*personal|para\s*mi\s*patio|mi\s*cochera|mi\s*terraza|solo\s*una|una\s*sola|particular|no\s*es\s*para\s*vender|no\s*revendo)\b/i;
  return buyerPatterns.test(userMessage);
}

/**
 * Detect if the user wants to see the catalog or is showing interest.
 * @param {string} userMessage
 * @returns {boolean}
 */
function detectCatalogInterest(userMessage) {
  if (!userMessage) return false;
  const patterns = /\b(cat[áa]logo|env[ií]a(me|lo|r)|mand(a|ame)|ver\s*(los\s*)?productos|lista\s*de\s*precios|precios|medidas\s*y\s*precios|s[ií](\s*por\s*favor)?|ok|dale|va|claro|me\s*interesa|xfavor|por\s*favor|adelante)\b/i;
  return patterns.test(userMessage);
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

Tu trabajo es extraer datos del cliente de su mensaje y pedir los que falten.
Trata al cliente como alguien que busca hacer negocio — es un revendedor potencial.

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
    "products": "<productos que le interesan o null>",
    "quantity": "<cantidades si las mencionó o null>"
  },
  "nextQuestion": "<mensaje natural pidiendo TODOS los datos faltantes, un dato por línea, o null si ya tenemos todo>",
  "allCollected": <true si ya tenemos todos los obligatorios, false si no>
}

REGLAS:
- Solo extrae datos que el cliente CLARAMENTE proporcionó
- NO inventes datos
- Pide TODOS los datos faltantes en un solo mensaje, un dato por línea
- Si ya tienes todos los obligatorios, pon allCollected: true
- Solo devuelve JSON, nada más${conversationHistory}`;

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

REGLAS:
- Máximo 2-3 oraciones — ve al grano, nada de párrafos
- NO inventes precios ni márgenes
- NO uses lenguaje de infomercial ni exageres
- Ofrece enviar el catálogo con medidas y precios
- Solo devuelve el mensaje, nada más${conversationHistory}`;

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Presenta la oportunidad de negocio." }
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

  // ── BUYER DETECTION ──
  if (detectBuyer(userMessage)) {
    console.log('🏛️ [reseller] End-buyer intent detected');
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
  if (pitchSent && !catalogSent && detectCatalogInterest(userMessage)) {
    console.log('🏛️ [reseller] Catalog interest detected — sending catalog');

    // Try to send the PDF catalog
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
  detectBuyer,
  buildResellerPitch,
  CLIENT_FIELDS
};
