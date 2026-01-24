// ai/flows/mallaFlow.js
// State machine for malla confeccionada (pre-made shade mesh) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");

// Import existing utilities - USE THESE, don't reinvent
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductLineage,
  formatProductForBot,
  getProductDisplayName,
  getProductInterest
} = require("../utils/productEnricher");

/**
 * Flow stages for malla confeccionada
 */
const STAGES = {
  START: "start",
  AWAITING_DIMENSIONS: "awaiting_dimensions",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  COMPLETE: "complete"
};

/**
 * Valid shade percentages
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

/**
 * Parse dimension string - handles many formats:
 * "4x3", "4 x 3", "4X3", "4×3"
 * "4mx3m", "4m x 3m", "4 m x 3 m"
 * "4mtsx3mts", "4 mts x 3 mts"
 * "4 metros x 3 metros", "4metros x 3"
 * "4 por 3", "4 metros por 3"
 * "de 4 por 3", "una de 4x3"
 *
 * Dimensions are interchangeable: 5x3 = 3x5
 */
function parseDimensions(str) {
  if (!str) return null;

  const s = String(str).toLowerCase();

  // Universal pattern that handles all formats:
  // Optional unit after first number, separator (x/×/por), optional unit after second number
  // Units: m, mts, metros, mt
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?\s*(?:x|×|por)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i;

  const m = s.match(pattern);

  if (!m) return null;

  const dim1 = parseFloat(m[1]);
  const dim2 = parseFloat(m[2]);

  if (Number.isNaN(dim1) || Number.isNaN(dim2)) return null;
  if (dim1 <= 0 || dim2 <= 0) return null;

  // Normalize: smaller dimension first for consistent DB matching
  const width = Math.min(dim1, dim2);
  const height = Math.max(dim1, dim2);

  return {
    width,
    height,
    original: { dim1, dim2 }, // Keep original order if needed
    area: dim1 * dim2,
    normalized: `${width}x${height}`
  };
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'malla' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
    width: specs.width || null,
    height: specs.height || null,
    percentage: specs.percentage || null,
    color: specs.color || null,
    quantity: specs.quantity || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  if (!state.width || !state.height) return STAGES.AWAITING_DIMENSIONS;
  // Percentage is optional for malla - we can show options
  return STAGES.COMPLETE;
}

/**
 * Find matching sellable products by size
 * Searches ONLY sellable products and dimensions are interchangeable
 */
