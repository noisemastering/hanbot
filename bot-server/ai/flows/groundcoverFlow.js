// ai/flows/groundcoverFlow.js
// State machine for groundcover (malla antimaleza) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");
const { isBusinessHours } = require("../utils/businessHours");
const { checkZipBeforeHandoff, handlePendingZipResponse } = require("../utils/preHandoffCheck");

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
 * Flow stages for groundcover
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
 * Cache for available groundcover widths
 */
let gcWidthsCache = null;
let gcWidthsCacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get available groundcover widths from database
 */
async function getAvailableWidths() {
  if (gcWidthsCache && Date.now() < gcWidthsCacheExpiry) {
    return gcWidthsCache;
  }

  try {
    const products = await ProductFamily.find({
      sellable: true,
      active: true,
      $or: [
        { name: /groundcover/i },
        { name: /antimaleza/i },
        { name: /ground.*cover/i },
        { aliases: { $in: [/groundcover/i, /antimaleza/i] } }
      ]
    }).select('size').lean();

    const widths = new Set();
    for (const p of products) {
      const match = p.size?.match(/^(\d+(?:\.\d+)?)\s*x\s*\d+/i);
      if (match) {
        widths.add(parseFloat(match[1]));
      }
    }

    gcWidthsCache = [...widths].sort((a, b) => a - b);
    gcWidthsCacheExpiry = Date.now() + CACHE_TTL;
    console.log(`🔄 Groundcover widths cache refreshed: ${gcWidthsCache.join(', ')}m`);
    return gcWidthsCache.length > 0 ? gcWidthsCache : [2, 4]; // Fallback if no products found
  } catch (err) {
    console.error("Error fetching groundcover widths:", err.message);
    return [2, 4]; // Fallback
  }
}

/**
 * Find matching sellable groundcover products
 */
async function findMatchingProducts(width = null, length = null) {
  try {
    // Build query for groundcover/antimaleza
    const query = {
      sellable: true,
      active: true,
      $or: [
        { name: /groundcover/i },
        { name: /antimaleza/i },
        { name: /ground.*cover/i },
        { aliases: { $in: [/groundcover/i, /antimaleza/i, /ground.*cover/i] } }
      ]
    };

    // Add size filter if width specified
    if (width) {
      // Groundcover typically uses width like 1.05m, 2.10m
      const widthStr = width.toFixed(2).replace('.00', '');
      const sizeRegex = new RegExp(`${widthStr}`, 'i');
      query.size = sizeRegex;
    }

    console.log(`🌱 Searching for groundcover${width ? ` ${width}m` : ''}${length ? ` x ${length}m` : ''}`);

    const products = await ProductFamily.find(query)
      .sort({ price: 1 })
      .lean();

    console.log(`🌱 Found ${products.length} matching groundcover products`);

    return products;
  } catch (error) {
    console.error("❌ Error finding groundcover products:", error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'groundcover' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
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
 * Handle groundcover flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // ====== PENDING ZIP CODE RESPONSE ======
  if (convo?.pendingHandoff) {
    const zipResult = await handlePendingZipResponse(psid, convo, userMessage);
    if (zipResult.proceed) {
      const info = convo.pendingHandoffInfo || {};
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: info.reason || 'Groundcover handoff',
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      const locationAck = zipResult.zipInfo
        ? `Perfecto, ${zipResult.zipInfo.city || 'ubicación registrada'}. `
        : '';
      const timingMsg = isBusinessHours()
        ? "Un especialista te contactará pronto con el precio."
        : "Un especialista te contactará el siguiente día hábil con el precio.";

      return {
        type: "text",
        text: `${locationAck}${info.specsText || ''}${timingMsg}`
      };
    }
  }

  let state = getFlowState(convo);

  console.log(`🌱 Groundcover flow - Current state:`, state);
  console.log(`🌱 Groundcover flow - Intent: ${intent}, Entities:`, entities);

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

  let response;

  // ====== CATALOG / INFO REQUESTS — show available sizes regardless of stage ======
  const infoIntents = [INTENTS.CATALOG_REQUEST, INTENTS.PRODUCT_INQUIRY, INTENTS.AVAILABILITY_QUERY];
  if (infoIntents.includes(intent) && !state.width) {
    response = await handleStart(sourceContext);

    await updateConversation(psid, {
      lastIntent: `groundcover_start`,
      productInterest: "groundcover",
      productSpecs: {
        productType: "groundcover",
        width: state.width,
        length: state.length,
        quantity: state.quantity,
        updatedAt: new Date()
      }
    });

    return response;
  }
  // ====== END CATALOG / INFO REQUESTS ======

  const stage = determineStage(state);

  switch (stage) {
    case STAGES.AWAITING_DIMENSIONS:
      response = await handleAwaitingDimensions(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
      break;

    default:
      response = await handleStart(sourceContext);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `groundcover_${stage}`,
    productInterest: "groundcover",
    productSpecs: {
      productType: "groundcover",
      width: state.width,
      length: state.length,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned groundcover
 */
async function handleStart(sourceContext) {
  const widths = await getAvailableWidths();
  const widthList = widths.map(w => `${w}m x 100m`).join(' y ');

  return {
    type: "text",
    text: `¡Sí manejamos malla antimaleza/groundcover!\n\n` +
          `Ideal para control de hierbas en cultivos y jardines.\n\n` +
          `Contamos con rollos de ${widthList}.\n\n` +
          `¿Qué medida te interesa?`
  };
}

/**
 * Handle awaiting dimensions stage
 */
async function handleAwaitingDimensions(intent, state, sourceContext) {
  const widths = await getAvailableWidths();
  const widthList = widths.map(w => `${w}m x 100m`).join(' y ');

  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: `Los precios dependen de la medida. Contamos con rollos de ${widthList}.\n\n` +
            `¿Cuál te interesa?`
    };
  }

  return {
    type: "text",
    text: `Contamos con rollos de malla antimaleza de ${widthList}.\n\n` +
          `¿Cuál te interesa?`
  };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '') {
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
  const specsDesc = `malla antimaleza${width ? ` de ${width}m` : ''}${length ? ` x ${length}m` : ''}`;
  const zipCheck = await checkZipBeforeHandoff(psid, convo, userMessage, {
    reason: `Groundcover quote: ${width}m${length ? ` x ${length}m` : ''}${quantity ? ` x${quantity}` : ''}`,
    specsText: `Te confirmo tu solicitud de ${specsDesc}. `
  });
  if (zipCheck) return zipCheck;

  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Groundcover quote: ${width}m${length ? ` x ${length}m` : ''}${quantity ? ` x${quantity}` : ''}`,
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  return {
    type: "text",
    text: `Te confirmo tu solicitud de ${specsDesc}.\n\n` +
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

  if (product === "groundcover") return true;
  if (convo?.productSpecs?.productType === "groundcover") return true;
  if (convo?.lastIntent?.startsWith("groundcover_")) return true;
  if (convo?.productInterest === "groundcover") return true;
  if (sourceContext?.ad?.product === "groundcover") return true;

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
