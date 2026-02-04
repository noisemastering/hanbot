// ai/classifier/intentClassifier.js
// Layer 1: AI-based Intent Classification
// Single AI call to extract intent, product, and entities

const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ========== INTENT CACHE FOR DB-DRIVEN INTENTS ==========
let intentCache = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get intents from database with caching
 */
async function getIntentsFromDB() {
  if (intentCache && Date.now() < cacheExpiry) {
    return intentCache;
  }

  try {
    const Intent = require("../../models/Intent");
    intentCache = await Intent.find({ active: true }).sort({ priority: -1 }).lean();
    cacheExpiry = Date.now() + CACHE_TTL;
    console.log(`🔄 Intent cache refreshed: ${intentCache.length} intents loaded from DB`);
    return intentCache;
  } catch (error) {
    console.error("❌ Error loading intents from DB, using fallback:", error.message);
    return null; // Will use hardcoded INTENTS as fallback
  }
}

/**
 * Clear intent cache (called when intents are updated via API)
 */
function clearIntentCache() {
  intentCache = null;
  cacheExpiry = 0;
  console.log("🗑️ Intent cache cleared");
}

/**
 * All possible intents the classifier can return
 * Organized by category for easier maintenance
 */
const INTENTS = {
  // ===== GREETINGS & SOCIAL =====
  GREETING: "greeting",                    // "Hola", "Buenos días"
  THANKS: "thanks",                        // "Gracias", "Muchas gracias"
  GOODBYE: "goodbye",                      // "Adiós", "Hasta luego"

  // ===== PRODUCT QUERIES =====
  PRICE_QUERY: "price_query",              // "Cuánto cuesta?", "Precio?"
  PRODUCT_INQUIRY: "product_inquiry",      // "Tienen malla sombra?", "Qué productos manejan?"
  AVAILABILITY_QUERY: "availability_query", // "Tienen en stock?", "Hay disponible?"
  CATALOG_REQUEST: "catalog_request",      // "Muéstrame opciones", "Qué medidas tienen"
  PRODUCT_COMPARISON: "product_comparison", // "Diferencia entre raschel y monofilamento"
  PHOTO_REQUEST: "photo_request",          // "Foto del producto", "Cómo se ve"
  LARGEST_PRODUCT: "largest_product",      // "La más grande", "Medida máxima"
  SMALLEST_PRODUCT: "smallest_product",    // "La más chica", "Medida mínima"

  // ===== SPECIFICATIONS (user providing info) =====
  SIZE_SPECIFICATION: "size_specification",         // "4x5", "3 metros por 4"
  PERCENTAGE_SPECIFICATION: "percentage_specification", // "90%", "al 80 por ciento"
  QUANTITY_SPECIFICATION: "quantity_specification",     // "15 rollos", "quiero 10"
  COLOR_SPECIFICATION: "color_specification",           // "negro", "en verde"
  COLOR_QUERY: "color_query",                           // "Qué colores tienen?", "De qué colores hay?"
  LENGTH_SPECIFICATION: "length_specification",         // "de 18 metros" (for borde)
  SHADE_PERCENTAGE_QUERY: "shade_percentage_query",     // "Qué porcentaje de sombra?", "Cuánta sombra da?"

  // ===== LOGISTICS =====
  SHIPPING_QUERY: "shipping_query",        // "Hacen envíos?", "Envían a mi ciudad?"
  LOCATION_QUERY: "location_query",        // "Dónde están?", "Tienen tienda física?"
  LOCATION_MENTION: "location_mention",    // User says where they're from: "Soy de Monterrey"
  PAYMENT_QUERY: "payment_query",          // "Cómo pago?", "Aceptan tarjeta?"
  PAY_ON_DELIVERY_QUERY: "pay_on_delivery_query", // "Pago al entregar?", "Contra entrega?"
  DELIVERY_TIME_QUERY: "delivery_time_query", // "Cuándo llega?", "Tiempo de entrega?"
  SHIPPING_INCLUDED_QUERY: "shipping_included_query", // "Incluye envío?", "Ya con entrega?"

  // ===== SERVICE & INSTALLATION =====
  INSTALLATION_QUERY: "installation_query", // "Instalan?", "Incluye instalación?"
  WARRANTY_QUERY: "warranty_query",         // "Tiene garantía?", "Cuánto dura?"
  DURABILITY_QUERY: "durability_query",     // "Cuánto tiempo dura?", "Vida útil?"
  CUSTOM_SIZE_QUERY: "custom_size_query",   // "Hacen a medida?", "Tamaño personalizado?"
  STRUCTURE_QUERY: "structure_query",       // "Hacen la estructura?", "Incluye postes?"
  ACCESSORY_QUERY: "accessory_query",       // "Incluye cuerda?", "Viene con arnés?"
  EYELETS_QUERY: "eyelets_query",           // "Tiene ojillos?", "Trae argollas?"

  // ===== PURCHASE FLOW =====
  STORE_LINK_REQUEST: "store_link_request", // "Link de la tienda", "Mercado Libre?"
  HOW_TO_BUY: "how_to_buy",                 // "Cómo compro?", "Proceso de compra?"
  BULK_DISCOUNT: "bulk_discount",           // "Precio por mayoreo", "Descuento por volumen"
  PRICE_PER_SQM: "price_per_sqm",           // "Precio por metro cuadrado", "Cuánto el m2"
  DETAILS_REQUEST: "details_request",       // "Más información", "Déjame ver"

  // ===== CONVERSATION FLOW =====
  CONFIRMATION: "confirmation",            // "Sí", "Ok", "Esa", "Perfecto"
  REJECTION: "rejection",                  // "No", "Otra", "No me interesa"
  CLARIFICATION: "clarification",          // User clarifying something
  FOLLOW_UP: "follow_up",                  // Following up on previous topic
  MULTI_QUESTION: "multi_question",        // "Precio y ubicación", multiple questions in one
  WILL_GET_BACK: "will_get_back",          // "Mañana te aviso", "Voy a medir"
  FUTURE_INTEREST: "future_interest",      // "En un par de meses", "Más adelante"

  // ===== ESCALATION =====
  HUMAN_REQUEST: "human_request",          // "Quiero hablar con alguien", "Agente"
  COMPLAINT: "complaint",                  // User expressing general frustration
  FRUSTRATION: "frustration",              // "Ya te dije", "No entienden", "Estoy diciendo"
  PRICE_CONFUSION: "price_confusion",      // "Es otro precio?", "Me dijiste diferente"
  OUT_OF_STOCK_REPORT: "out_of_stock_report", // "Dice agotado", "No hay en stock"

  // ===== CONTACT INFO (hot leads!) =====
  PHONE_SHARED: "phone_shared",            // User shared their phone number
  PHONE_REQUEST: "phone_request",          // "Teléfono?", "Número para llamar"

  // ===== OTHER =====
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
 * Build campaign context section for the prompt
 */
function buildCampaignContext(campaignContext) {
  if (!campaignContext) return "";

  let context = "\n\n===== CAMPAIGN CONTEXT =====";

  // Traffic source and ad info
  if (campaignContext.traffic_source) {
    context += `\nTraffic source: ${campaignContext.traffic_source}`;
  }

  if (campaignContext.ad) {
    if (campaignContext.ad.angle) {
      context += `\nAd angle: ${campaignContext.ad.angle}`;
    }
    if (campaignContext.ad.summary) {
      context += `\nAd message: "${campaignContext.ad.summary}"`;
    }
    if (campaignContext.ad.offer_hook) {
      context += `\nOffer: ${campaignContext.ad.offer_hook}`;
    }
  }

  // Audience info
  if (campaignContext.audience) {
    if (campaignContext.audience.type) {
      context += `\nAudience type: ${campaignContext.audience.type}`;
    }
    if (campaignContext.audience.experience_level) {
      context += `\nExperience level: ${campaignContext.audience.experience_level}`;
    }
  }

  // Products in this campaign
  if (campaignContext.products && campaignContext.products.length > 0) {
    context += `\n\nCAMPAIGN PRODUCTS:`;
    for (const p of campaignContext.products) {
      context += `\n- ${p.name} (SKU: ${p.sku})`;
      if (p.primary_benefit) {
        context += `: ${p.primary_benefit}`;
      }
      if (p.constraints?.requires_quote) {
        context += ` [REQUIRES QUOTE]`;
      }
      if (p.constraints?.sold_by) {
        context += ` [Sold by: ${p.constraints.sold_by}]`;
      }
    }
  }

  // Conversation goal
  if (campaignContext.conversation_goal) {
    context += `\n\nCONVERSATION GOAL: ${campaignContext.conversation_goal}`;
    if (campaignContext.conversation_goal === "cotizacion") {
      context += ` (collect requirements, then hand off to human for quote)`;
    } else if (campaignContext.conversation_goal === "venta_directa") {
      context += ` (direct user to Mercado Libre link to purchase)`;
    }
  }

  // Response guidelines
  if (campaignContext.response_guidelines) {
    const rg = campaignContext.response_guidelines;
    if (rg.tone) {
      context += `\n\nTONE: ${rg.tone}`;
    }
    if (rg.must_not && rg.must_not.length > 0) {
      context += `\n\nMUST NOT:`;
      for (const rule of rg.must_not) {
        context += `\n- ${rule}`;
      }
    }
    if (rg.should_do && rg.should_do.length > 0) {
      context += `\n\nSHOULD DO:`;
      for (const rule of rg.should_do) {
        context += `\n- ${rule}`;
      }
    }
  }

  context += "\n===== END CAMPAIGN CONTEXT =====";
  return context;
}

/**
 * Build intent list for prompt from DB intents
 */
function buildIntentListForPrompt(dbIntents) {
  if (!dbIntents || dbIntents.length === 0) {
    return null; // Use hardcoded rules
  }

  let intentList = "AVAILABLE INTENTS:\n";
  const intentsByCategory = {};

  for (const intent of dbIntents) {
    if (!intentsByCategory[intent.category]) {
      intentsByCategory[intent.category] = [];
    }
    intentsByCategory[intent.category].push(intent);
  }

  for (const [category, intents] of Object.entries(intentsByCategory)) {
    intentList += `\n[${category.toUpperCase()}]\n`;
    for (const intent of intents) {
      intentList += `- ${intent.key}: ${intent.description || intent.name}`;
      if (intent.keywords && intent.keywords.length > 0) {
        intentList += ` (keywords: ${intent.keywords.slice(0, 5).join(", ")}${intent.keywords.length > 5 ? "..." : ""})`;
      }
      intentList += "\n";
    }
  }

  return intentList;
}

/**
 * Build the classification prompt
 */
function buildClassificationPrompt(sourceContext, conversationFlow, campaignContext, dbIntents = null) {
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

  // Add campaign context
  const campaignSection = buildCampaignContext(campaignContext);

  // Build dynamic intent list from DB if available
  const dynamicIntentList = buildIntentListForPrompt(dbIntents);

  // Base prompt with product info
  let prompt = `You are a classifier for a Mexican shade mesh (malla sombra) company chatbot.

PRODUCTS WE SELL:
- malla_sombra: Pre-made shade mesh (confeccionada) in custom sizes. Standard sizes 2x2m to 6x10m available. Larger sizes require quote. User asking for "malla sombra" with dimensions = malla_sombra
- rollo: Shade mesh rolls, 100m long, widths of 2.10m or 4.20m, various shade percentages (35%-90%)
- borde_separador: Plastic garden edging, comes in 6m, 9m, 18m, or 54m lengths
- groundcover: Anti-weed ground cover fabric (also called "antimaleza")
- monofilamento: Monofilament shade mesh (agricultural use)
${flowContext}${sourceInfo}${campaignSection}
`;

  // Add dynamic intents if available, otherwise use hardcoded rules
  if (dynamicIntentList) {
    prompt += `
${dynamicIntentList}

CLASSIFICATION INSTRUCTIONS:
- Match user messages to the most appropriate intent from the list above
- Use keywords and descriptions to guide your classification
- Return the intent key (e.g., "price_query", "greeting", etc.)
- If no intent matches well, use "unclear"
`;
  } else {
    prompt += `
AVAILABLE INTENTS (choose the most specific one):

[GREETINGS & SOCIAL]
- greeting: "Hola", "Buenos días", "Buenas tardes"
- thanks: "Gracias", "Muchas gracias"
- goodbye: "Adiós", "Hasta luego", "Bye"

[PRODUCT QUERIES]
- price_query: "Cuánto cuesta?", "Precio?", "Qué precio tiene?"
- product_inquiry: "Tienen malla?", "Qué productos manejan?"
- availability_query: "Tienen en stock?", "Hay disponible?"
- catalog_request: "Muéstrame las opciones", "Qué medidas tienen", "Lista de precios"
- product_comparison: "Diferencia entre raschel y monofilamento", "Cuál es mejor?"
- photo_request: "Foto del producto", "Cómo se ve?", "Tiene imagen?"
- largest_product: "La más grande", "Medida máxima", "La mayor que tengan"
- smallest_product: "La más chica", "Medida mínima", "La menor"

[SPECIFICATIONS - user providing info]
- size_specification: "4x5", "3 metros por 4", "10x10", "de 8 metros" (dimensions)
- percentage_specification: "90%", "al 80 por ciento" (shade percentage)
- quantity_specification: "15 rollos", "quiero 10", "necesito 5"
- color_specification: "negro", "en beige", "la verde" (specifying a color)
- color_query: "Qué colores tienen?", "De qué colores hay?", "Tienen en otro color?" (asking about colors)
- length_specification: "de 18 metros", "6m" (for borde separador)
- shade_percentage_query: "Qué porcentaje de sombra?", "Cuánta sombra da?"

[LOGISTICS]
- shipping_query: "Hacen envíos?", "Envían a mi ciudad?", "Llegan a Monterrey?"
- location_query: "Dónde están ubicados?", "Tienen tienda física?", "Dirección?"
- location_mention: User says where they're from: "Soy de Monterrey", "Vivo en Jalisco", "En Guadalajara"
- payment_query: "Cómo pago?", "Aceptan tarjeta?", "Formas de pago?"
- pay_on_delivery_query: "Pago al entregar?", "Contra entrega?", "Cuando llegue pago?"
- delivery_time_query: "Cuándo llega?", "Tiempo de entrega?", "Cuántos días?"
- shipping_included_query: "Ya incluye envío?", "El precio es con entrega?"

[SERVICE & INSTALLATION]
- installation_query: "Ustedes instalan?", "Incluye instalación?", "Pasan a medir?"
- warranty_query: "Tiene garantía?", "Cuánto de garantía?"
- durability_query: "Cuánto tiempo dura?", "Vida útil?", "Cuántos años dura?"
- custom_size_query: "Hacen a medida exacta?", "Medidas personalizadas?"
- structure_query: "Hacen la estructura?", "Incluye postes?", "Venden estructura metálica?"
- accessory_query: "Incluye cuerda?", "Viene con arnés?", "Kit de instalación?"
- eyelets_query: "Tiene ojillos?", "Trae argollas?", "Viene con hoyitos?"

[PURCHASE FLOW]
- store_link_request: "Link de la tienda", "Mercado Libre?", "Donde compro?"
- how_to_buy: "Cómo compro?", "Proceso de compra?", "Cómo hago mi pedido?"
- bulk_discount: "Precio por mayoreo", "Descuento por volumen", "Si compro varios?"
- price_per_sqm: "Precio por metro cuadrado", "Cuánto el m2?"
- details_request: "Más información", "Déjame ver", "Muéstrame el producto"

[CONVERSATION FLOW]
- confirmation: "Sí", "Ok", "Esa", "Perfecto", "Dale", "Claro"
- rejection: "No", "Otra", "No me interesa", "Diferente"
- multi_question: Multiple questions in one message (price AND shipping, etc.)
- will_get_back: "Mañana te aviso", "Voy a medir", "Al rato te confirmo"
- future_interest: "En un par de meses", "Más adelante", "Ahorita no pero después sí"

[ESCALATION]
- human_request: "Quiero hablar con alguien", "Un agente", "Persona real"
- complaint: User expressing general frustration with service
- frustration: "Ya te dije!", "No entienden", "Estoy diciendo que...", "No leen"
- price_confusion: "Es otro precio?", "Me dijiste diferente", "Por qué cambió?"
- out_of_stock_report: "Dice agotado", "No hay en stock", "Sale que no disponible"

[CONTACT]
- phone_shared: User shared their phone number (10 digits)
- phone_request: "Teléfono?", "Número para llamar?", "WhatsApp?"

[OTHER]
- off_topic: Unrelated to products (weather, politics, jokes)
- unclear: Can't determine intent

PRODUCT CLASSIFICATION RULES:
1. "malla sombra" + dimensions (e.g., "malla 10x10") → product: "malla_sombra", intent: "product_inquiry"
2. "malla sombra" without "rollo" or "100 metros" → product: "malla_sombra" (confeccionada)
3. "rollo" or "100 metros" mentioned → product: "rollo"
4. Borde lengths (6, 9, 18, 54 meters) → product: "borde_separador"
5. "antimaleza" or "ground cover" → product: "groundcover"
6. "monofilamento" → product: "monofilamento"
7. If campaign context specifies products, prefer those

CRITICAL EXAMPLES:
- "Qué colores tienen en existencia?" → intent: "color_query" (NOT location_query!)
- "Soy de Monterrey" → intent: "location_mention"
- "Ya te dije las medidas!" → intent: "frustration"
- "En un par de meses" → intent: "future_interest"
- "4x5" (just dimensions) → intent: "size_specification"
- "Envían a Guadalajara?" → intent: "shipping_query", entities.location: "Guadalajara"
`;
  }

  prompt += `
ENTITY EXTRACTION:
- width: number in meters (e.g., 4.20, 2.10, 3)
- height/length: number in meters
- percentage: shade percentage (35-90)
- quantity: number of units (only when explicitly ordering, e.g., "quiero 5", "necesito 10 rollos". NOT from "una/uno" in price queries like "cuánto sale una")
- color: negro, verde, beige, blanco, azul
- borde_length: 6, 9, 18, or 54 (only for borde_separador)
- dimensions: full dimension string if detected (e.g., "4x5")
- location: city or state if mentioned

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
    "borde_length": <number or null>,
    "dimensions": "<string or null>",
    "location": "<string or null>"
  },
  "confidence": <0.0-1.0>,
  "suggested_action": "<optional: what the bot should do next>"
}`;

  return prompt;
}

/**
 * Classify a user message using AI
 *
 * @param {string} message - User's message
 * @param {object} sourceContext - Source context from Layer 0
 * @param {object} conversationFlow - Current conversation flow state
 * @param {object} campaignContext - Campaign context from Campaign.toAIContext()
 * @returns {object} Classification result
 */
async function classifyMessage(message, sourceContext = null, conversationFlow = null, campaignContext = null) {
  const startTime = Date.now();

  try {
    // Load intents from DB (with caching)
    const dbIntents = await getIntentsFromDB();

    const systemPrompt = buildClassificationPrompt(sourceContext, conversationFlow, campaignContext, dbIntents);

    const response = await openai.chat.completions.create({
      model: process.env.CLASSIFIER_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.1, // Low temperature for consistent classification
      max_tokens: 250,
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
        borde_length: result.entities?.borde_length || null,
        dimensions: result.entities?.dimensions || null,
        location: result.entities?.location || null
      },
      confidence: result.confidence || 0.5,
      suggestedAction: result.suggested_action || null,
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
      suggestedAction: classification.suggestedAction,
      latencyMs: classification.latencyMs,
      hasCampaign: !!campaignContext
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
 * @param {Array} dbIntents - Intents from database (optional)
 * @returns {object|null} Classification or null if AI needed
 */
function quickClassify(message, dbIntents = null) {
  const msg = message.toLowerCase().trim();

  // First, check DB intent patterns (highest priority for custom patterns)
  if (dbIntents && dbIntents.length > 0) {
    for (const intent of dbIntents) {
      if (!intent.patterns || intent.patterns.length === 0) continue;

      for (const pattern of intent.patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(msg)) {
            console.log(`✅ Pattern match for intent "${intent.key}": ${pattern}`);
            return {
              intent: intent.key,
              product: PRODUCTS.UNKNOWN,
              entities: {},
              confidence: 0.92,
              matchedPattern: pattern
            };
          }
        } catch (e) {
          console.warn(`⚠️ Invalid regex pattern for intent ${intent.key}: ${pattern}`);
        }
      }
    }
  }

  // Greetings - standalone or with self-introduction
  // Matches: "Hola", "Buenas tardes", "Hola soy María", "Buenas tardes aquí el señor X", etc.
  const greetingBase = /^(hola|buenas?|hey|hi|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?))/i;
  if (greetingBase.test(msg)) {
    // Check if it's just a greeting or greeting + self-introduction
    const selfIntro = /^(hola|buenas?|hey|hi|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?))[,.\s]*(soy|aquí|habla|le\s*habla|mi\s*nombre\s*es|el\s*señor|la\s*señora|sr\.?|sra\.?)/i;
    const simpleGreeting = /^(hola|buenas?|hey|hi|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?))[\s!?,.:]*$/i;

    if (simpleGreeting.test(msg) || selfIntro.test(msg)) {
      return { intent: INTENTS.GREETING, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
    }
  }

  // Thanks
  if (/^(gracias|muchas\s*gracias|thanks|thx)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.THANKS, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // ===== PHONE NUMBER DETECTION (HOT LEAD!) =====
  // Mexican phone numbers: 10 digits, optionally with +52 country code
  // Can have spaces, dashes, dots, or parentheses
  const phonePattern = /(?:\+?52\s*)?(?:\(?[1-9]\d{1,2}\)?[\s.-]*)?\d{3,4}[\s.-]?\d{4}/g;
  const phoneMatches = msg.match(phonePattern);
  if (phoneMatches) {
    // Clean and validate - must have 10 digits total
    for (const match of phoneMatches) {
      const digitsOnly = match.replace(/\D/g, '');
      // Remove country code if present
      const phone = digitsOnly.length === 12 && digitsOnly.startsWith('52')
        ? digitsOnly.slice(2)
        : digitsOnly;

      if (phone.length === 10) {
        console.log(`📱 Phone number detected: ${phone}`);
        return {
          intent: INTENTS.PHONE_SHARED,
          product: PRODUCTS.UNKNOWN,
          entities: { phone },
          confidence: 0.95
        };
      }
    }
  }

  // ===== MULTI-QUESTION DETECTION =====
  // Dynamically detect ALL question types in a message (supports 2, 3, or more questions)
  const questionIndicators = [
    { intent: 'price_query', pattern: /\b(precio|costo|cu[aá]nto\s*(cuesta|vale|es)|qu[eé]\s*precio)\b/i },
    { intent: 'availability_query', pattern: /\b(medidas?|tamaños?|disponib|stock|tienen|manejan|qu[eé]\s*medidas?)\b/i },
    { intent: 'payment_query', pattern: /\b(pago|pagar|tarjeta|efectivo|transferencia|forma\s*de\s*pago|meses)\b/i },
    { intent: 'location_query', pattern: /\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde\s*(est[aá]n|quedan|se\s*encuentran))\b/i },
    { intent: 'shipping_query', pattern: /\b(env[ií]o|envi[aá]n|entrega|llega|mandan|cu[aá]nto\s*tarda)\b/i },
    { intent: 'installation_query', pattern: /\b(instal[ae]n?|ponen|colocan|c[oó]mo\s*se\s*(instala|pone|coloca))\b/i },
    { intent: 'product_inquiry', pattern: /\b(informes?|info|caracter[ií]sticas?|especificaciones?|de\s*qu[eé]\s*(es|est[aá]|material))\b/i },
    { intent: 'delivery_time_query', pattern: /\b(cu[aá]nto\s*tarda|cu[aá]ntos?\s*d[ií]as?|tiempo\s*de\s*entrega|cuando\s*llega)\b/i }
  ];

  // Detect pay-on-delivery specifically
  const isPayOnDelivery = /\b(pago|pagar)\b.*\b(entreg|llega|recib)/i.test(msg) ||
                          /\b(al\s*entregar|contra\s*entrega|cuando\s*llegue)\b/i.test(msg);

  // Find all matching question types
  const detectedIntents = [];
  for (const { intent, pattern } of questionIndicators) {
    if (pattern.test(msg)) {
      detectedIntents.push(intent);
    }
  }

  // If 2+ questions detected, return as MULTI_QUESTION
  if (detectedIntents.length >= 2) {
    const entities = { subIntents: detectedIntents };
    if (isPayOnDelivery) {
      entities.payOnDelivery = true;
    }
    return {
      intent: INTENTS.MULTI_QUESTION,
      product: PRODUCTS.UNKNOWN,
      entities,
      confidence: 0.85
    };
  }

  // Simple confirmations (allow emojis like 👍 👌 ✅)
  // Include "aok" as common typo/variant of "a ok" / "ok"
  // Include "de acuerdo" as common Mexican acknowledgment
  if (/^(s[ií]|a?ok|okey|va|vale|claro|perfecto|exacto|correcto|eso|esa|ese|dale|listo|órale|simon|simón|de\s*acuerdo|entendido)[\s!?.👍👌✅🙌💪]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Polite request confirmations (e.g., "por favor si me la comparte", "si me la pasa")
  // These are affirmative responses meaning "yes, please do it"
  // Note: "x" is common shorthand for "por" in Mexican Spanish (e.g., "si x favor")
  // Note: "fabor" is common typo for "favor"
  if (/\b(por\s*favor|s[ií])\s*(s[ií]\s*)?(me\s+)?(la|lo|las|los)?\s*(comparte|pasa|manda|env[ií]a|muestra|ense[ñn]a)/i.test(msg) ||
      /\b(comp[aá]rt[ae]me|p[aá]s[ae]me|m[aá]nd[ae]me|env[ií][ae]me|mu[eé]str[ae]me)\b/i.test(msg) ||
      /\b(s[ií]\s+(por\s*fa(v|b)or|x\s*fa(v|b)or|porfa)|por\s*fa(v|b)or\s+s[ií]|s[ií]\s+x\s*fa(v|b)or)\b/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Confirmation at END of message (e.g., "Disculpa no tenía la medida Ok")
  // This catches messages where user explains something then confirms
  if (/\b(s[ií]|a?ok|okey|va|vale|claro|perfecto|exacto|correcto|eso|esa|ese|dale|listo|órale|simon|simón)[\s!?.👍👌✅🙌💪]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.80 };
  }

  // Emoji-only confirmations
  if (/^[👍👌✅🙌💪]+$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Message ending with confirmation emoji
  if (/[👍👌✅🙌💪]+[\s]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.75 };
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
  if (/\b(humano|persona|agente|asesor|especialista|hablar\s*con\s*alguien)\b/i.test(msg)) {
    return { intent: INTENTS.HUMAN_REQUEST, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // ===== NEW HIGH-IMPACT INTENTS =====

  // Frustration detection - CRITICAL for customer experience
  const frustrationPatterns = /\b(estoy\s+diciendo|no\s+leen|no\s+entienden|ya\s+(te|les?)\s+dije|les?\s+repito|no\s+me\s+escuchan?|no\s+ponen\s+atenci[oó]n|acabo\s+de\s+decir|como\s+te\s+dije|como\s+ya\s+dije|ya\s+lo\s+dije|no\s+est[aá]n?\s+entendiendo|pero\s+ya\s+dije)\b/i;
  if (frustrationPatterns.test(msg)) {
    return { intent: INTENTS.FRUSTRATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.95 };
  }

  // Color query - "qué colores tienen", "de qué colores hay" (NOT location!)
  // CRITICAL: This was being misclassified as location_query before
  if (/\b(qu[eé]\s+colou?re?s?|colou?re?s?\s+(tiene[ns]?|hay|manejan?|disponible)|de\s+qu[eé]\s+colou?re?s?|tienen?\s+en\s+otro\s+colou?r|colou?re?s?\s+en\s+existencia)\b/i.test(msg)) {
    return { intent: INTENTS.COLOR_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.92 };
  }

  // Phone request - "teléfono", "número para llamar"
  if (/\b(tel[eé]fono|n[uú]mero|llamar|whatsapp|contacto)\b/i.test(msg) &&
      /\b(tienen|tendr[aá]n?|hay|cu[aá]l|dame|p[aá]same|me\s+(dan|das|pasan?))\b/i.test(msg)) {
    return { intent: INTENTS.PHONE_REQUEST, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Future interest - "en un par de meses", "más adelante"
  if (/\b(en\s+un\s+(par|mes|par\s+de)\s+(de\s+)?(meses?|semanas?)|m[aá]s\s+adelante|despu[eé]s\s+me\s+interesa|por\s+ahora\s+no|ahorita\s+no\s+pero)\b/i.test(msg)) {
    return { intent: INTENTS.FUTURE_INTEREST, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Will get back - "mañana te aviso", "voy a medir"
  if (/\b(mañana|al\s+rato|luego|despu[eé]s)\s+(te\s+)?(aviso|confirmo|digo|escribo)\b/i.test(msg) ||
      /\b(voy\s+a\s+medir|deja\s+mido|tengo\s+que\s+medir)\b/i.test(msg)) {
    return { intent: INTENTS.WILL_GET_BACK, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Location mention - "soy de X", "vivo en X" (user providing their location)
  if (/\b(soy\s+de|vivo\s+en|estoy\s+en|me\s+encuentro\s+en)\s+/i.test(msg)) {
    return { intent: INTENTS.LOCATION_MENTION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Store link request - "mercado libre", "link de la tienda"
  if (/\b(tienes?|tienen?|venden?|est[aá]n?)\s+(en\s+|por\s+)?mercado\s*libre\b/i.test(msg) ||
      /\b(link|enlace)\s+(de\s+)?(la\s+)?(tienda|catalogo)\b/i.test(msg)) {
    return { intent: INTENTS.STORE_LINK_REQUEST, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // How to buy - "cómo compro", "proceso de compra"
  if (/\b(c[oó]mo\s+(compro|pido|hago\s+(mi\s+)?pedido)|proceso\s+de\s+compra|pasos?\s+para\s+comprar)\b/i.test(msg)) {
    return { intent: INTENTS.HOW_TO_BUY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Bulk discount - "mayoreo", "descuento por volumen"
  if (/\b(mayoreo|precio\s+especial|descuento\s+(por\s+)?(volumen|cantidad)|si\s+compro\s+varios)\b/i.test(msg)) {
    return { intent: INTENTS.BULK_DISCOUNT, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Eyelets/argollas query
  if (/\b(ojillo|ojillos|argolla|argollas|ojito|ojitos|para\s+colgar|para\s+amarrar)\b/i.test(msg)) {
    return { intent: INTENTS.EYELETS_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Installation query
  if (/\b(instalan|colocan|ponen\s+la\s+malla|servicio\s+de\s+instalaci[oó]n|pasan\s+a\s+medir|vienen\s+a\s+medir)\b/i.test(msg)) {
    return { intent: INTENTS.INSTALLATION_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Structure query
  if (/\b(realizan|hacen|fabrican|venden)\s+(la\s+)?estructura/i.test(msg)) {
    return { intent: INTENTS.STRUCTURE_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Pay on delivery query
  if (/\b(pago|pagar)\s+(al\s+entregar|contra\s+entrega)|hasta\s+que\s+llegue|cuando\s+llegue\s+pago/i.test(msg)) {
    return { intent: INTENTS.PAY_ON_DELIVERY_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Shipping included query
  if (/\b(precio|costo)\s+(ya\s+)?(incluye|con)\s+(el\s+)?(env[ií]o|entrega)|ya\s+incluye\s+(env[ií]o|entrega)|con\s+entrega\s+incluid[ao]/i.test(msg)) {
    return { intent: INTENTS.SHIPPING_INCLUDED_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.88 };
  }

  // Durability query
  if (/\b(cu[aá]nto\s+tiempo\s+dura|vida\s+[uú]til|cu[aá]ntos?\s+a[ñn]os|duraci[oó]n|resistencia)\b/i.test(msg) &&
      !/\b(entrega|env[ií]o)\b/i.test(msg)) {
    return { intent: INTENTS.DURABILITY_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Out of stock report
  if (/\b(agotad[oa]s?|sin\s+stock|no\s+hay\s+(en\s+)?stock|no\s+est[aá]\s+disponible|dice\s+(que\s+)?(no\s+hay|agotado)|fuera\s+de\s+stock)\b/i.test(msg)) {
    return { intent: INTENTS.OUT_OF_STOCK_REPORT, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.92 };
  }

  // Price confusion
  if (/\b(es\s+otr[ao]\s+precio|otro\s+precio|diferente\s+precio|por\s*qu[eé]\s+(dice|sale)\s+(otro|diferente)|no\s+es\s+el\s+mismo\s+precio)\b/i.test(msg)) {
    return { intent: INTENTS.PRICE_CONFUSION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.92 };
  }

  // ===== PRODUCT KEYWORD DETECTION =====
  // These bypass AI for obvious product mentions

  // First, check for "N de ancho y M de largo" or "N de largo y M de ancho" patterns
  const anchoLargoPattern = /(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*de\s*ancho\s*(?:y|x|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*(?:de\s*largo)?/i;
  const largoAnchoPattern = /(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*de\s*largo\s*(?:y|x|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*(?:de\s*ancho)?/i;

  let dimensions = null;
  let anchoLargoMatch = msg.match(anchoLargoPattern);
  let largoAnchoMatch = msg.match(largoAnchoPattern);

  if (anchoLargoMatch) {
    // "N de ancho y M de largo" - first is width, second is height
    const width = parseFloat(anchoLargoMatch[1].replace(',', '.'));
    const height = parseFloat(anchoLargoMatch[2].replace(',', '.'));
    if (!isNaN(width) && !isNaN(height)) {
      dimensions = { width: Math.min(width, height), height: Math.max(width, height), raw: `${width}x${height}` };
      console.log(`⚡ Detected "ancho y largo" format: ${width}x${height}`);
    }
  } else if (largoAnchoMatch) {
    // "N de largo y M de ancho" - first is height, second is width
    const height = parseFloat(largoAnchoMatch[1].replace(',', '.'));
    const width = parseFloat(largoAnchoMatch[2].replace(',', '.'));
    if (!isNaN(width) && !isNaN(height)) {
      dimensions = { width: Math.min(width, height), height: Math.max(width, height), raw: `${width}x${height}` };
      console.log(`⚡ Detected "largo y ancho" format: ${width}x${height}`);
    }
  }

  // Fallback: Standard dimension pattern: NxN, N x N, N*N, N por N
  if (!dimensions) {
    const dimPattern = /(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*(?:x|×|\*|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?/i;
    const dimMatch = msg.match(dimPattern);
    if (dimMatch) {
      const d1 = parseFloat(dimMatch[1].replace(',', '.'));
      const d2 = parseFloat(dimMatch[2].replace(',', '.'));
      if (!isNaN(d1) && !isNaN(d2)) {
        dimensions = { width: Math.min(d1, d2), height: Math.max(d1, d2), raw: `${d1}x${d2}` };
      }
    }
  }

  // "malla sombra" + dimensions = definitely malla_sombra product
  if (/malla\s*sombra/i.test(msg) && dimensions) {
    console.log(`⚡ Quick classify: malla sombra with dimensions ${dimensions.raw}`);
    return {
      intent: INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.MALLA_SOMBRA,
      entities: { dimensions: dimensions.raw, width: dimensions.width, height: dimensions.height },
      confidence: 0.95
    };
  }

  // "malla sombra" without "rollo" = malla_sombra (confeccionada)
  if (/malla\s*sombra/i.test(msg) && !/rollo/i.test(msg)) {
    console.log(`⚡ Quick classify: malla sombra (no rollo mentioned)`);
    return {
      intent: INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.MALLA_SOMBRA,
      entities: dimensions ? { dimensions: dimensions.raw, width: dimensions.width, height: dimensions.height } : {},
      confidence: 0.90
    };
  }

  // Just dimensions (when in context) - still extract them
  // Check if message is mostly just dimensions by removing the dimension part and seeing what's left
  if (dimensions) {
    // Remove dimension-related text and see if message is mostly about dimensions
    const withoutDims = msg
      .replace(/\d+(?:[.,]\d+)?\s*(?:m(?:ts|etros?)?\.?)?\s*(?:de\s*)?(?:ancho|largo)?\s*(?:y|x|×|\*|por)\s*\d+(?:[.,]\d+)?\s*(?:m(?:ts|etros?)?\.?)?\s*(?:de\s*)?(?:ancho|largo)?/gi, '')
      .replace(/\d+(?:[.,]\d+)?\s*(?:m(?:ts|etros?)?\.?)?/g, '')
      .trim();

    if (withoutDims.length < 15) {
      // Message is mostly just dimensions
      console.log(`⚡ Quick classify: dimensions only ${dimensions.raw}`);
      return {
        intent: INTENTS.SIZE_SPECIFICATION,
        product: PRODUCTS.UNKNOWN, // Let conversation context determine product
        entities: { dimensions: dimensions.raw, width: dimensions.width, height: dimensions.height },
        confidence: 0.85
      };
    }
  }

  // "rollo" or "100 metros" = rollo product
  if (/\brollo\b/i.test(msg) || /100\s*m(etros)?/i.test(msg)) {
    console.log(`⚡ Quick classify: rollo product`);
    return {
      intent: INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.ROLLO,
      entities: {},
      confidence: 0.90
    };
  }

  // "borde" = borde_separador
  if (/\bborde\b/i.test(msg)) {
    console.log(`⚡ Quick classify: borde product`);
    return {
      intent: INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.BORDE_SEPARADOR,
      entities: {},
      confidence: 0.90
    };
  }

  // "antimaleza" or "groundcover" or "malla para maleza"
  if (/\b(antimaleza|ground\s*cover|malla\s*(para\s*)?maleza)\b/i.test(msg)) {
    console.log(`⚡ Quick classify: groundcover product`);
    return {
      intent: INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.GROUNDCOVER,
      entities: {},
      confidence: 0.90
    };
  }

  // Just "malla" (without "sombra", "maleza", "anti") = malla_sombra (confeccionada)
  // This is the default product when someone just says "malla"
  if (/\bmalla\b/i.test(msg) && !/rollo|maleza|anti|granizo|[aá]fido/i.test(msg)) {
    // Check if it's a price query
    const isPrice = /precio|costo|cu[aá]nto|vale|cuesta/i.test(msg);
    console.log(`⚡ Quick classify: just "malla" → malla_sombra (${isPrice ? 'price_query' : 'product_inquiry'})`);
    return {
      intent: isPrice ? INTENTS.PRICE_QUERY : INTENTS.PRODUCT_INQUIRY,
      product: PRODUCTS.MALLA_SOMBRA,
      entities: dimensions ? { dimensions: dimensions.raw, width: dimensions.width, height: dimensions.height } : {},
      confidence: 0.85
    };
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
 * @param {object} campaignContext - Campaign context from Campaign.toAIContext()
 * @returns {object} Classification result
 */
async function classify(message, sourceContext = null, conversationFlow = null, campaignContext = null) {
  console.log(`\n🧠 ===== LAYER 1: INTENT CLASSIFIER =====`);

  if (campaignContext) {
    console.log(`📣 Campaign context provided:`, {
      goal: campaignContext.conversation_goal,
      products: campaignContext.products?.length || 0,
      audience: campaignContext.audience?.type
    });
  }

  // Load DB intents for pattern matching and AI prompt
  const dbIntents = await getIntentsFromDB();

  // Try quick classification first (includes DB patterns)
  const quickResult = quickClassify(message, dbIntents);
  if (quickResult) {
    console.log(`⚡ Quick classification (no AI):`, quickResult.intent);
    console.log(`🧠 ===== END LAYER 1 =====\n`);
    return { ...quickResult, source: "quick" };
  }

  // Use AI classification
  const aiResult = await classifyMessage(message, sourceContext, conversationFlow, campaignContext);
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
  buildCampaignContext,
  clearIntentCache,
  getIntentsFromDB,
  INTENTS,
  PRODUCTS
};
