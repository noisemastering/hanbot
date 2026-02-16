// ai/flows/bordeFlow.js
// State machine for borde separador (garden edging) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");
const { isBusinessHours } = require("../utils/businessHours");
const { checkZipBeforeHandoff, handlePendingZipResponse, isQueretaroLocation, getQueretaroPickupMessage } = require("../utils/preHandoffCheck");

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
  AWAITING_QUANTITY: "awaiting_quantity",
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
 * Get available lengths, filtered by ad products if specified
 */
async function getAvailableLengths(sourceContext, convo) {
  // Check ad productIds from sourceContext (first message) or conversation (persisted)
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;

  if (adProductIds?.length) {
    try {
      const products = await ProductFamily.find({
        _id: { $in: adProductIds },
        sellable: true,
        active: true
      }).lean();

      const lengths = new Set();
      for (const p of products) {
        const text = `${p.name || ''} ${p.size || ''}`;
        for (const validLen of VALID_LENGTHS) {
          if (new RegExp(`\\b${validLen}\\b`).test(text)) {
            lengths.add(validLen);
          }
        }
      }

      if (lengths.size > 0) {
        const filtered = [...lengths].sort((a, b) => a - b);
        console.log(`🌱 Borde lengths from ad products: ${filtered.join(', ')}m`);
        return filtered;
      }
    } catch (err) {
      console.error("Error getting ad product lengths:", err.message);
    }
  }

  return VALID_LENGTHS;
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
    quantity: specs.quantity || null,
    flowCompleted: specs.flowCompleted || false
  };
}

/**
 * Determine what stage we should be in
 */
function determineStage(state) {
  if (!state.length) return STAGES.AWAITING_LENGTH;
  if (!state.quantity) return STAGES.AWAITING_QUANTITY;
  return STAGES.COMPLETE;
}

/**
 * Parse borde length from user message
 */
function parseLengthFromMessage(msg, availableLengths) {
  if (!msg) return null;

  // First try with explicit meter suffix: "54 Mts", "18m", "54 metros"
  const meterMatch = msg.match(/\b(\d+)\s*(?:m(?:ts?|etros?)?)\b/i);
  if (meterMatch) {
    const num = parseInt(meterMatch[1]);
    if (availableLengths.includes(num)) return num;
  }

  // Then try bare numbers that match valid lengths
  const numbers = msg.match(/\b(\d+)\b/g);
  if (numbers) {
    for (const numStr of numbers) {
      const num = parseInt(numStr);
      if (availableLengths.includes(num)) return num;
    }
  }

  return null;
}

/**
 * Parse quantity from user message
 */
