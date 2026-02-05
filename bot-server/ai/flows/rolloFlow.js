// ai/flows/rolloFlow.js
// State machine for roll (rollo) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const ZipCode = require("../../models/ZipCode");
const { INTENTS } = require("../classifier");

// Import existing utilities - USE THESE
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductDisplayName,
  getProductInterest
} = require("../utils/productEnricher");

/**
 * Flow stages for rollo
 */
const STAGES = {
  START: "start",
  AWAITING_TYPE: "awaiting_type",  // Ask what type of rollo (malla sombra, groundcover, monofilamento)
  AWAITING_WIDTH: "awaiting_width",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  AWAITING_ZIP: "awaiting_zip",
  COMPLETE: "complete"
};

/**
 * Rollo types
 */
const ROLLO_TYPES = {
  MALLA_SOMBRA: "malla_sombra",
  GROUNDCOVER: "groundcover",
  MONOFILAMENTO: "monofilamento"
};

/**
 * Detect rollo type from user message
 * Returns the type if detected, null if ambiguous
 */
function detectRolloType(msg, convo = null) {
  if (!msg) return null;
  const m = msg.toLowerCase();

  // Check conversation context first
  if (convo?.productInterest === 'groundcover' || convo?.lastIntent?.includes('groundcover')) {
    return ROLLO_TYPES.GROUNDCOVER;
  }
  if (convo?.productInterest === 'monofilamento' || convo?.lastIntent?.includes('monofilamento')) {
    return ROLLO_TYPES.MONOFILAMENTO;
  }

  // Groundcover indicators
  if (/\b(groundcover|ground\s*cover|antimaleza|anti\s*maleza|para\s+el\s+suelo|suelo|piso|maleza|hierba|yerbas?)\b/i.test(m)) {
    return ROLLO_TYPES.GROUNDCOVER;
  }

  // Monofilamento indicators
  if (/\b(monofilamento|mono\s*filamento)\b/i.test(m)) {
    return ROLLO_TYPES.MONOFILAMENTO;
  }

  // Malla sombra indicators
  if (/\b(malla\s*sombra|raschel|sombra|sombreado|porcentaje)\b/i.test(m) ||
      /\b(35|50|70|80|90)\s*(%|porciento|por\s*ciento)/i.test(m)) {
    return ROLLO_TYPES.MALLA_SOMBRA;
  }

  // Check if they explicitly mention the roll type context
  if (convo?.productSpecs?.rolloType) {
    return convo.productSpecs.rolloType;
  }

  return null; // Ambiguous - need to ask
}

/**
 * Cache for available rollo widths (refreshed every 5 minutes)
 */
let rolloWidthsCache = null;
let rolloWidthsCacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get available rollo widths from database
 */
async function getAvailableWidths() {
  if (rolloWidthsCache && Date.now() < rolloWidthsCacheExpiry) {
    return rolloWidthsCache;
  }

  try {
    const products = await ProductFamily.find({
      sellable: true,
      active: true,
      size: /\d+x100/i  // Rollo pattern: NxN100
    }).select('size').lean();

    // Extract unique widths from size strings like "2x100m", "4x100m"
    const widths = new Set();
    for (const p of products) {
      const match = p.size?.match(/^(\d+(?:\.\d+)?)\s*x\s*100/i);
      if (match) {
        widths.add(parseFloat(match[1]));
      }
    }

    rolloWidthsCache = [...widths].sort((a, b) => a - b);
    rolloWidthsCacheExpiry = Date.now() + CACHE_TTL;
    console.log(`🔄 Rollo widths cache refreshed: ${rolloWidthsCache.join(', ')}m`);
    return rolloWidthsCache;
  } catch (err) {
    console.error("Error fetching rollo widths:", err.message);
    return [2, 4]; // Fallback
  }
}

/**
 * Valid percentages
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

/**
 * Normalize width to closest available
 */
async function normalizeWidth(width) {
  if (!width) return null;

  const availableWidths = await getAvailableWidths();

  // Find closest match
  let closest = null;
  let minDiff = Infinity;

  for (const w of availableWidths) {
    const diff = Math.abs(width - w);
    if (diff < minDiff && diff <= 1) { // Within 1m tolerance
      minDiff = diff;
      closest = w;
    }
  }

  return closest;
}

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Parse zip code from message and look up location
 */
