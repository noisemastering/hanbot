// ai/flows/monofilamentoFlow.js
// State machine for monofilamento (monofilament mesh) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");
const { isBusinessHours } = require("../utils/businessHours");

// Import existing utilities - USE THESE
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductDisplayName,
  getProductInterest
} = require("../utils/productEnricher");

// Centralized dimension parsing for rolls
const { parseRollDimensions: parseDimensions } = require("../utils/dimensionParsers");

/**
 * Flow stages for monofilamento
 */
const STAGES = {
  START: "start",
  AWAITING_DIMENSIONS: "awaiting_dimensions",
  COMPLETE: "complete"
};

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

// NOTE: parseDimensions is now imported from ../utils/dimensionParsers.js (roll parser)

/**
 * Find matching sellable monofilamento products
 */
async function findMatchingProducts(width = null, length = null) {
  try {
    // Build query for monofilamento
    const query = {
      sellable: true,
      active: true,
      $or: [
        { name: /monofilamento/i },
        { name: /mono.*filamento/i },
        { aliases: { $in: [/monofilamento/i, /mono.*filamento/i] } }
      ]
    };

    // Add size filter if width specified
    if (width) {
      const widthStr = width.toFixed(2).replace('.00', '');
      const sizeRegex = new RegExp(`${widthStr}`, 'i');
      query.size = sizeRegex;
    }

    console.log(`🧵 Searching for monofilamento${width ? ` ${width}m` : ''}${length ? ` x ${length}m` : ''}`);

    const products = await ProductFamily.find(query)
      .sort({ price: 1 })
      .lean();

    console.log(`🧵 Found ${products.length} matching monofilamento products`);

    return products;
  } catch (error) {
    console.error("❌ Error finding monofilamento products:", error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'monofilamento' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
    width: specs.width || null,
    length: specs.length || null,
    quantity: specs.quantity || null
  };
}

/**
 * Determine what stage we should be in
 */
function determineStage(state) {
  if (!state.width) return STAGES.AWAITING_DIMENSIONS;
  return STAGES.COMPLETE;
}

/**
 * Handle monofilamento flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  let state = getFlowState(convo);

  console.log(`🧵 Monofilamento flow - Current state:`, state);
  console.log(`🧵 Monofilamento flow - Intent: ${intent}, Entities:`, entities);

  // Update state with any new entities
  if (entities.dimensions) {
    const dims = parseDimensions(entities.dimensions);
    if (dims) {
      state.width = dims.width;
      state.length = dims.length;
    }
  }
  if (entities.width) state.width = entities.width;
  if (entities.length) state.length = entities.length;
  if (entities.quantity) state.quantity = entities.quantity;

  const stage = determineStage(state);
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
    lastIntent: `monofilamento_${stage}`,
    productInterest: "monofilamento",
    productSpecs: {
      productType: "monofilamento",
      width: state.width,
      length: state.length,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned monofilamento
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Sí manejamos malla monofilamento!\n\n" +
          "Ideal para aplicaciones agrícolas.\n\n" +
          "¿Qué medida necesitas? (ancho x largo)"
  };
}

/**
 * Handle awaiting dimensions stage
 */
function handleAwaitingDimensions(intent, state, sourceContext) {
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "Los precios dependen de la medida.\n\n" +
            "¿Qué ancho y largo necesitas?"
    };
  }

  return {
    type: "text",
    text: "¿Qué medida de malla monofilamento necesitas?\n\n" +
          "(ejemplo: 4.20m x 100m)"
  };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const { width, length, quantity } = state;

  // Try to find matching product in inventory
  const products = await findMatchingProducts(width, length);

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

    if (productUrl) {
      const trackedLink = await generateClickLink(psid, productUrl, {
        productName: product.name,
        productId: product._id,
        city: convo?.city,
        stateMx: convo?.stateMx
      });

      // Clarify "c/u" when asking for multiple items
      const priceText = product.price
        ? ` por ${formatMoney(product.price)}${quantity && quantity > 1 ? ' c/u' : ''}`
        : "";
      const quantityText = quantity ? `Para ${quantity} rollos, ` : "";

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && (!quantity || quantity < product.wholesaleMinQty)) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      return {
        type: "text",
        text: `¡Perfecto! ${quantityText}Tenemos ${displayName}${priceText}. El envío está incluido.\n\n` +
              `🛒 Cómpralo aquí:\n${trackedLink}${wholesaleMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }
  }

  // No product found in inventory - hand off
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Monofilamento quote: ${width}m${length ? ` x ${length}m` : ''}${quantity ? ` x${quantity}` : ''}`,
    handoffTimestamp: new Date()
  });

  return {
    type: "text",
    text: `Te confirmo tu solicitud de malla monofilamento${width ? ` de ${width}m` : ''}${length ? ` x ${length}m` : ''}.\n\n` +
          (isBusinessHours()
            ? `Un especialista te contactará pronto con el precio.\n\n`
            : `Un especialista te contactará el siguiente día hábil con el precio.\n\n`) +
          `¿Necesitas algo más?`
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  if (product === "monofilamento") return true;
  if (convo?.productSpecs?.productType === "monofilamento") return true;
  if (convo?.lastIntent?.startsWith("monofilamento_")) return true;
  if (convo?.productInterest === "monofilamento") return true;
  if (sourceContext?.ad?.product === "monofilamento") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