function parseQuantityFromMessage(msg) {
  if (!msg) return null;
  const m = msg.toLowerCase();

  // "un par" = 2
  if (/\b(un\s*par|par\s+de)\b/i.test(m)) return 2;
  // "uno", "una", "1"
  if (/\b(un[oa]?|1)\s*(rollo|pza|pieza)?\b/i.test(m)) return 1;
  // "dos", "2"
  if (/\b(dos|2)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 2;
  // "tres", "3"
  if (/\b(tres|3)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 3;
  // "cuatro" through common numbers
  if (/\b(cuatro|4)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 4;
  if (/\b(cinco|5)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 5;

  // Generic number + rollos/piezas
  const qtyMatch = m.match(/\b(\d+)\s+(rollos?|pzas?|piezas?)\b/i);
  if (qtyMatch) {
    const qty = parseInt(qtyMatch[1]);
    if (qty > 0 && qty <= 500) return qty;
  }

  // Bare number (only when we're specifically asking for quantity - will be used contextually)
  const bareMatch = m.match(/^\s*(\d+)\s*$/);
  if (bareMatch) {
    const qty = parseInt(bareMatch[1]);
    if (qty > 0 && qty <= 500) return qty;
  }

  return null;
}

/**
 * Handle borde flow
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
        handoffReason: info.reason || 'Borde separador handoff',
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      const { sendHandoffNotification } = require("../../services/pushNotifications");
      sendHandoffNotification(psid, convo, info.reason || 'Borde - cliente proporcionó ubicación').catch(err => {
        console.error("❌ Failed to send push notification:", err);
      });

      const locationAck = zipResult.zipInfo
        ? `Perfecto, ${zipResult.zipInfo.city || 'ubicación registrada'}. `
        : '';
      const timingMsg = isBusinessHours()
        ? "Un especialista te contactará pronto."
        : "Un especialista te contactará el siguiente día hábil.";

      let responseText = `${locationAck}${info.specsText || ''}${timingMsg}`;

      // Queretaro pickup option
      if (isQueretaroLocation(zipResult.zipInfo, convo)) {
        const pickupMsg = await getQueretaroPickupMessage();
        responseText += `\n\n${pickupMsg}`;
      }

      return { type: "text", text: responseText };
    }
  }

  let state = getFlowState(convo);

  console.log(`🌱 Borde flow - Current state:`, state);
  console.log(`🌱 Borde flow - Intent: ${intent}, Entities:`, entities);

  // If flow already completed, handle gracefully
  if (state.flowCompleted) {
    const isDenial = /\b(no|nada|eso\s*es\s*todo|es\s*todo|nah?|nel|gracias|no\s*gracias)\b/i.test(userMessage);
    if (isDenial) {
      return {
        type: "text",
        text: "¡Perfecto! Cualquier cosa aquí andamos. ¡Que tengas excelente día!"
      };
    }
    // For other messages after completion, reset flow so they can start over
    state = { length: null, quantity: null, flowCompleted: false };
  }

  // Get available lengths (filtered by ad if applicable)
  const availableLengths = await getAvailableLengths(sourceContext, convo);

  // Parse length from user message
  if (!state.length && userMessage) {
    const parsed = parseLengthFromMessage(userMessage, availableLengths);
    if (parsed) {
      console.log(`🌱 Borde flow - Parsed length from message: ${parsed}m`);
      state.length = parsed;
    }
  }

  // Also check classifier entities
  if (!state.length && entities.borde_length && VALID_LENGTHS.includes(entities.borde_length)) {
    state.length = entities.borde_length;
  }

  // Parse quantity from user message (only when we already have length)
  if (state.length && !state.quantity && userMessage) {
    // Don't parse quantity from the same message that provided length
    // unless it explicitly mentions quantity words
    const hasQtyWords = /\b(rollos?|pzas?|piezas?|necesito|quiero|ocupo|un\s*par)\b/i.test(userMessage);
    const isLengthOnlyMessage = parseLengthFromMessage(userMessage, availableLengths) !== null;

    if (hasQtyWords || !isLengthOnlyMessage) {
      const qty = parseQuantityFromMessage(userMessage);
      if (qty) {
        console.log(`🌱 Borde flow - Parsed quantity from message: ${qty}`);
        state.quantity = qty;
      }
    }
  }

  // Also check classifier entities for quantity
  if (!state.quantity && entities.quantity) {
    state.quantity = entities.quantity;
  }

  const stage = determineStage(state);
  let response;

  switch (stage) {
    case STAGES.AWAITING_LENGTH:
      response = await handleAwaitingLength(intent, state, sourceContext, availableLengths);
      break;

    case STAGES.AWAITING_QUANTITY:
      response = handleAwaitingQuantity(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
      break;

    default:
      response = await handleStart(sourceContext, availableLengths);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `borde_${stage}`,
    productInterest: "borde_separador",
    productSpecs: {
      productType: "borde_separador",
      borde_length: state.length,
      quantity: state.quantity,
      flowCompleted: stage === STAGES.COMPLETE,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned borde
 */
async function handleStart(sourceContext, availableLengths) {
  const lengthList = availableLengths.map(l => `${l}m`).join(', ');

  return {
    type: "text",
    text: `¡Hola! Sí manejamos borde separador para jardín.\n\n` +
          `Sirve para delimitar áreas de pasto, crear caminos y separar zonas.\n\n` +
          `Tenemos rollos de ${lengthList}.\n\n` +
          `¿Qué largo te interesa?`
  };
}

/**
 * Handle awaiting length stage
 */
async function handleAwaitingLength(intent, state, sourceContext, availableLengths) {
  const lengthList = availableLengths.map(l => `${l}m`).join(', ');

  if (intent === INTENTS.PRICE_QUERY) {
    const bulletList = availableLengths.map(l => `• Rollo de ${l} metros`).join('\n');
    return {
      type: "text",
      text: `¡Claro! Manejamos borde separador en diferentes presentaciones:\n\n` +
            `${bulletList}\n\n` +
            `¿Qué largo necesitas?`
    };
  }

  return {
    type: "text",
    text: `Tenemos rollos de ${lengthList}.\n\n` +
          `¿Qué largo te interesa?`
  };
}

/**
 * Handle awaiting quantity stage - ask how many
 */
function handleAwaitingQuantity(intent, state, sourceContext) {
  return {
    type: "text",
    text: `Borde de ${state.length} metros. ¿Cuántos rollos necesitas?`
  };
}

/**
 * Handle complete - we have length and quantity
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '') {
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

      // Clarify "c/u" when asking for multiple items
      const priceText = product.price
        ? ` por ${formatMoney(product.price)}${quantity > 1 ? ' c/u' : ''}`
        : "";
      const quantityText = `Para ${quantity} rollo${quantity > 1 ? 's' : ''}, `;

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      return {
        type: "text",
        text: `¡Claro! ${quantityText}tenemos el ${displayName}${priceText}. El envío está incluido.\n\n` +
              `🛒 Cómpralo aquí:\n${trackedLink}${wholesaleMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }

    // Product found but no ML link — show price + ask zip
    if (product.price) {
      const specsDesc = displayName || `borde separador de ${length}m`;
      const qtyText = quantity > 1 ? ` c/u` : '';
      let priceMsg = `Tenemos ${specsDesc} en ${formatMoney(product.price)}${qtyText}`;

      if (product.wholesaleEnabled && product.wholesaleMinQty && product.wholesalePrice) {
        priceMsg += `\n\nPor mayoreo (mínimo ${product.wholesaleMinQty} rollos) a ${formatMoney(product.wholesalePrice)} por rollo`;
      } else if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        priceMsg += `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo`;
      }

      priceMsg += `, ¿me puedes proporcionar tu código postal para calcular el envío?`;

      const specsText = `${quantity} rollo${quantity > 1 ? 's' : ''} de borde de ${length}m`;
      await updateConversation(psid, {
        pendingHandoff: true,
        pendingHandoffInfo: {
          reason: `Borde: ${specsText}`,
          specsText: ''
        }
      });

      return { type: "text", text: priceMsg };
    }
  }

  // No product found or no price — hand off with full specs
  const specsText = `${quantity} rollo${quantity > 1 ? 's' : ''} de borde de ${length}m`;

  const zipCheck = await checkZipBeforeHandoff(psid, convo, userMessage, {
    reason: `Borde: ${specsText}`,
    specsText: `${specsText}. `
  });
  if (zipCheck) return zipCheck;

  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Borde: ${specsText}`,
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  // Send push notification
  const { sendHandoffNotification } = require("../services/pushNotifications");
  sendHandoffNotification(psid, convo, `Borde: ${specsText}`).catch(err => {
    console.error("❌ Failed to send push notification:", err);
  });

  return {
    type: "text",
    text: `${specsText}.\n\n` +
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
