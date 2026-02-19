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

// ========== PRODUCT CATALOG CACHE FOR AI PROMPT ==========
let catalogCache = null;
let catalogCacheExpiry = 0;
const CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build a compact text representation of available product sizes for the AI prompt.
 * Queries the database, classifies products by flow, and extracts available dimensions.
 */
async function getProductCatalogForPrompt() {
  if (catalogCache && Date.now() < catalogCacheExpiry) return catalogCache;

  try {
    const ProductFamily = require("../../models/ProductFamily");
    const { classifyProduct } = require("../utils/inventoryMatcher");

    // Two queries: sellable products (sizes) + all nodes (for ancestor classification)
    const [products, allNodes] = await Promise.all([
      ProductFamily.find({ sellable: true, active: true, size: { $exists: true, $ne: null } })
        .select('name size price parentId').lean(),
      ProductFamily.find({ active: true }).select('name parentId').lean()
    ]);

    const byId = {};
    allNodes.forEach(p => byId[p._id.toString()] = p);

    // Collect specs per product type
    const malla = new Set(), rolloW = new Set(), rolloPct = new Set(),
          borde = new Set(), gcW = new Set(),
          monoW = new Set(), monoPct = new Set();

    for (const p of products) {
      const flow = classifyProduct(p, byId);
      const size = (p.size || '').trim();
      if (!flow || !size) continue;

      if (flow === 'malla_sombra') {
        const m = size.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
        if (m) {
          const w = Math.min(parseFloat(m[1]), parseFloat(m[2]));
          const h = Math.max(parseFloat(m[1]), parseFloat(m[2]));
          if (h <= 10) malla.add(`${w}x${h}`);
        }
      } else if (flow === 'rollo') {
        const m = size.match(/(\d+(?:\.\d+)?)\s*x\s*100/i);
        if (m) rolloW.add(parseFloat(m[1]).toString());
        const pct = (p.name || '').match(/(\d+)\s*%/);
        if (pct) rolloPct.add(parseInt(pct[1]));
      } else if (flow === 'borde_separador') {
        const m = (size + ' ' + (p.name || '')).match(/(\d+)\s*m/i);
        if (m) borde.add(parseInt(m[1]));
      } else if (flow === 'groundcover') {
        const m = size.match(/(\d+(?:\.\d+)?)\s*x/i);
        if (m) gcW.add(parseFloat(m[1]).toString());
      } else if (flow === 'monofilamento') {
        const m = size.match(/(\d+(?:\.\d+)?)\s*x/i);
        if (m) monoW.add(parseFloat(m[1]).toString());
        const pct = (p.name || '').match(/(\d+)\s*%/);
        if (pct) monoPct.add(parseInt(pct[1]));
      }
    }

    // Format compact prompt text
    const lines = ['AVAILABLE CATALOG SIZES (validate user dimensions against these):'];
    if (malla.size > 0) {
      const sorted = [...malla].sort((a, b) => {
        const [aw, ah] = a.split('x').map(Number);
        const [bw, bh] = b.split('x').map(Number);
        return (aw * ah) - (bw * bh);
      });
      lines.push(`- malla_sombra: ${sorted.join(', ')}. Max 10m per side.`);
    }
    if (rolloW.size > 0) {
      lines.push(`- rollo: Widths ${[...rolloW].sort().map(w => w + 'm').join(', ')}, length 100m. Shade: ${[...rolloPct].sort((a, b) => a - b).map(p => p + '%').join(', ')}`);
    }
    if (borde.size > 0) {
      lines.push(`- borde_separador: ${[...borde].sort((a, b) => a - b).map(l => l + 'm').join(', ')}`);
    }
    if (gcW.size > 0) {
      lines.push(`- groundcover: Widths ${[...gcW].sort().map(w => w + 'm').join(', ')}, length 100m`);
    }
    if (monoW.size > 0) {
      lines.push(`- monofilamento: Widths ${[...monoW].sort().map(w => w + 'm').join(', ')}, length 100m. Shade: ${[...monoPct].sort((a, b) => a - b).map(p => p + '%').join(', ')}`);
    }

    catalogCache = lines.join('\n');
    catalogCacheExpiry = Date.now() + CATALOG_CACHE_TTL;
    console.log(`🔄 Catalog cache refreshed for AI prompt (${products.length} products scanned)`);
    return catalogCache;
  } catch (error) {
    console.error("❌ Error building catalog for prompt:", error.message);
    return ''; // Return empty string on error — AI will still work, just without catalog
  }
}

