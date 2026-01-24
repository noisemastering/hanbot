// ai/flows/bordeFlow.js
// State machine for borde separador (garden edging) product flow
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
 * Flow stages for borde
 */
const STAGES = {
  START: "start",
  AWAITING_LENGTH: "awaiting_length",
  COMPLETE: "complete"
};

/**
 * Valid lengths for borde (in meters)
 */
const VALID_LENGTHS = [6, 9, 18, 54];

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Find matching sellable borde products
 */
async function findMatchingProducts(length = null) {
  try {
    // Build query for borde separador - search by name/aliases
    const query = {
      sellable: true,
      active: true,
      $or: [
        { name: /borde.*separador/i },
        { name: /separador.*jardin/i },
        { aliases: { $in: [/borde/i, /separador/i, /garden.*edging/i] } }
      ]
    };

    // Add length filter if specified
    if (length) {
      // Match patterns like "6 metros", "6m", "6 m", "rollo de 6"
      const lengthRegex = new RegExp(`(^|\\s)${length}\\s*(m(?:etros?)?|metros?)?(\\s|$)`, 'i');
      query.$and = [{ name: lengthRegex }];
    }

    console.log(`🌱 Searching for borde${length ? ` ${length}m` : ''}`);

    const products = await ProductFamily.find(query)
      .sort({ price: 1 })
      .lean();

    console.log(`🌱 Found ${products.length} matching borde products`);

    return products;
  } catch (error) {
    console.error("❌ Error finding borde products:", error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'borde_separador' ? STAGES.AWAITING_LENGTH : STAGES.START,
    length: specs.borde_length || null,
    quantity: specs.quantity || null
  };
}

/**
 * Determine what stage we should be in
 */
function determineStage(state) {
  if (!state.length) return STAGES.AWAITING_LENGTH;
  return STAGES.COMPLETE;
}

/**
 * Handle borde flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  let state = getFlowState(convo);

  console.log(`🌱 Borde flow - Current state:`, state);
  console.log(`🌱 Borde flow - Intent: ${intent}, Entities:`, entities);

  // Update state with any new entities
  if (entities.borde_length && VALID_LENGTHS.includes(entities.borde_length)) {
    state.length = entities.borde_length;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }

  const stage = determineStage(state);
  let response;

  switch (stage) {
    case STAGES.AWAITING_LENGTH:
      response = handleAwaitingLength(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = handleStart(sourceContext);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `borde_${stage}`,
    productInterest: "borde_separador",
    productSpecs: {
      productType: "borde_separador",
      borde_length: state.length,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned borde
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Hola! Sí manejamos borde separador para jardín.\n\n" +
          "Sirve para delimitar áreas de pasto, crear caminos y separar zonas.\n\n" +
          "Tenemos rollos de 6m, 9m, 18m y 54m.\n\n" +
          "¿Qué largo te interesa?"
  };
}

/**
 * Handle awaiting length stage
 */
function handleAwaitingLength(intent, state, sourceContext) {
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "¡Claro! Manejamos borde separador en diferentes presentaciones:\n\n" +
            "• Rollo de 6 metros\n" +
            "• Rollo de 9 metros\n" +
            "• Rollo de 18 metros\n" +
            "• Rollo de 54 metros\n\n" +
            "¿Qué largo necesitas? Te paso el link con precio."
    };
  }

  return {
    type: "text",
    text: "Tenemos rollos de 6m, 9m, 18m y 54m.\n\n" +
          "¿Qué largo te interesa?"
  };
}

/**
 * Handle complete - we have the length
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const { length, quantity } = state;

  // Try to find matching product in inventory
  const products = await findMatchingProducts(length);

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

      const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";
      const quantityText = quantity ? `Para ${quantity} rollos, ` : "";

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && (!quantity || quantity < product.wholesaleMinQty)) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      return {
        type: "text",
        text: `¡Claro! ${quantityText}Tenemos el ${displayName}${priceText}:\n\n` +
              `${trackedLink}\n\n` +
              `Ahí puedes ver el precio y comprar. El envío está incluido.${wholesaleMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }
  }

  // No product found in inventory - hand off
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Borde quote: ${length}m${quantity ? ` x${quantity}` : ''}`,
    handoffTimestamp: new Date()
  });

  return {
    type: "text",
    text: `El borde de ${length} metros está disponible.\n\n` +
          `Un especialista te contactará con el precio.\n\n` +
          `¿Necesitas algo más?`
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  if (product === "borde_separador") return true;
  if (convo?.productSpecs?.productType === "borde_separador") return true;
  if (convo?.lastIntent?.startsWith("borde_")) return true;
  if (convo?.productInterest === "borde_separador") return true;
  if (sourceContext?.ad?.product === "borde_separador") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
