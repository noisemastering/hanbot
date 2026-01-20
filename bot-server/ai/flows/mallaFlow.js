// ai/flows/mallaFlow.js
// State machine for malla confeccionada (pre-made shade mesh) product flow
// Malla confeccionada comes in specific pre-made sizes, various percentages

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");

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
 * Parse dimension string like "4x3", "4 x 3", "4 por 3", "4 metros x 3"
 */
function parseDimensions(str) {
  if (!str) return null;

  // Pattern 1: "3x4" or "3 x 4"
  let m = String(str).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);

  // Pattern 2: "3 metros x 1.70"
  if (!m) {
    m = String(str).match(/(\d+(?:\.\d+)?)\s*metros?\s*x\s*(\d+(?:\.\d+)?)/i);
  }

  // Pattern 3: "3 por 4" or "3 metros por 4"
  if (!m) {
    m = String(str).match(/(\d+(?:\.\d+)?)\s*(?:metros?\s+)?por\s+(\d+(?:\.\d+)?)/i);
  }

  if (!m) return null;
  const width = parseFloat(m[1]);
  const height = parseFloat(m[2]);
  if (Number.isNaN(width) || Number.isNaN(height)) return null;

  return {
    width,
    height,
    area: width * height,
    // Normalize: smaller dimension first for consistent matching
    normalized: `${Math.min(width, height)}x${Math.max(width, height)}`
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
 * Get available malla products from database matching dimensions
 * Dimensions are interchangeable (4x3 = 3x4)
 */
async function findMatchingProducts(width, height, percentage = null, color = null) {
  try {
    // Find malla sombra family
    const mallaFamily = await ProductFamily.findOne({
      $or: [
        { name: /malla.*sombra/i },
        { slug: /malla-sombra/i }
      ],
      active: true
    }).lean();

    if (!mallaFamily) return [];

    // Build query for size matching
    // The size field format is typically "4x3" or "4 x 3"
    const sizePatterns = [
      `${width}x${height}`,
      `${height}x${width}`,
      `${width} x ${height}`,
      `${height} x ${width}`
    ];

    const query = {
      familyId: mallaFamily._id,
      active: true,
      $or: sizePatterns.map(s => ({ size: s }))
    };

    // Add percentage filter if specified
    if (percentage) {
      query.percentage = percentage;
    }

    // Add color filter if specified
    if (color) {
      query.color = new RegExp(color, 'i');
    }

    const products = await ProductFamily.find(query).lean();
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
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

  // Get current state
  let state = getFlowState(convo);

  console.log(`🌐 Malla flow - Current state:`, state);
  console.log(`🌐 Malla flow - Intent: ${intent}, Entities:`, entities);

  // Update state with any new entities
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
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }

  // Determine current stage
  const stage = determineStage(state);

  // Generate response based on stage
  let response;

  switch (stage) {
    case STAGES.AWAITING_DIMENSIONS:
      response = handleAwaitingDimensions(intent, state, sourceContext);
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
 * Handle start - user just mentioned malla
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Hola! Tenemos malla sombra confeccionada lista para instalar 🌿\n\n" +
          "Los precios dependen de la medida.\n\n" +
          "¿Qué medida necesitas? (ej: 4x3 metros)"
  };
}

/**
 * Handle awaiting dimensions stage
 */
function handleAwaitingDimensions(intent, state, sourceContext) {
  // If they're asking about prices without dimensions
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "Los precios van desde $320 hasta $1,800 dependiendo de la medida 📐\n\n" +
            "¿Qué medida necesitas? (ej: 4x3 metros)"
    };
  }

  // General ask for dimensions
  return {
    type: "text",
    text: "Para darte el precio necesito la medida 📐\n\n" +
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
      text: `📏 Solo manejamos medidas en metros completos.\n\n` +
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
      text: `La medida ${width}x${height}m es un pedido especial 📋\n\n` +
            `Un asesor te contactará para cotización personalizada.\n\n` +
            `¿Hay algo más que necesites?`
    };
  }

  // Try to find matching products
  const products = await findMatchingProducts(width, height, percentage, color);

  if (products.length > 0) {
    // Found exact matches
    const product = products[0]; // Take first match
    const trackedLink = await generateClickLink(psid, product.permalink, {
      productName: product.name,
      productId: product._id,
      city: convo?.city,
      stateMx: convo?.stateMx
    });

    const quantityText = quantity ? `Para ${quantity} piezas, ` : "";
    const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";

    return {
      type: "text",
      text: `¡Perfecto! ${quantityText}Tenemos la malla de ${width}x${height}m${priceText}:\n\n` +
            `${trackedLink}\n\n` +
            `Ahí puedes ver el precio y comprar. El envío está incluido 📦\n\n` +
            `¿Necesitas algo más?`
    };
  }

  // No exact match - suggest closest or custom
  // For now, hand off to human for quote
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Malla quote request: ${width}x${height}m${percentage ? ' @ ' + percentage + '%' : ''}`,
    handoffTimestamp: new Date()
  });

  const area = width * height;
  const summary = `✅ Te confirmo tu solicitud:\n\n` +
                  `📐 Medida: ${width}m x ${height}m (${area} m²)\n`;

  const extras = [];
  if (percentage) extras.push(`📊 Sombra: ${percentage}%`);
  if (color) extras.push(`🎨 Color: ${color}`);
  if (quantity) extras.push(`📦 Cantidad: ${quantity}`);

  return {
    type: "text",
    text: summary +
          (extras.length > 0 ? extras.join('\n') + '\n\n' : '\n') +
          `Un asesor te contactará con el precio y disponibilidad.\n\n` +
          `¿Necesitas algo más?`
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
  if (convo?.productInterest === "malla_sombra" && convo?.productSpecs?.productType !== "rollo") return true;

  // Source indicates malla
  if (sourceContext?.ad?.product === "malla_sombra") return true;
  if (sourceContext?.ad?.product === "confeccionada") return true;

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
