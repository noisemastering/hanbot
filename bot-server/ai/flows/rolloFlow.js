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
  AWAITING_WIDTH: "awaiting_width",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  AWAITING_ZIP: "awaiting_zip",
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
    color: specs.color || null,
    zipCode: convo?.zipCode || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
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
    case STAGES.AWAITING_WIDTH:
      response = handleAwaitingWidth(intent, state, sourceContext);
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
      response = handleStart(sourceContext);
  }

  // Save updated specs
  const updateData = {
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
 * Handle awaiting zip code stage
 */
function handleAwaitingZip(intent, state, sourceContext) {
  const widthStr = state.width === 4.20 ? "4.20" : "2.10";

  return {
    type: "text",
    text: `✅ Perfecto, te confirmo:\n\n` +
          `📦 Rollo de ${widthStr}m x 100m al ${state.percentage}%\n` +
          `📊 Cantidad: ${state.quantity || 1} rollo${(state.quantity || 1) > 1 ? 's' : ''}\n\n` +
          `Para calcular el envío, ¿me compartes tu código postal?`
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
    const locationText = state.zipInfo
      ? ` a ${state.zipInfo.city}, ${state.zipInfo.state}`
      : '';

    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Roll quote: ${quantity}x ${widthStr}m x 100m @ ${state.percentage}%${locationText}`,
      handoffTimestamp: new Date()
    });

    const qtyText = quantity > 1 ? `los ${quantity} rollos` : "el rollo";
    let responseText = `¡Perfecto! Un especialista te contactará para cotizarte ${qtyText}.`;
    if (state.zipInfo) {
      responseText += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
    }
    responseText += `\n\n¿Necesitas algo más?`;

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

      const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";

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
        text: `¡Perfecto! Tenemos el ${displayName}${priceText}:\n\n` +
              `${trackedLink}\n\n` +
              `Ahí puedes ver el precio y comprar.${wholesaleMention}${locationMention}\n\n` +
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
      handoffReason: `Roll quote: ${quantity}x ${widthStr}m x 100m @ ${state.percentage}%${locationText}`,
      handoffTimestamp: new Date()
    });

    let responseText = `Perfecto, ${quantity} rollo${quantity > 1 ? 's' : ''} de ${widthStr}m x 100m al ${state.percentage}%.`;
    if (state.zipInfo) {
      responseText += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
    }
    responseText += `\n\nUn especialista te contactará con el precio. ¿Necesitas algo más?`;

    return {
      type: "text",
      text: responseText
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
