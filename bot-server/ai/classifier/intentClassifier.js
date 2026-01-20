// ai/classifier/intentClassifier.js
// Layer 1: AI-based Intent Classification
// Single AI call to extract intent, product, and entities

const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * All possible intents the classifier can return
 */
const INTENTS = {
  // Greetings & Social
  GREETING: "greeting",                    // "Hola", "Buenos días"
  THANKS: "thanks",                        // "Gracias", "Muchas gracias"
  GOODBYE: "goodbye",                      // "Adiós", "Hasta luego"

  // Product Queries
  PRICE_QUERY: "price_query",              // "Cuánto cuesta?", "Precio?"
  PRODUCT_INQUIRY: "product_inquiry",      // "Tienen malla sombra?", "Qué productos manejan?"
  AVAILABILITY_QUERY: "availability_query", // "Tienen en stock?", "Hay disponible?"

  // Specifications (user providing info)
  SIZE_SPECIFICATION: "size_specification",         // "4x5", "3 metros por 4"
  PERCENTAGE_SPECIFICATION: "percentage_specification", // "90%", "al 80 por ciento"
  QUANTITY_SPECIFICATION: "quantity_specification",     // "15 rollos", "quiero 10"
  COLOR_SPECIFICATION: "color_specification",           // "negro", "en verde"
  LENGTH_SPECIFICATION: "length_specification",         // "de 18 metros" (for borde)

  // Logistics
  SHIPPING_QUERY: "shipping_query",        // "Hacen envíos?", "Cuánto tarda?"
  LOCATION_QUERY: "location_query",        // "Dónde están?", "Tienen tienda física?"
  PAYMENT_QUERY: "payment_query",          // "Cómo pago?", "Aceptan tarjeta?"
  DELIVERY_TIME_QUERY: "delivery_time_query", // "Cuándo llega?", "Tiempo de entrega?"

  // Service
  INSTALLATION_QUERY: "installation_query", // "Instalan?", "Incluye instalación?"
  WARRANTY_QUERY: "warranty_query",         // "Tiene garantía?", "Cuánto dura?"
  CUSTOM_SIZE_QUERY: "custom_size_query",   // "Hacen a medida?", "Tamaño personalizado?"

  // Conversation Flow
  CONFIRMATION: "confirmation",            // "Sí", "Ok", "Esa", "Perfecto"
  REJECTION: "rejection",                  // "No", "Otra", "No me interesa"
  CLARIFICATION: "clarification",          // User clarifying something
  FOLLOW_UP: "follow_up",                  // Following up on previous topic

  // Human Handoff
  HUMAN_REQUEST: "human_request",          // "Quiero hablar con alguien", "Agente"
  COMPLAINT: "complaint",                  // User expressing frustration

  // Other
  OFF_TOPIC: "off_topic",                  // Unrelated to products
  UNCLEAR: "unclear"                       // Can't determine intent
};

/**
 * All possible product types
 */
const PRODUCTS = {
  MALLA_SOMBRA: "malla_sombra",            // Pre-made shade mesh (confeccionada)
  ROLLO: "rollo",                          // Shade mesh rolls (100m)
  BORDE_SEPARADOR: "borde_separador",      // Garden edging
  GROUNDCOVER: "groundcover",              // Anti-weed fabric
  MONOFILAMENTO: "monofilamento",          // Monofilament mesh
  UNKNOWN: "unknown"                       // Can't determine product
};

/**
 * Build the classification prompt
 */
function buildClassificationPrompt(sourceContext, conversationFlow) {
  // Add context about current conversation state
  let flowContext = "";
  if (conversationFlow?.product) {
    flowContext += `\nCurrent product context: ${conversationFlow.product}`;
  }
  if (conversationFlow?.stage) {
    flowContext += `\nConversation stage: ${conversationFlow.stage}`;
  }
  if (conversationFlow?.pendingQuestion) {
    flowContext += `\nBot just asked about: ${conversationFlow.pendingQuestion}`;
  }

  // Add source context
  let sourceInfo = "";
  if (sourceContext?.ad?.product) {
    sourceInfo += `\nUser came from ad for: ${sourceContext.ad.product}`;
  }
  if (sourceContext?.isReturning) {
    sourceInfo += `\nThis is a returning user`;
    if (sourceContext?.history?.lastProductInterest) {
      sourceInfo += ` interested in: ${sourceContext.history.lastProductInterest}`;
    }
  }

  return `You are a classifier for a Mexican shade mesh (malla sombra) company chatbot.

PRODUCTS WE SELL:
- malla_sombra: Pre-made shade mesh in specific sizes (2x2m to 6x10m), beige color
- rollo: Shade mesh rolls, 100m long, widths of 2.10m or 4.20m, various shade percentages (35%-90%)
- borde_separador: Plastic garden edging, comes in 6m, 9m, 18m, or 54m lengths
- groundcover: Anti-weed ground cover fabric (also called "antimaleza")
- monofilamento: Monofilament shade mesh (agricultural use)
${flowContext}${sourceInfo}

CLASSIFICATION RULES:
1. If user just says "Precio", "Precio!", "Cuánto cuesta?" without specifying product → intent: "price_query", product: use context or "unknown"
2. If user provides dimensions like "4x5", "3 por 4 metros" → intent: "size_specification"
3. If user provides percentage like "90%", "al 80" → intent: "percentage_specification"
4. If user provides quantity like "15 rollos", "quiero 10" → intent: "quantity_specification"
5. If user mentions borde lengths (6, 9, 18, 54 meters) → product: "borde_separador"
6. If user mentions 100m length or widths 2.10/4.20 → product: "rollo"
7. If user says "sí", "ok", "esa", "perfecto" → intent: "confirmation"
8. If user says "no", "otra", "diferente" → intent: "rejection"
9. If user asks about shipping, delivery, envío → intent: "shipping_query"
10. If user asks about location, dónde están, tienda → intent: "location_query"
11. If user asks about installation → intent: "installation_query"
12. If user mentions "maleza" in context of WANTING ground cover → product: "groundcover"
13. If user mentions "maleza" explaining WHY they need shade (para que no salga maleza) → keep original product context

ENTITY EXTRACTION:
- width: number in meters (e.g., 4.20, 2.10, 3)
- height/length: number in meters
- percentage: shade percentage (35-90)
- quantity: number of units
- color: negro, verde, beige, blanco, azul
- borde_length: 6, 9, 18, or 54 (only for borde_separador)

Respond with ONLY valid JSON, no explanation:
{
  "intent": "<intent from list>",
  "product": "<product or unknown>",
  "entities": {
    "width": <number or null>,
    "height": <number or null>,
    "percentage": <number or null>,
    "quantity": <number or null>,
    "color": "<string or null>",
    "borde_length": <number or null>
  },
  "confidence": <0.0-1.0>
}`;
}