async function findMatchingProducts(width, height, percentage = null, color = null) {
  try {
    // Normalize dimensions (smaller first for consistent matching)
    const w = Math.min(Math.floor(width), Math.floor(height));
    const h = Math.max(Math.floor(width), Math.floor(height));

    // Build size regex - match exactly WxH or HxW (not any combo like WxW or HxH)
    // Formats: "3x5", "5x3", "3x5m", "5 x 3 m", "5 m x 3 m", etc.
    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`,
      'i'
    );

    console.log(`🔍 Searching for malla ${w}x${h}m with regex: ${sizeRegex}`);

    // Query ONLY sellable, active products with matching size
    const query = {
      sellable: true,
      active: true,
      size: sizeRegex
    };

    // Add percentage filter if specified (check in name or attributes)
    if (percentage) {
      query.name = new RegExp(`${percentage}\\s*%`, 'i');
    }

    const products = await ProductFamily.find(query)
      .sort({ price: 1 }) // Cheapest first
      .lean();

    console.log(`🔍 Found ${products.length} matching sellable products for ${w}x${h}m`);

    return products;
  } catch (error) {
    console.error("❌ Error finding malla products:", error);
    return [];
  }
}

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Handle malla flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // Get current state
  let state = getFlowState(convo);

  console.log(`🌐 Malla flow - Current state:`, state);
  console.log(`🌐 Malla flow - Intent: ${intent}, Entities:`, entities);
  console.log(`🌐 Malla flow - User message: "${userMessage}"`);

  // FIRST: Try to parse dimensions directly from user message
  // This is more reliable than depending on classifier entities
  const dimsFromMessage = parseDimensions(userMessage);
  if (dimsFromMessage) {
    console.log(`🌐 Malla flow - Parsed dimensions from message: ${dimsFromMessage.width}x${dimsFromMessage.height}`);
    state.width = dimsFromMessage.width;
    state.height = dimsFromMessage.height;
  }

  // THEN: Check classifier entities as backup
  if (!state.width || !state.height) {
    if (entities.dimensions) {
      const dims = parseDimensions(entities.dimensions);
      if (dims) {
        state.width = dims.width;
        state.height = dims.height;
      }
    }
    // Also check for width/height separately
    if (entities.width && entities.height) {
      state.width = entities.width;
      state.height = entities.height;
    }
  }
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }

  // Check if user is asking for product INFO (not trying to buy yet)
  const infoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|c[oó]mo\s*(es|son)|de\s*qu[eé]\s*(es|est[aá]|material)|qu[eé]\s*(es|son)|especificaciones?|detalles?|descripci[oó]n)\b/i;
  const isAskingForInfo = userMessage && infoRequest.test(userMessage);

  if (isAskingForInfo && !state.width) {
    // User wants to know about the product, not buy yet
    // IMPORTANT: Save context so next message stays in malla flow
    await updateConversation(psid, {
      lastIntent: 'malla_info',
      productInterest: 'malla_sombra',
      productSpecs: {
        productType: 'malla',
        updatedAt: new Date()
      }
    });
    return handleProductInfo(userMessage);
  }

  // Determine current stage
  const stage = determineStage(state);

  // Generate response based on stage
  let response;

  switch (stage) {
    case STAGES.AWAITING_DIMENSIONS:
      response = handleAwaitingDimensions(intent, state, sourceContext, userMessage);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = handleStart(sourceContext);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `malla_${stage}`,
    productInterest: "malla_sombra",
    productSpecs: {
      productType: "malla",
      width: state.width,
      height: state.height,
      percentage: state.percentage,
      color: state.color,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle product info request - user asking about characteristics
 */
function handleProductInfo(userMessage) {
  return {
    type: "text",
    text: "La malla sombra confeccionada viene lista para instalar:\n\n" +
          "• Material: Polietileno de alta densidad (HDPE)\n" +
          "• Color: Beige\n" +
          "• Porcentajes de sombra: 35%, 50%, 70%, 80% y 90%\n" +
          "• Incluye ojillos en todo el perímetro para fácil instalación\n" +
          "• Resistente a rayos UV\n" +
          "• Durable (5+ años de vida útil)\n\n" +
          "Las medidas van desde 2x2m hasta 6x10m. Para medidas más grandes hacemos pedidos especiales.\n\n" +
          "¿Qué medida necesitas?"
  };
}

/**
 * Handle start - user just mentioned malla
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Hola! Tenemos malla sombra confeccionada lista para instalar.\n\n" +
          "Los precios dependen de la medida.\n\n" +
          "¿Qué medida necesitas? (ej: 4x3 metros)"
  };
}

/**
 * Handle awaiting dimensions stage
 */
function handleAwaitingDimensions(intent, state, sourceContext, userMessage = '') {
  // Check if they're asking for info even at this stage
  const infoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|c[oó]mo\s*(es|son)|de\s*qu[eé]|especificaciones?)\b/i;
  if (userMessage && infoRequest.test(userMessage)) {
    return handleProductInfo(userMessage);
  }

  // Check if they're asking what sizes/prices are available
  // "que tamaños son", "qué medidas tienen", "cuáles medidas", "q salen", "cuanto cuestan"
  const sizesListRequest = /\b(qu[eé]|cu[aá]l(es)?)\s*(tamaños?|medidas?|dimensiones?)\s*(son|hay|tienen|manejan|disponibles?)?\b/i.test(userMessage) ||
                           /\b(tamaños?|medidas?)\s*(disponibles?|tienen|manejan|hay)\b/i.test(userMessage) ||
                           /\b(q|que|qué)\s+salen\b/i.test(userMessage);

  if (sizesListRequest) {
    return {
      type: "text",
      text: "Tenemos malla sombra confeccionada en estas medidas:\n\n" +
            "📐 *Pequeñas* (desde $320):\n" +
            "2x2m, 2x3m, 3x3m\n\n" +
            "📐 *Medianas* (desde $450):\n" +
            "3x4m, 4x4m, 3x5m, 4x5m\n\n" +
            "📐 *Grandes* (desde $750):\n" +
            "4x6m, 5x5m, 5x6m, 6x6m\n\n" +
            "📐 *Extra grandes* (desde $1,200):\n" +
            "4x8m, 5x8m, 6x8m, 6x10m\n\n" +
            "¿Cuál te interesa?"
    };
  }

  // If they're asking about prices without dimensions
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "Los precios van desde $320 hasta $1,800 dependiendo de la medida.\n\n" +
            "¿Qué medida necesitas? (ej: 4x3 metros)"
    };
  }

  // General ask for dimensions
  return {
    type: "text",
    text: "Para darte el precio necesito la medida.\n\n" +
          "¿Qué área buscas cubrir? (ej: 4x3 metros, 5x5 metros)"
  };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const { width, height, percentage, color, quantity } = state;

  // Check if dimensions are fractional (we only do whole meters)
  const hasFractions = (width % 1 !== 0) || (height % 1 !== 0);

  if (hasFractions) {
    // Round up to suggest closest sizes
    const roundedWidth = Math.ceil(width);
    const roundedHeight = Math.ceil(height);

    return {
      type: "text",
      text: `Solo manejamos medidas en metros completos.\n\n` +
            `Para ${width}x${height}m, te recomiendo ${roundedWidth}x${roundedHeight}m.\n\n` +
            `¿Te interesa esa medida?`
    };
  }

  // Check if this is a custom order (both sides >= 8m)
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);

  if (minSide >= 8 && maxSide >= 8) {
    // Custom order - needs human handoff
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Custom malla order: ${width}x${height}m${percentage ? ' @ ' + percentage + '%' : ''}`,
      handoffTimestamp: new Date()
    });

    return {
      type: "text",
      text: `La medida ${width}x${height}m es un pedido especial.\n\n` +
            `Un asesor te contactará para cotización personalizada.\n\n` +
            `¿Hay algo más que necesites?`
    };
  }

  // Try to find matching products
  const products = await findMatchingProducts(width, height, percentage, color);

  if (products.length > 0) {
    // Found exact matches - use the first one
    const product = products[0];

    // ENRICH PRODUCT WITH TREE CONTEXT
    const enrichedProduct = await enrichProductWithContext(product);
    const displayName = await getProductDisplayName(product, 'short');
    const productInterest = await getProductInterest(product);

    // Update conversation with proper productInterest from tree
    if (productInterest) {
      await updateConversation(psid, { productInterest });
    }

    // Check for wholesale qualification
    if (quantity && product.wholesaleEnabled && product.wholesaleMinQty) {
      if (quantity >= product.wholesaleMinQty) {
        // Wholesale handoff
        const { handleWholesaleRequest } = require("../utils/wholesaleHandler");
        const wholesaleResponse = await handleWholesaleRequest(product, quantity, psid, convo);
        if (wholesaleResponse) {
          return wholesaleResponse;
        }
      }
    }

    // Get the preferred link from onlineStoreLinks
    const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
    const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

    if (!productUrl) {
      // No link available - hand off to human
      console.log(`⚠️ Product ${product.name} has no online store link`);
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: `Malla ${width}x${height}m - no link available`,
        handoffTimestamp: new Date()
      });

      return {
        type: "text",
        text: `¡Tenemos la ${displayName}! Un asesor te contactará con el precio y link de compra.\n\n¿Necesitas algo más?`
      };
    }

    const trackedLink = await generateClickLink(psid, productUrl, {
      productName: product.name,
      productId: product._id,
      city: convo?.city,
      stateMx: convo?.stateMx
    });

    const quantityText = quantity ? `Para ${quantity} piezas, ` : "";
    const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";

    // Add wholesale mention if product is eligible
    let wholesaleMention = "";
    if (product.wholesaleEnabled && product.wholesaleMinQty && !quantity) {
      wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
    }

    return {
      type: "text",
      text: `¡Perfecto! ${quantityText}Tenemos la ${displayName}${priceText}:\n\n` +
            `${trackedLink}\n\n` +
            `Ahí puedes ver el precio y comprar. El envío está incluido.${wholesaleMention}\n\n` +
            `¿Necesitas algo más?`
    };
  }

  // No exact match - hand off to human for quote
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Malla quote request: ${width}x${height}m${percentage ? ' @ ' + percentage + '%' : ''}`,
    handoffTimestamp: new Date()
  });

  const area = width * height;
  let summary = `Te confirmo tu solicitud:\n\n`;
  summary += `Medida: ${width}m x ${height}m (${area} m²)\n`;

  if (percentage) summary += `Sombra: ${percentage}%\n`;
  if (color) summary += `Color: ${color}\n`;
  if (quantity) summary += `Cantidad: ${quantity}\n`;

  summary += `\nUn asesor te contactará con el precio y disponibilidad.\n\n`;
  summary += `¿Necesitas algo más?`;

  return {
    type: "text",
    text: summary
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // Explicitly about malla sombra (not rolls)
  if (product === "malla_sombra") return true;

  // Already in malla flow
  if (convo?.productSpecs?.productType === "malla") return true;
  if (convo?.lastIntent?.startsWith("malla_")) return true;

  // Check productInterest - handle variations like malla_sombra_raschel, malla_sombra_raschel_agricola, etc.
  const productInterest = convo?.productInterest || '';
  const isMallaInterest = productInterest.startsWith('malla_sombra') || productInterest === 'confeccionada';
  if (isMallaInterest && convo?.productSpecs?.productType !== "rollo") return true;

  // Source indicates malla (also check for variations)
  const adProduct = sourceContext?.ad?.product || '';
  if (adProduct.startsWith('malla_sombra') || adProduct === 'confeccionada') return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  parseDimensions,
  getFlowState,
  determineStage
};