/**
 * Clear catalog cache (called when products are updated via API)
 */
function clearCatalogCache() {
  catalogCache = null;
  catalogCacheExpiry = 0;
  console.log("🗑️ Catalog cache cleared");
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
  LOCATION_TOO_FAR: "location_too_far",    // "Muy lejos", "Cómo puedo adquirir desde aquí"
  STORE_VISIT: "store_visit",              // "Los visito", "Voy a su tienda"
  PURCHASE_DEFERRAL: "purchase_deferral",  // "Lo voy a pensar", "Después te aviso"

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
function buildClassificationPrompt(sourceContext, conversationFlow, campaignContext, dbIntents = null, catalogText = '') {
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
- malla_sombra: Pre-made shade mesh (confeccionada) in various standard sizes. User asking for "malla sombra" with dimensions = malla_sombra
- rollo: Shade mesh rolls, 100m long, widths of 2.10m or 4.20m, various shade percentages (35%-90%)
- borde_separador: Plastic garden edging, comes in various roll lengths (not 100m rolls)
- groundcover: Anti-weed ground cover fabric (also called "antimaleza")
- monofilamento: Monofilament shade mesh (agricultural use)
${catalogText ? '\n' + catalogText : ''}
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
- store_visit: "Los visito", "Voy a su tienda", "Puedo ir a ver?", "Quiero ir a verlas"
- purchase_deferral: "Lo voy a pensar", "Después te aviso", "Déjame ver"
- location_too_far: "Muy lejos", "Están muy lejos", "Cómo puedo adquirir desde aquí?", "No me queda cerca"

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
- "Muy lejos, cómo le hago?" → intent: "location_too_far" (NOT frustration - they're saying our location is too far)
- "Los visito en su tienda" → intent: "store_visit"
- "Lo voy a pensar" → intent: "purchase_deferral"
- "De cuantos metros son las mallas sonbras" → intent: "catalog_request", product: "malla_sombra" (NOT location! "sonbras" is a misspelling of "sombras", NOT "Sonora")
- "Son para sombra o también protejan de la lluvia?" → intent: "product_inquiry" (asking about product features, NOT location! "Son" = "Are they", NOT "Sonora")
`;
  }

  prompt += `
CRITICAL WARNING - COMMON HALLUCINATION:
"sombra" / "sombras" is the PRODUCT NAME (malla sombra = shade mesh). It is NOT the state of Sonora.
NEVER extract "Sonora" as a location unless the user explicitly writes "Sonora" by name.
"Son para sombra" means "Are they for shade?" — "Son" = "Are they", NOT an abbreviation of Sonora.

ENTITY EXTRACTION:
- width: number in meters (e.g., 4.20, 2.10, 3). Parse Spanish number words: "tres" → 3, "cuatro y medio" → 4.5
- height/length: number in meters. Parse "por" as dimension separator: "tres por cuatro" → width=3, height=4
- percentage: shade percentage (35-90)
- quantity: number of units (only when explicitly ordering, e.g., "quiero 5", "necesito 10 rollos". NOT from "una/uno" in price queries like "cuánto sale una")
- CRITICAL: Numbers that are part of dimensions are NOT quantity. "10x5" = 10m by 5m, quantity=null. "10 x 5 malla" = 10m by 5m, quantity=null. Only extract quantity when it's SEPARATE from dimensions (e.g., "quiero 3 de 5x4" = quantity=3, width=4, height=5).
- color: negro, verde, beige, blanco, azul
- borde_length: 6, 9, 18, or 54 (only for borde_separador)
- dimensions: full dimension string if detected (e.g., "4x5", "3 por 4", "tres por cuatro")
- IMPORTANT: When user says "una de tres por cuatro", "una" means "one piece of 3x4", NOT a dimension. Extract width=3, height=4.
- location: city or state if mentioned
- matched_size: If user's dimensions match an available catalog size exactly, return it (e.g., "4x5" for malla, "18m" for borde, "2.10" for rollo width). Return null if not in catalog or no dimensions given.
- concerns: array of secondary topics/concerns the user mentions (e.g., ["color", "durability", "price", "features", "reinforcement", "weather_resistance", "installation"]). Extract ALL concerns, don't lose information. If user asks "y que colores" or similar, include "color" in concerns.

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
    "location": "<string or null>",
    "matched_size": "<string or null>",
    "concerns": <array of strings or null>
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
    // Load intents and catalog in parallel
    const [dbIntents, catalogText] = await Promise.all([
      getIntentsFromDB(),
      getProductCatalogForPrompt()
    ]);

    const systemPrompt = buildClassificationPrompt(sourceContext, conversationFlow, campaignContext, dbIntents, catalogText);

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
    // Map unknown intents with dimensions to product_inquiry
    let mappedIntent = INTENTS[result.intent?.toUpperCase()] || result.intent;
    if (!INTENTS[result.intent?.toUpperCase()] && result.entities?.dimensions) {
      console.log(`🔄 Unknown intent "${result.intent}" with dimensions, mapping to product_inquiry`);
      mappedIntent = INTENTS.PRODUCT_INQUIRY;
    }

    // ===== POST-CLASSIFICATION VALIDATION =====
    // Catch hallucinated locations: if AI extracted a location that doesn't
    // actually appear in the message, it's likely a hallucination
    if (result.entities?.location) {
      const extractedLocation = result.entities.location.toLowerCase();
      const msgLower = message.toLowerCase();
      // Check if the location string actually appears in the message
      if (!msgLower.includes(extractedLocation)) {
        console.log(`⚠️ Hallucinated location "${result.entities.location}" not found in message, removing`);
        result.entities.location = null;
        // If intent was location-based, reclassify as product_inquiry
        if (mappedIntent === INTENTS.LOCATION_MENTION || mappedIntent === INTENTS.SHIPPING_QUERY) {
          console.log(`⚠️ Overriding location-based intent "${mappedIntent}" → product_inquiry`);
          mappedIntent = INTENTS.PRODUCT_INQUIRY;
        }
      }
    }

    const classification = {
      intent: mappedIntent || INTENTS.UNCLEAR,
      product: PRODUCTS[result.product?.toUpperCase()] || result.product || PRODUCTS.UNKNOWN,
      entities: {
        width: result.entities?.width || null,
        height: result.entities?.height || null,
        percentage: result.entities?.percentage || null,
        quantity: result.entities?.quantity || null,
        color: result.entities?.color || null,
        borde_length: result.entities?.borde_length || null,
        dimensions: result.entities?.dimensions || null,
        location: result.entities?.location || null,
        matched_size: result.entities?.matched_size || null,
        concerns: result.entities?.concerns || null
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

  // Skip quick classification for long messages — AI handles these better
  if (message.length > 100) {
    console.log(`⚡ Skipping quick classify - message too long (${message.length} chars), needs AI`);
    return null;
  }

  // ===== SPAM / INAPPROPRIATE CONTENT - close conversation immediately =====
  if (/\b(sexual|apetito\s*sexual|sexo|xxx)\b/i.test(msg)) {
    console.log(`🚫 Inappropriate content detected, closing conversation`);
    return { intent: INTENTS.GOODBYE, product: PRODUCTS.UNKNOWN, entities: { spam: true }, confidence: 0.99 };
  }

  // ===== MULTI-QUESTION DETECTION (runs FIRST - before any single-intent patterns) =====
  // Dynamically detect ALL question types in a message (supports 2, 3, or more questions)
  // Only actual QUESTION TYPES here — NOT data signals like dimensions or product names.
  // "Precio malla 6x6" is ONE question, not three.
  const questionIndicators = [
    { intent: 'confirmation', pattern: /\b(s[ií]|las?\s+dos|los?\s+dos|ambos?|ambas?|esa|ese|esas|esos|dale|ok|vale|perfecto|m[eé]?\s*interesa|lo\s*quiero|la\s*quiero)\b/i },
    { intent: 'price_query', pattern: /\b(precio|presio|costo|cu[aá]nto\s*(cuesta|vale|es|está)|qu[eé]\s*precio|en\s+cu[aá]nto|a\s+c[oó]mo)\b/i },
    { intent: 'availability_query', pattern: /\b(medidas?|tamaños?|disponib|stock|tienen|manejan|qu[eé]\s*medidas?)\b/i },
    { intent: 'payment_query', pattern: /\b(pago|pagar|tarjeta|efectivo|transferencia|forma\s*de\s*pago|meses)\b/i },
    { intent: 'location_query', pattern: /\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde\s*(est[aá]n|quedan|se\s*encuentran)|soy\s+de\s+\w|recog[ei]r|domicilio)\b/i },
    { intent: 'shipping_query', pattern: /\b(env[ií]o|envi[aá]n|entrega|[ly]lega|mandan|cu[aá]nto\s*tarda)\b/i },
    { intent: 'installation_query', pattern: /\b(instal[ae]n?|ponen|colocan|c[oó]mo\s*se\s*(instala|pone|coloca))\b/i },
    { intent: 'product_inquiry', pattern: /\b(informes?|info|caracter[ií]sticas?|especificaciones?|de\s*qu[eé]\s*(es|est[aá]|material))\b/i },
    { intent: 'delivery_time_query', pattern: /\b(cu[aá]nto\s*tarda|cu[aá]ntos?\s*d[ií]as?|tiempo\s*de\s*entrega|cuando\s*[ly]lega)\b/i }
  ];

  // Find all matching question types (partial patterns are OK here because
  // we're detecting COMPLEXITY, not classifying intent — 2+ matches → MULTI_QUESTION → AI)
  const detectedIntents = [];
  for (const { intent, pattern } of questionIndicators) {
    if (pattern.test(msg)) {
      detectedIntents.push(intent);
    }
  }

  // If 2+ intents detected, return as MULTI_QUESTION so AI can sort out compound messages
  if (detectedIntents.length >= 2) {
    console.log(`⚡ Multi-question detected: ${detectedIntents.join(', ')}`);
    return {
      intent: INTENTS.MULTI_QUESTION,
      product: PRODUCTS.UNKNOWN,
      entities: { subIntents: detectedIntents },
      confidence: 0.85
    };
  }

  // First, check DB intent patterns (highest priority for custom patterns)
  if (dbIntents && dbIntents.length > 0) {
    for (const intent of dbIntents) {
      if (!intent.patterns || intent.patterns.length === 0) continue;

      for (const pattern of intent.patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(msg)) {
            console.log(`✅ Pattern match for intent "${intent.key}": ${pattern}`);

            // Extract dimensions if present (for price queries with sizes like "7x11")
            const entities = {};
            const dimPattern = /(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?\s*(?:x|×|\*|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m(?:ts|etros?)?\.?)?/i;
            const dimMatch = msg.match(dimPattern);
            if (dimMatch) {
              const d1 = parseFloat(dimMatch[1].replace(',', '.'));
              const d2 = parseFloat(dimMatch[2].replace(',', '.'));
              if (!isNaN(d1) && !isNaN(d2)) {
                entities.width = Math.min(d1, d2);
                entities.height = Math.max(d1, d2);
                entities.dimensions = `${d1}x${d2}`;
                console.log(`⚡ Extracted dimensions from DB pattern match: ${d1}x${d2}`);
              }
            }

            // Extract color if present
            const colorPattern = /\b(negro|negra|beige|rojo|roja|verde|azul|blanco|blanca|gris|cafe|café|marr[oó]n)\b/i;
            const colorMatch = msg.match(colorPattern);
            if (colorMatch) {
              entities.color = colorMatch[1].toLowerCase();
              console.log(`⚡ Extracted color from DB pattern match: ${entities.color}`);
            }

            return {
              intent: intent.key,
              product: PRODUCTS.UNKNOWN,
              entities,
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

  // Thanks — standalone or with common suffixes like "gracias por la información"
  if (/^(gracias|muchas\s*gracias|thanks|thx)(\s+(por\s+(la\s+)?(informaci[oó]n|info|ayuda|atenci[oó]n|tu\s+ayuda|su\s+ayuda|tu\s+atenci[oó]n|su\s+atenci[oó]n|responder|contestar|todo)|muy\s+amable|es\s+todo|eso\s+es\s+todo))?[\s!?.]*$/i.test(msg)) {
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

  // ===== FULL-MESSAGE-ONLY PATTERNS =====
  // Quick classifier only handles messages where regex matches the ENTIRE sentence.
  // If a message is more complex (compound intents, extra context), let AI sort it out.

  // Simple confirmations — must be the ENTIRE message
  if (/^(s[ií]|a?ok|okey|va|vale|claro|perfecto|exacto|correcto|eso|esa|ese|dale|listo|órale|simon|simón|de\s*acuerdo|entendido|m[eé]?\s*interesa|lo\s*quiero|la\s*quiero)[\s!?.👍👌✅🙌💪]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Polite confirmations — must be the ENTIRE message
  // "si por favor", "sí porfa", "por favor sí", "si x favor"
  if (/^(s[ií]\s+(por\s*fa(v|b)or|x\s*fa(v|b)or|porfa)|por\s*fa(v|b)or(\s+s[ií])?|s[ií]\s+x\s*fa(v|b)or)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Polite request confirmations — must be the ENTIRE message
  // "si me la comparte", "pásame info", "compártame por favor"
  if (/^(por\s*favor\s+)?(s[ií]\s*)?(me\s+)?(la|lo|las|los)?\s*(comparte|pasa|manda|env[ií]a|muestra|ense[ñn]a)(\s+por\s*favor)?[\s!?.]*$/i.test(msg) ||
      /^(comp[aá]rt[ae]me|p[aá]s[ae]me|m[aá]nd[ae]me|env[ií][ae]me|mu[eé]str[ae]me)(\s+(la\s+)?(info|informaci[oó]n|los\s+precios?))?(\s+por\s*favor)?[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Emoji-only confirmations — must be the ENTIRE message
  if (/^[👍👌✅🙌💪]+$/i.test(msg)) {
    return { intent: INTENTS.CONFIRMATION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.85 };
  }

  // Simple rejections — must be the ENTIRE message
  if (/^(no|nop|nope|nel|negativo)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.REJECTION, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // Simple price query — must be the ENTIRE message (includes common misspelling "presio")
  if (/^(precio|presio|precios?|costos?)[\s!?.]*$/i.test(msg)) {
    return { intent: INTENTS.PRICE_QUERY, product: PRODUCTS.UNKNOWN, entities: {}, confidence: 0.90 };
  }

  // ===== EVERYTHING ELSE → AI =====
  // If regex can't match the full message, let the AI classifier handle it.
  // AI is better at understanding compound messages, typos, and context.
  return null;
}

/**
 * Normalize common product name misspellings before classification.
 * In Mexican Spanish, "n" before "b/p" is a very common error (should be "m").
 * e.g., "sonbra" → "sombra", "sonbras" → "sombras"
 *
 * @param {string} text - User message
 * @returns {string} - Normalized text
 */
function normalizeProductSpelling(text) {
  if (!text) return text;

  let normalized = text;

  // "sonbra/sonbras/zonbra" → "sombra/sombras" (n→m before b, z→s)
  normalized = normalized.replace(/\b(mallas?\s+)?(s|z)onbras?\b/gi, (match, prefix) => {
    const fixed = match.replace(/(s|z)onbra/gi, 'sombra');
    console.log(`🔤 Spelling fix: "${match}" → "${fixed}"`);
    return fixed;
  });

  return normalized;
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

  // Normalize common product name misspellings before any classification
  // Also convert Spanish number words to digits so classifiers see "3 por 4" instead of "tres por cuatro"
  const { convertSpanishNumbers } = require("../utils/spanishNumbers");
  const normalizedMessage = convertSpanishNumbers(normalizeProductSpelling(message));

  // Load DB intents for pattern matching and AI prompt
  const dbIntents = await getIntentsFromDB();

  // Try quick classification first (includes DB patterns)
  const quickResult = quickClassify(normalizedMessage, dbIntents);
  if (quickResult) {
    console.log(`⚡ Quick classification (no AI):`, quickResult.intent);
    console.log(`🧠 ===== END LAYER 1 =====\n`);
    return { ...quickResult, source: "quick" };
  }

  // Use AI classification
  const aiResult = await classifyMessage(normalizedMessage, sourceContext, conversationFlow, campaignContext);
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
  normalizeProductSpelling,
  logClassification,
  buildCampaignContext,
  clearIntentCache,
  getIntentsFromDB,
  clearCatalogCache,
  getProductCatalogForPrompt,
  INTENTS,
  PRODUCTS
};