async function parseAndLookupZipCode(msg) {
  if (!msg) return null;

  const patterns = [
    /\b(?:c\.?p\.?|codigo\s*postal|cp)\s*[:\.]?\s*(\d{5})\b/i,
    /\bal\s+(\d{5})\b/i,
    /\b(\d{5})\b(?=\s*(?:$|,|\.|\s+(?:para|en|a)\b))/i,
    /\b(\d{5})\b/  // Fallback: any 5-digit number
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const code = match[1];
      try {
        const location = await ZipCode.lookup(code);
        if (location) {
          console.log(`📍 Zip code ${code} → ${location.city}, ${location.state}`);
          return location;
        }
      } catch (err) {
        console.error(`❌ Zip code lookup failed:`, err.message);
      }
    }
  }

  return null;
}

/**
 * Find matching sellable roll products
 */
async function findMatchingProducts(width, percentage = null) {
  try {
    // Build query for rolls - match by size pattern
    // Roll sizes are like "2x100m", "4x100m"
    const widthSearch = String(width).replace('.00', '');
    const sizeRegex = new RegExp(`${widthSearch}.*100`, 'i');

    console.log(`🔍 Searching for roll ${widthSearch}m x 100m`);

    const query = {
      sellable: true,
      active: true,
      $or: [
        { size: sizeRegex },
        { name: new RegExp(`${widthSearch}.*100`, 'i') }
      ]
    };

    // Add percentage filter if specified
    if (percentage) {
      query.name = new RegExp(`${percentage}\\s*%`, 'i');
    }

    const products = await ProductFamily.find(query)
      .sort({ price: 1 })
      .lean();

    console.log(`🔍 Found ${products.length} matching roll products`);

    return products;
  } catch (error) {
    console.error("❌ Error finding roll products:", error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'rollo' ? STAGES.COMPLETE : STAGES.START,
    rolloType: specs.rolloType || null,  // malla_sombra, groundcover, monofilamento
    width: specs.width || null,
    percentage: specs.percentage || null,
    quantity: specs.quantity || null,
    color: specs.color || null,
    zipCode: convo?.zipCode || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  // Must know rollo type first (only for malla sombra do we continue in this flow)
  if (!state.rolloType) return STAGES.AWAITING_TYPE;
  if (!state.width) return STAGES.AWAITING_WIDTH;
  if (!state.percentage) return STAGES.AWAITING_PERCENTAGE;
  if (!state.zipCode) return STAGES.AWAITING_ZIP;
  return STAGES.COMPLETE;
}

/**
 * Handle rollo flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  let state = getFlowState(convo);

  console.log(`📦 Rollo flow - Current state:`, state);
  console.log(`📦 Rollo flow - Intent: ${intent}, Entities:`, entities);

  // FIRST: Detect or confirm rollo type
  if (!state.rolloType) {
    const detectedType = detectRolloType(userMessage, convo);
    if (detectedType) {
      console.log(`📦 Rollo flow - Detected type: ${detectedType}`);
      state.rolloType = detectedType;

      // If it's groundcover or monofilamento, redirect to those flows
      if (detectedType === ROLLO_TYPES.GROUNDCOVER) {
        console.log(`📦 Rollo flow - Redirecting to groundcover flow`);
        await updateConversation(psid, {
          productInterest: "groundcover",
          lastIntent: "groundcover_inquiry",
          productSpecs: { productType: "groundcover", updatedAt: new Date() }
        });
        return {
          type: "text",
          text: "¡Perfecto! El Groundcover (malla antimaleza) es ideal para cubrir el suelo.\n\n" +
                "Lo manejamos en rollos de:\n• 2m x 100m\n• 4m x 100m\n\n" +
                "¿Qué ancho necesitas?",
          redirect: "groundcover"  // Signal to flow router
        };
      }

      if (detectedType === ROLLO_TYPES.MONOFILAMENTO) {
        console.log(`📦 Rollo flow - Redirecting to monofilamento flow`);
        await updateConversation(psid, {
          productInterest: "monofilamento",
          lastIntent: "monofilamento_inquiry",
          productSpecs: { productType: "monofilamento", updatedAt: new Date() }
        });
        return {
          type: "text",
          text: "¡Claro! El monofilamento es una malla más resistente.\n\n" +
                "¿Qué porcentaje de sombra necesitas? Manejamos 35%, 50%, 70% y 80%.",
          redirect: "monofilamento"
        };
      }
    }
  }

  // SECOND: Try to parse width directly from user message
  // Patterns: "de 4 mts", "4 metros", "4.20", "el de 4", "2.10m", "2 metros"
  if (!state.width && userMessage) {
    const widthPatterns = [
      /\b(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:m(?:ts?|etros?)?)\b/i,  // "de 4 mts", "4 metros", "4.20m"
      /\b(?:el\s+)?(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:ancho)?\b/i,   // "el de 4", "4 ancho"
      /\b(\d+(?:[.,]\d+)?)\s*[xX×]\s*100\b/i                       // "4x100", "4.20x100"
    ];

    for (const pattern of widthPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        const parsedWidth = parseFloat(match[1].replace(',', '.'));
        const normalized = await normalizeWidth(parsedWidth);
        if (normalized) {
          console.log(`📦 Rollo flow - Parsed width from message: ${parsedWidth} → ${normalized}m`);
          state.width = normalized;
          break;
        }
      }
    }
  }

  // Update state with any new entities from classifier
  if (!state.width && entities.width) {
    const normalized = await normalizeWidth(entities.width);
    if (normalized) state.width = normalized;
  }

  // Parse percentage from user message - both numeric and natural language
  if (!state.percentage && userMessage) {
    // Try numeric percentage: "35%", "al 50%", "50 porciento"
    // IMPORTANT: Require % or porciento suffix to avoid matching dimensions like "4.20"
    const numericMatch = userMessage.match(/\b(\d{2,3})\s*(%|porciento|por\s*ciento)/i);
    if (numericMatch) {
      const pct = parseInt(numericMatch[1]);
      if (VALID_PERCENTAGES.includes(pct)) {
        console.log(`📦 Rollo flow - Parsed percentage from message: ${pct}%`);
        state.percentage = pct;
      }
    }

    // Try natural language descriptions
    if (!state.percentage) {
      // "menos sombra", "mas delgado", "menor", "poca sombra" → 35%
      if (/\b(menos\s*sombra|menor\s*sombra|poca\s*sombra|m[aá]s\s*delgad[oa]|delgad[oa]|m[aá]s\s*fin[oa]|fin[oa])\b/i.test(userMessage)) {
        console.log(`📦 Rollo flow - Natural language "menos sombra/delgado" → 35%`);
        state.percentage = 35;
      }
      // "mas sombra", "mas grueso", "mayor", "mucha sombra" → 90%
      else if (/\b(m[aá]s\s*sombra|mayor\s*sombra|mucha\s*sombra|m[aá]s\s*grues[oa]|grues[oa]|m[aá]s\s*denso|denso)\b/i.test(userMessage)) {
        console.log(`📦 Rollo flow - Natural language "mas sombra/grueso" → 90%`);
        state.percentage = 90;
      }
    }
  }

  if (!state.percentage && entities.percentage) {
    state.percentage = entities.percentage;
  }
  // Parse quantity from user message
  if (!state.quantity && userMessage) {
    const msg = userMessage.toLowerCase();
    // "un par" = 2
    if (/\b(un\s*par|par\s+de)\b/i.test(msg)) {
      console.log(`📦 Rollo flow - Parsed quantity "un par" → 2`);
      state.quantity = 2;
    }
    // "uno", "una", "1", "ocuparía uno", "necesito uno"
    else if (/\b(un[oa]?|1)\s*(rollo|pza|pieza)?\b/i.test(msg) || /\bocupar[ií]a\s+un[oa]?\b/i.test(msg)) {
      console.log(`📦 Rollo flow - Parsed quantity "uno" → 1`);
      state.quantity = 1;
    }
    // "dos", "2"
    else if (/\b(dos|2)\s*(rollos?|pzas?|piezas?)?\b/i.test(msg)) {
      console.log(`📦 Rollo flow - Parsed quantity "dos" → 2`);
      state.quantity = 2;
    }
    // "tres", "3"
    else if (/\b(tres|3)\s*(rollos?|pzas?|piezas?)?\b/i.test(msg)) {
      console.log(`📦 Rollo flow - Parsed quantity "tres" → 3`);
      state.quantity = 3;
    }
    // Generic number
    else {
      const qtyMatch = msg.match(/\b(\d+)\s*(rollos?|pzas?|piezas?)?\b/i);
      if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        if (qty > 0 && qty <= 100) {
          console.log(`📦 Rollo flow - Parsed quantity → ${qty}`);
          state.quantity = qty;
        }
      }
    }
  }

  if (!state.quantity && entities.quantity) {
    state.quantity = entities.quantity;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.zipCode) {
    state.zipCode = entities.zipCode;
  }
  // Also check if zip was already in convo
  if (!state.zipCode && convo?.zipCode) {
    state.zipCode = convo.zipCode;
  }
  // Try to parse zip from user message if we're expecting it
  if (!state.zipCode && userMessage) {
    const zipInfo = await parseAndLookupZipCode(userMessage);
    if (zipInfo) {
      state.zipCode = zipInfo.code;
      state.zipInfo = zipInfo; // Store full info for response
    }
  }

  const stage = determineStage(state);
  let response;

  switch (stage) {
    case STAGES.AWAITING_TYPE:
      response = handleAwaitingType(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_WIDTH:
      response = await handleAwaitingWidth(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_PERCENTAGE:
      response = handleAwaitingPercentage(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_ZIP:
      response = handleAwaitingZip(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = await handleStart(sourceContext);
  }

  // Save updated specs
  const updateData = {
    lastIntent: `roll_${stage}`,
    productInterest: "rollo",
    productSpecs: {
      productType: "rollo",
      rolloType: state.rolloType,  // malla_sombra, groundcover, monofilamento
      width: state.width,
      length: 100,
      percentage: state.percentage,
      quantity: state.quantity,
      color: state.color,
      updatedAt: new Date()
    }
  };

  // Save zip code at conversation level (not just in specs)
  if (state.zipCode) {
    updateData.zipCode = state.zipCode;
  }
  if (state.zipInfo) {
    updateData.city = state.zipInfo.city;
    updateData.stateMx = state.zipInfo.state;
  }

  await updateConversation(psid, updateData);

  return response;
}

/**
 * Handle awaiting type - ask what kind of rollo they need
 */
function handleAwaitingType(intent, state, sourceContext) {
  return {
    type: "text",
    text: "¿Para qué lo necesitas?\n\n" +
          "• Para dar **sombra** (malla sombra raschel)\n" +
          "• Para cubrir el **suelo** (groundcover/antimaleza)"
  };
}

/**
 * Handle start - user just mentioned rolls (type already known)
 */
async function handleStart(sourceContext) {
  const widths = await getAvailableWidths();
  const widthList = widths.map(w => `• ${w}m x 100m`).join('\n');

  return {
    type: "text",
    text: `¡Claro! Manejamos rollos de malla sombra en estos anchos:\n\n${widthList}\n\n¿Qué ancho necesitas?`
  };
}

/**
 * Handle awaiting width stage
 */
async function handleAwaitingWidth(intent, state, sourceContext) {
  const widths = await getAvailableWidths();
  const widthOptions = widths.map(w => `${w}m`).join(' o ');
  const widthList = widths.map(w => `• ${w}m x 100m`).join('\n');

  if (intent === INTENTS.CONFIRMATION) {
    return {
      type: "text",
      text: `¿Cuál ancho te interesa? ¿${widthOptions}?`
    };
  }

  return {
    type: "text",
    text: `Los rollos los manejamos en:\n\n${widthList}\n\n¿Qué ancho necesitas?`
  };
}

/**
 * Handle awaiting percentage stage
 */
function handleAwaitingPercentage(intent, state, sourceContext) {
  return {
    type: "text",
    text: `Perfecto, rollo de ${state.width}m x 100m.\n\n` +
          `Lo tenemos desde 35% hasta 90% de sombra.\n\n` +
          `¿Qué porcentaje necesitas?`
  };
}

/**
 * Handle awaiting zip code stage
 */
function handleAwaitingZip(intent, state, sourceContext) {
  return {
    type: "text",
    text: `✅ Perfecto, te confirmo:\n\n` +
          `📦 Rollo de ${state.width}m x 100m al ${state.percentage}%\n` +
          `📊 Cantidad: ${state.quantity || 1} rollo${(state.quantity || 1) > 1 ? 's' : ''}\n\n` +
          `Para calcular el envío, ¿me compartes tu código postal?`
  };
}

/**
 * Handle complete - we have width and percentage
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const quantity = state.quantity || 1;

  // Check if already asked quantity
  const alreadyAskedQuantity = convo?.lastIntent === "roll_complete";
  const userProvidedQuantity = intent === INTENTS.QUANTITY_SPECIFICATION || state.quantity;

  // If user is confirming quantity, give short response
  if (alreadyAskedQuantity && userProvidedQuantity) {
    const locationText = state.zipInfo
      ? ` a ${state.zipInfo.city}, ${state.zipInfo.state}`
      : '';

    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Roll quote: ${quantity}x ${state.width}m x 100m @ ${state.percentage}%${locationText}`,
      handoffTimestamp: new Date()
    });

    const qtyText = quantity > 1 ? `los ${quantity} rollos` : "el rollo";
    let responseText = `¡Perfecto! Un especialista te contactará para cotizarte ${qtyText}.`;
    if (state.zipInfo) {
      responseText += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
    }

    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    responseText += `\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;

    return {
      type: "text",
      text: responseText
    };
  }

  // Try to find matching products in inventory
  const products = await findMatchingProducts(state.width, state.percentage);

  if (products.length > 0) {
    const product = products[0];

    // ENRICH WITH TREE CONTEXT
    const displayName = await getProductDisplayName(product, 'short');
    const productInterest = await getProductInterest(product);

    if (productInterest) {
      await updateConversation(psid, { productInterest });
    }

    // Check for wholesale
    if (quantity && product.wholesaleEnabled && product.wholesaleMinQty) {
      if (quantity >= product.wholesaleMinQty) {
        const { handleWholesaleRequest } = require("../utils/wholesaleHandler");
        const wholesaleResponse = await handleWholesaleRequest(product, quantity, psid, convo);
        if (wholesaleResponse) return wholesaleResponse;
      }
    }

    // Get preferred link
    const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
    const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

    if (productUrl && userProvidedQuantity) {
      // Has link and quantity - provide link
      const trackedLink = await generateClickLink(psid, productUrl, {
        productName: product.name,
        productId: product._id,
        city: state.zipInfo?.city || convo?.city,
        stateMx: state.zipInfo?.state || convo?.stateMx
      });

      // Clarify "c/u" when asking for multiple items
      const priceText = product.price
        ? ` por ${formatMoney(product.price)}${quantity > 1 ? ' c/u' : ''}`
        : "";

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      let locationMention = "";
      if (state.zipInfo) {
        locationMention = `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
      }

      return {
        type: "text",
        text: `¡Perfecto! Tenemos el ${displayName}${priceText}.\n\n` +
              `🛒 Cómpralo aquí:\n${trackedLink}${wholesaleMention}${locationMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }
  }

  // No product found or no quantity yet - hand off or ask quantity
  if (userProvidedQuantity) {
    const locationText = state.zipInfo
      ? ` a ${state.zipInfo.city}, ${state.zipInfo.state}`
      : '';

    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Roll quote: ${quantity}x ${state.width}m x 100m @ ${state.percentage}%${locationText}`,
      handoffTimestamp: new Date()
    });

    let responseText = `Perfecto, ${quantity} rollo${quantity > 1 ? 's' : ''} de ${state.width}m x 100m al ${state.percentage}%.`;
    if (state.zipInfo) {
      responseText += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
    }

    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    responseText += `\n\nUn especialista te contactará con el precio.\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;

    return {
      type: "text",
      text: responseText
    };
  } else {
    return {
      type: "text",
      text: `Tenemos el rollo de ${state.width}m x 100m al ${state.percentage}%.\n\n` +
            `¿Cuántos rollos necesitas?`
    };
  }
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  if (product === "rollo") return true;
  if (convo?.productSpecs?.productType === "rollo") return true;
  if (convo?.lastIntent?.startsWith("roll_")) return true;
  if (sourceContext?.ad?.product === "rollo") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