/**
 * Classify a user message using AI
 *
 * @param {string} message - User's message
 * @param {object} sourceContext - Source context from Layer 0
 * @param {object} conversationFlow - Current conversation flow state
 * @returns {object} Classification result
 */
async function classifyMessage(message, sourceContext = null, conversationFlow = null) {
  const startTime = Date.now();

  try {
    const systemPrompt = buildClassificationPrompt(sourceContext, conversationFlow);

    const response = await openai.chat.completions.create({
      model: process.env.CLASSIFIER_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.1, // Low temperature for consistent classification
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate and normalize the result
    const classification = {
      intent: INTENTS[result.intent?.toUpperCase()] || result.intent || INTENTS.UNCLEAR,
      product: PRODUCTS[result.product?.toUpperCase()] || result.product || PRODUCTS.UNKNOWN,
      entities: {
        width: result.entities?.width || null,
        height: result.entities?.height || null,
        percentage: result.entities?.percentage || null,
        quantity: result.entities?.quantity || null,
        color: result.entities?.color || null,
        borde_length: result.entities?.borde_length || null
      },
      confidence: result.confidence || 0.5,
      raw: result,
      latencyMs: Date.now() - startTime
    };

    console.log(`🧠 LAYER 1 Classification:`, {
      message: message.slice(0, 50),
      intent: classification.intent,
      product: classification.product,
      entities: Object.fromEntries(
        Object.entries(classification.entities).filter(([_, v]) => v !== null)
      ),
      confidence: classification.confidence,
      latencyMs: classification.latencyMs
    });

    return classification;

  } catch (error) {
    console.error(`❌ Classification error:`, error);

    // Return a safe fallback
    return {
      intent: INTENTS.UNCLEAR,
      product: PRODUCTS.UNKNOWN,
      entities: {},
      confidence: 0,
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Quick regex-based pre-classification for obvious cases
 * Skips AI call for simple patterns to save latency/cost
 *
 * @param {string} message - User's message
 * @returns {object|null} Classification or null if AI needed
 */
function quickClassify(message) {
  const msg = message.toLowerCase().trim();

  // Greetings
  if (/^(hola|buenas?|hey|hi|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?))[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.GREETING, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // Thanks
  if (/^(gracias|muchas\s*gracias|thanks|thx)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.THANKS, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // Simple confirmations
  if (/^(s[ií]|ok|okey|vale|claro|perfecto|exacto|correcto|eso|esa|ese)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Simple rejections
  if (/^(no|nop|nope|nel|negativo)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.REJECTION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Simple price query
  if (/^(precio|precios?|costo|costos?)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.PRICE_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Human request
  if (/\b(humano|persona|agente|asesor|hablar\s*con\s*alguien)\b/i.test(msg)) {
    return { intent: INTENTS.HUMAN_REQUEST, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // Need AI for anything else
  return null;
}

/**
 * Main classification function - uses quick classify first, then AI if needed
 *
 * @param {string} message - User's message
 * @param {object} sourceContext - Source context from Layer 0
 * @param {object} conversationFlow - Current conversation flow state
 * @returns {object} Classification result
 */
async function classify(message, sourceContext = null, conversationFlow = null) {
  console.log(`\n🧠 ===== LAYER 1: INTENT CLASSIFIER =====`);

  // Try quick classification first
  const quickResult = quickClassify(message);
  if (quickResult) {
    console.log(`⚡ Quick classification (no AI):`, quickResult.intent);
    console.log(`🧠 ===== END LAYER 1 =====\n`);
    return { ...quickResult, source: "quick" };
  }

  // Use AI classification
  const aiResult = await classifyMessage(message, sourceContext, conversationFlow);
  console.log(`🧠 ===== END LAYER 1 =====\n`);
  return { ...aiResult, source: "ai" };
}

/**
 * Log classification for analytics
 */
function logClassification(psid, message, classification) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    psid: psid?.slice(-6) || "unknown",
    message: message.slice(0, 100),
    intent: classification.intent,
    product: classification.product,
    entities: classification.entities,
    confidence: classification.confidence,
    source: classification.source,
    latencyMs: classification.latencyMs || 0
  };

  console.log(`📊 CLASSIFY_LOG:`, JSON.stringify(logEntry));
}

module.exports = {
  classify,
  classifyMessage,
  quickClassify,
  logClassification,
  INTENTS,
  PRODUCTS
};
