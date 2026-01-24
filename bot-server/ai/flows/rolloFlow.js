// ai/flows/rolloFlow.js
// State machine for roll (rollo) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
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
  AWAITING_WIDTH: "awaiting_width",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  COMPLETE: "complete"
};

/**
 * Valid widths for rolls (in meters)
 */
const VALID_WIDTHS = [2.10, 4.20];

/**
 * Valid percentages
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

/**
 * Normalize width to standard format
 */
function normalizeWidth(width) {
  if (!width) return null;
  if (width >= 1.5 && width <= 2.5) return 2.10;
  if (width >= 3.5 && width <= 4.5) return 4.20;
  return null;
}

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Find matching sellable roll products
 */
async function findMatchingProducts(width, percentage = null) {
  try {
    // Build query for rolls - match by size pattern
    // Roll sizes are like "4.20x100m", "4.2x100", "4.20 x 100m"
    const widthStr = width.toFixed(2).replace('.00', '');
    const sizeRegex = new RegExp(`${widthStr}.*100`, 'i');

    console.log(`🔍 Searching for roll ${widthStr}m x 100m`);

    const query = {
      sellable: true,
      active: true,
      $or: [
        { size: sizeRegex },
        { name: new RegExp(`${widthStr}.*100`, 'i') }
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
    width: specs.width || null,
    percentage: specs.percentage || null,
    quantity: specs.quantity || null,
    color: specs.color || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  if (!state.width) return STAGES.AWAITING_WIDTH;
  if (!state.percentage) return STAGES.AWAITING_PERCENTAGE;
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

  // Update state with any new entities
  if (entities.width) {
    const normalized = normalizeWidth(entities.width);
    if (normalized) state.width = normalized;
  }
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }
  if (entities.color) {
    state.color = entities.color;
  }

  const stage = determineStage(state);
  let response;

  switch (stage) {
    case STAGES.AWAITING_WIDTH:
      response = handleAwaitingWidth(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_PERCENTAGE:
      response = handleAwaitingPercentage(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = handleStart(sourceContext);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `roll_${stage}`,
    productInterest: "rollo",
    productSpecs: {
      productType: "rollo",
      width: state.width,
      length: 100,
      percentage: state.percentage,
      quantity: state.quantity,
      color: state.color,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned rolls
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Claro! Manejamos rollos de malla sombra en dos anchos:\n\n" +
          "• 4.20m x 100m\n" +
          "• 2.10m x 100m\n\n" +
          "¿Qué ancho necesitas?"
  };
}

/**
 * Handle awaiting width stage
 */
function handleAwaitingWidth(intent, state, sourceContext) {
  if (intent === INTENTS.CONFIRMATION) {
    return {
      type: "text",
      text: "¿Cuál ancho te interesa? ¿4.20m o 2.10m?"
    };
  }

  return {
    type: "text",
    text: "Los rollos los manejamos en:\n\n" +
          "• 4.20m x 100m\n" +
          "• 2.10m x 100m\n\n" +
          "¿Qué ancho necesitas?"
  };
}

/**
 * Handle awaiting percentage stage
 */
function handleAwaitingPercentage(intent, state, sourceContext) {
  const widthStr = state.width === 4.20 ? "4.20" : "2.10";

  return {
    type: "text",
    text: `Perfecto, rollo de ${widthStr}m x 100m.\n\n` +
          `Lo tenemos desde 35% hasta 90% de sombra.\n\n` +
          `¿Qué porcentaje necesitas?`
  };
}

/**
 * Handle complete - we have width and percentage
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const widthStr = state.width === 4.20 ? "4.20" : "2.10";
  const quantity = state.quantity || 1;

  // Check if already asked quantity
  const alreadyAskedQuantity = convo?.lastIntent === "roll_complete";
  const userProvidedQuantity = intent === INTENTS.QUANTITY_SPECIFICATION || state.quantity;

  // If user is confirming quantity, give short response
  if (alreadyAskedQuantity && userProvidedQuantity) {
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Roll quote: ${quantity}x ${widthStr}m x 100m @ ${state.percentage}%`,
      handoffTimestamp: new Date()
    });

    const qtyText = quantity > 1 ? `los ${quantity} rollos` : "el rollo";
    return {
      type: "text",
      text: `¡Perfecto! Un asesor te contactará para cotizarte ${qtyText}. ¿Necesitas algo más?`
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
        city: convo?.city,
        stateMx: convo?.stateMx
      });

      const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      return {
        type: "text",
        text: `¡Perfecto! Tenemos el ${displayName}${priceText}:\n\n` +
              `${trackedLink}\n\n` +
              `Ahí puedes ver el precio y comprar.${wholesaleMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }
  }

  // No product found or no quantity yet - hand off or ask quantity
  if (userProvidedQuantity) {
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Roll quote: ${quantity}x ${widthStr}m x 100m @ ${state.percentage}%`,
      handoffTimestamp: new Date()
    });

    return {
      type: "text",
      text: `Perfecto, ${quantity} rollo${quantity > 1 ? 's' : ''} de ${widthStr}m x 100m al ${state.percentage}%.\n\n` +
            `Un asesor te contactará con el precio. ¿Necesitas algo más?`
    };
  } else {
    return {
      type: "text",
      text: `Tenemos el rollo de ${widthStr}m x 100m al ${state.percentage}%.\n\n` +
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
