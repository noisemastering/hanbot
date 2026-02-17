// ai/flows/rolloFlow.js
// State machine for roll (rollo) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const ZipCode = require("../../models/ZipCode");
const { INTENTS } = require("../classifier");
const { isBusinessHours } = require("../utils/businessHours");
const { parseAndLookupZipCode: sharedParseAndLookupZipCode, isQueretaroLocation, getQueretaroPickupMessage } = require("../utils/preHandoffCheck");

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
  AWAITING_QUANTITY: "awaiting_quantity",
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
      /\b\d{2,3}\s*(%|porciento|por\s*ciento)/i.test(m)) {
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

    const sorted = [...widths].sort((a, b) => a - b);
    if (sorted.length > 0) {
      rolloWidthsCache = sorted;
      rolloWidthsCacheExpiry = Date.now() + CACHE_TTL;
      console.log(`🔄 Rollo widths cache refreshed: ${rolloWidthsCache.join(', ')}m`);
    }
    return sorted.length > 0 ? sorted : [2, 4]; // Fallback if no products found
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

// parseAndLookupZipCode is now shared — use the import from preHandoffCheck
const parseAndLookupZipCode = sharedParseAndLookupZipCode;

/**
 * Find matching sellable roll products
 */
async function findMatchingProducts(width, percentage = null) {
  try {
    // Build query for rolls - match by size pattern
    // Roll sizes are like "2x100m", "4x100m"
    const widthSearch = String(width).replace('.00', '');
    const sizeRegex = new RegExp(`${widthSearch}.*100`, 'i');

    console.log(`🔍 Searching for roll ${widthSearch}m x 100m${percentage ? ` at ${percentage}%` : ''}`);

    // Use $and to avoid conflicts between $or.name and percentage name filter
    const conditions = [
      { sellable: true },
      { active: true },
      { $or: [
        { size: sizeRegex },
        { name: new RegExp(`${widthSearch}.*100`, 'i') }
      ]}
    ];

    // Add percentage filter if specified
    if (percentage) {
      conditions.push({
        $or: [
          { name: new RegExp(`${percentage}\\s*%`, 'i') },
          { name: new RegExp(`${percentage}\\s*por\\s*ciento`, 'i') }
        ]
      });
    }

    const products = await ProductFamily.find({ $and: conditions })
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
  if (!state.rolloType) return STAGES.AWAITING_TYPE;
  if (!state.width) return STAGES.AWAITING_WIDTH;
  if (state.rolloType === ROLLO_TYPES.MALLA_SOMBRA && !state.percentage) return STAGES.AWAITING_PERCENTAGE;
  if (!state.quantity) return STAGES.AWAITING_QUANTITY;
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

  // SECOND: Extract width — classifier entities first, regex fallback
  if (!state.width && entities.width) {
    const normalized = await normalizeWidth(entities.width);
    if (normalized) {
      state.width = normalized;
      console.log(`📦 Rollo flow - Using classifier entity: ${entities.width} → ${normalized}m`);
    }
  }
  // Regex fallback: parse width from user message
  // Patterns: "de 4 mts", "4 metros", "4.20", "el de 4", "2.10m", "2 metros"
  if (!state.width && userMessage) {
    // Guard: if message contains NxM where neither side is ~100, skip width extraction
    // These dimensions belong to a different product (e.g., 11x5 = confeccionada)
    const fullDimCheck = userMessage.match(/\b(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)\b/);
    const hasNonRollDimensions = fullDimCheck &&
      parseFloat(fullDimCheck[1].replace(',', '.')) !== 100 &&
      parseFloat(fullDimCheck[2].replace(',', '.')) !== 100;

    if (hasNonRollDimensions) {
      console.log(`📦 Rollo flow - Dimensions ${fullDimCheck[1]}x${fullDimCheck[2]} don't match roll pattern, skipping width extraction`);
    } else {
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
  }

  // Extract percentage — classifier entities first, regex fallback
  if (!state.percentage && entities.percentage) {
    state.percentage = entities.percentage;
    console.log(`📦 Rollo flow - Using classifier entity percentage: ${entities.percentage}%`);
  }
  // Regex fallback: parse percentage from user message - both numeric and natural language
  if (!state.percentage && userMessage) {
    // Try numeric percentage: "35%", "al 50%", "50 porciento"
    // IMPORTANT: Require % or porciento suffix to avoid matching dimensions like "4.20"
    const numericMatch = userMessage.match(/\b(\d{2,3})\s*(%|porciento|por\s*ciento)/i);
    if (numericMatch) {
      const pct = parseInt(numericMatch[1]);
      if (pct >= 10 && pct <= 100) {
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

  // Parse quantity from user message
  if (!state.quantity && userMessage) {
    // Strip dimensions, percentages, and width measurements to avoid false positives
    // e.g. "Precio de 4 x 100 al 30%" → "Precio de   al "
    const qtyMsg = userMessage.toLowerCase()
      .replace(/\b\d+(?:[.,]\d+)?\s*[xX×*]\s*\d+\b/g, '')       // Remove NxN dimensions
      .replace(/\b\d{2,3}\s*(%|porciento|por\s*ciento)\b/gi, '') // Remove percentages
      .replace(/\b(?:de\s+)?\d+(?:[.,]\d+)?\s*(?:m(?:ts?|etros?)?)\b/gi, ''); // Remove "de 4 mts"

    // "un par" = 2
    if (/\b(un\s*par|par\s+de)\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "un par" → 2`);
      state.quantity = 2;
    }
    // "uno", "una", "1", "ocuparía uno", "necesito uno"
    else if (/\b(un[oa]?|1)\s*(rollo|pza|pieza)?\b/i.test(qtyMsg) || /\bocupar[ií]a\s+un[oa]?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "uno" → 1`);
      state.quantity = 1;
    }
    // "dos", "2"
    else if (/\b(dos|2)\s*(rollos?|pzas?|piezas?)?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "dos" → 2`);
      state.quantity = 2;
    }
    // "tres", "3"
    else if (/\b(tres|3)\s*(rollos?|pzas?|piezas?)?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "tres" → 3`);
      state.quantity = 3;
    }
    // Generic number only if explicitly followed by "rollos/pzas/piezas"
    else {
      const qtyMatch = qtyMsg.match(/\b(\d+)\s+(rollos?|pzas?|piezas?)\b/i);
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

  let response;

  // ====== AD PRODUCTS — show all options with prices when asked ======
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;
  if (adProductIds?.length && !state.width) {
    const askingOptions = [INTENTS.CATALOG_REQUEST, INTENTS.PRODUCT_INQUIRY, INTENTS.AVAILABILITY_QUERY, INTENTS.PRICE_QUERY].includes(intent);
    if (askingOptions) {
      try {
        const adProducts = await ProductFamily.find({
          _id: { $in: adProductIds },
          sellable: true,
          active: true
        }).sort({ price: 1 }).lean();

        if (adProducts.length > 0) {
          const lines = adProducts.map(p => {
            const price = p.price ? ` - ${formatMoney(p.price)}` : '';
            const size = p.size ? ` ${p.size}` : '';
            return `• ${p.name}${size}${price}`;
          });

          await updateConversation(psid, {
            lastIntent: `roll_awaiting_width`,
            productInterest: "rollo",
            productSpecs: {
              productType: "rollo",
              rolloType: state.rolloType,
              width: state.width,
              length: 100,
              percentage: state.percentage,
              updatedAt: new Date()
            }
          });

          return {
            type: "text",
            text: `¡Claro! Estas son las opciones que manejamos:\n\n${lines.join('\n')}\n\n¿Cuál te interesa?`
          };
        }
      } catch (err) {
        console.error("Error fetching ad products:", err.message);
      }
    }
  }

  // ====== CATALOG / INFO REQUESTS — show available sizes regardless of stage ======
  const infoIntents = [INTENTS.CATALOG_REQUEST, INTENTS.PRODUCT_INQUIRY, INTENTS.AVAILABILITY_QUERY];
  if (infoIntents.includes(intent) && !state.width) {
    response = await handleStart(sourceContext);

    await updateConversation(psid, {
      lastIntent: `roll_start`,
      productInterest: "rollo",
      productSpecs: {
        productType: "rollo",
        rolloType: state.rolloType,
        width: state.width,
        length: 100,
        percentage: state.percentage,
        quantity: state.quantity,
        updatedAt: new Date()
      }
    });

    return response;
  }
  // ====== END CATALOG / INFO REQUESTS ======

  const stage = determineStage(state);

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

    case STAGES.AWAITING_QUANTITY:
      response = await handleAwaitingQuantity(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_ZIP:
      response = await handleAwaitingZip(intent, state, sourceContext, psid, convo);
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
  const widthList = widths.map(w => `${w}m x 100m`).join(' y ');
  const percentageList = VALID_PERCENTAGES.join('%, ') + '%';

  return {
    type: "text",
    text: `¡Claro! Manejamos rollos de malla sombra de ${widthList}, con porcentajes de sombra de ${percentageList}.\n\n¿Qué medida y porcentaje te interesa?`
  };
}

/**
 * Handle awaiting width stage
 */
async function handleAwaitingWidth(intent, state, sourceContext) {
  const widths = await getAvailableWidths();
  const widthOptions = widths.map(w => `${w}m`).join(' o ');
  const widthList = widths.map(w => `${w}m x 100m`).join(' y ');
  const percentageList = VALID_PERCENTAGES.join('%, ') + '%';

  if (intent === INTENTS.CONFIRMATION) {
    return {
      type: "text",
      text: `¿Cuál ancho te interesa? ¿${widthOptions}?`
    };
  }

  return {
    type: "text",
    text: `Contamos con rollos de ${widthList}, con porcentajes de sombra de ${percentageList}.\n\n¿Qué medida y porcentaje te interesa?`
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
 * Handle awaiting quantity stage - show price + ask how many rolls
 */
async function handleAwaitingQuantity(intent, state, sourceContext) {
  let specsText = `rollo de ${state.width}m x 100m`;
  if (state.percentage) {
    specsText += ` al ${state.percentage}%`;
  }

  // Look up product to show price
  const products = await findMatchingProducts(state.width, state.percentage);
  if (products.length > 0) {
    const product = products[0];
    if (product.price) {
      let priceMsg = `El ${specsText} tiene un precio de ${formatMoney(product.price)}`;

      if (product.wholesaleEnabled && product.wholesaleMinQty && product.wholesalePrice) {
        priceMsg += ` (por mayoreo, ${product.wholesaleMinQty}+ rollos, a ${formatMoney(product.wholesalePrice)} c/u)`;
      }

      priceMsg += `. ¿Cuántos rollos necesitas?`;
      return { type: "text", text: priceMsg };
    }
  }

  return {
    type: "text",
    text: `Perfecto, ${specsText}. ¿Cuántos rollos necesitas?`
  };
}

/**
 * Handle awaiting zip code stage
 * If retail quantity + product has ML link → share link (done)
 * Otherwise → ask for zip code to quote shipping
 */
async function handleAwaitingZip(intent, state, sourceContext, psid, convo) {
  let specsText = `rollo de ${state.width}m x 100m`;
  if (state.percentage) {
    specsText += ` al ${state.percentage}%`;
  }

  const products = await findMatchingProducts(state.width, state.percentage);
  const product = products[0];

  if (product) {
    // Check if retail order (below wholesale minimum)
    const isRetail = !product.wholesaleEnabled ||
      !product.wholesaleMinQty ||
      state.quantity < product.wholesaleMinQty;

    if (isRetail) {
      // Try to share ML link for retail purchase
      const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                         product.onlineStoreLinks?.[0]?.url;

      if (productUrl && psid) {
        const trackedLink = await generateClickLink(psid, productUrl, {
          productName: product.name,
          productId: product._id,
          city: convo?.city,
          stateMx: convo?.stateMx
        });

        const priceText = product.price
          ? ` por ${formatMoney(product.price)}${state.quantity > 1 ? ' c/u' : ''}`
          : "";
        const quantityText = state.quantity > 1
          ? `Para ${state.quantity} rollos, `
          : "";

        let wholesaleMention = "";
        if (product.wholesaleEnabled && product.wholesaleMinQty) {
          wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
        }

        // Mark as complete — no need for zip
        state.zipCode = 'ML_PURCHASE';

        return {
          type: "text",
          text: `${quantityText}tenemos el ${specsText}${priceText}. El envío está incluido.\n\n` +
                `🛒 Cómpralo aquí:\n${trackedLink}${wholesaleMention}\n\n` +
                `¿Necesitas algo más?`
        };
      }
    }
  }

  // Wholesale or no ML link — ask for zip code
  return {
    type: "text",
    text: `¿Me puedes proporcionar tu código postal para calcular el envío?`
  };
}

/**
 * Handle complete - we have all specs + zip, hand off to human
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const locationText = state.zipInfo
    ? `${state.zipInfo.city}, ${state.zipInfo.state}`
    : (state.zipCode || 'ubicación no especificada');

  // Build specs summary for handoff
  let specsText = `rollo de ${state.width}m x 100m`;
  if (state.percentage) {
    specsText += ` al ${state.percentage}%`;
  }

  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Rollo: ${specsText} - ${locationText}`,
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  // Send push notification
  const { sendHandoffNotification } = require("../services/pushNotifications");
  sendHandoffNotification(psid, convo, `Rollo: ${specsText} - ${locationText}`).catch(err => {
    console.error("❌ Failed to send push notification:", err);
  });

  let responseText = isBusinessHours()
    ? `¡Perfecto! Un especialista te contactará pronto para cotizarte ${specsText}.`
    : `¡Perfecto! Un especialista te contactará el siguiente día hábil para cotizarte ${specsText}.`;
  if (state.zipInfo) {
    responseText += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
  }

  // Queretaro pickup option
  if (isQueretaroLocation(state.zipInfo, convo)) {
    const pickupMsg = await getQueretaroPickupMessage();
    responseText += `\n\n${pickupMsg}`;
  }

  const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
  responseText += `\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;

  return {
    type: "text",
    text: responseText
  };
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
  handleStart,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
