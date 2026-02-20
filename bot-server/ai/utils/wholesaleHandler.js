// ai/utils/wholesaleHandler.js
// Handles wholesale pricing detection and handoff

const Product = require("../../models/Product");
const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getHandoffTimingMessage } = require("./businessHours");
const { getAncestors } = require("./productMatcher");

/**
 * Check if a product is eligible for wholesale
 * @param {object} product - Product document or ID
 * @returns {Promise<object>} { eligible, minQty, wholesalePrice }
 */
async function checkWholesaleEligibility(product) {
  let prod = product;

  // If passed an ID, fetch the product
  if (typeof product === 'string') {
    prod = await Product.findById(product).lean();
  }

  if (!prod) {
    return { eligible: false };
  }

  return {
    eligible: !!prod.wholesaleMinQty,
    minQty: prod.wholesaleMinQty || null,
    productName: prod.name,
    retailPrice: prod.price
  };
}

/**
 * Check if a quantity qualifies for wholesale pricing
 * @param {number} quantity - Requested quantity
 * @param {object} product - Product document
 * @returns {object} { qualifies, minQty, wholesalePrice }
 */
function checkWholesaleQuantity(quantity, product) {
  if (!product.wholesaleMinQty) {
    return { qualifies: false };
  }

  const qualifies = quantity >= product.wholesaleMinQty;

  return {
    qualifies,
    minQty: product.wholesaleMinQty,
    quantity,
    productName: product.name
  };
}

/**
 * Extract quantity from user message
 * @param {string} message - User message
 * @returns {number|null} Extracted quantity or null
 */
function extractQuantity(message) {
  if (!message) return null;

  const msg = message.toLowerCase();

  // Patterns for quantity extraction
  const patterns = [
    /(\d+)\s*(piezas?|unidades?|rollos?|mallas?|pzas?)/i,  // "15 piezas", "10 rollos"
    /necesito\s*(\d+)/i,                                    // "necesito 15"
    /quiero\s*(\d+)/i,                                      // "quiero 20"
    /(\d+)\s*(de\s+\d+x\d+|de\s+cada)/i,                   // "15 de 4x5"
    /dame\s*(\d+)/i,                                        // "dame 10"
    /son\s*(\d+)/i,                                         // "son 12"
    /serian\s*(\d+)/i,                                      // "serian 15"
    /^(\d+)$/,                                              // Just a number
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const qty = parseInt(match[1]);
      if (qty > 0 && qty < 10000) { // Sanity check
        return qty;
      }
    }
  }

  return null;
}

/**
 * Generate wholesale response and trigger handoff
 * @param {object} product - Product document
 * @param {number} quantity - Requested quantity
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation object
 * @returns {Promise<object>} Response object
 */
async function handleWholesaleRequest(product, quantity, psid, convo) {
  const wholesaleCheck = checkWholesaleQuantity(quantity, product);

  if (!wholesaleCheck.qualifies) {
    return null; // Not a wholesale request
  }

  // Build dynamic product description from lineage
  let productDesc = product.name;
  try {
    const ancestors = await getAncestors(product._id);
    if (ancestors.length > 0) {
      // Use gen 2 (product type) + leaf size, e.g. "Borde Separador de 54m"
      const root = ancestors[ancestors.length - 1];
      const gen2 = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : null;
      productDesc = gen2?.name || root?.name || product.name;
    }
  } catch (err) {
    console.error("Error building wholesale product desc:", err.message);
  }

  const sizeText = product.size ? ` de ${product.size}` : '';
  const fullDesc = `${productDesc}${sizeText}`;
  const qtyLabel = quantity > 1 ? 'rollos' : 'rollo';

  // Transparent handoff — don't mention specialist
  const message = `¡Perfecto! En breve te tenemos la cotización para ${quantity} ${qtyLabel} de ${fullDesc}.` +
    `\n\n📍 Estamos en Querétaro, pero realizamos envíos a toda la República. 📦✈️` +
    `\n\n¿Me puedes proporcionar tu código postal para calcular el envío?`;

  // Update conversation for handoff
  const handoffReason = `Mayoreo: ${quantity}x ${fullDesc}`;
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason,
    handoffTimestamp: new Date(),
    state: "needs_human",
    wholesaleRequest: {
      productId: product._id,
      productName: fullDesc,
      quantity,
      retailPrice: product.price
    }
  });

  // Send notification
  await sendHandoffNotification(psid, convo, handoffReason).catch(err => {
    console.error("❌ Failed to send wholesale notification:", err);
  });

  console.log(`📦 Wholesale request: ${quantity}x ${fullDesc} for ${psid}`);

  return {
    type: "text",
    text: message,
    handledBy: "wholesale_handoff",
    isWholesale: true
  };
}

/**
 * Generate proactive wholesale mention for eligible products
 * @param {object} product - Product document
 * @returns {string|null} Wholesale mention text or null
 */
function getWholesaleMention(product) {
  if (!product.wholesaleMinQty) {
    return null;
  }

  return `A partir de ${product.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
}

/**
 * Check if message indicates wholesale/bulk interest
 * @param {string} message - User message
 * @returns {boolean}
 */
function isWholesaleInquiry(message) {
  if (!message) return false;

  const wholesalePatterns = /\b(mayoreo|mayorista|distribuidor|bulk|al por mayor|precio.*cantidad|cantidad.*grande|muchas?|varios|bastantes|lote)\b/i;
  return wholesalePatterns.test(message);
}

module.exports = {
  checkWholesaleEligibility,
  checkWholesaleQuantity,
  extractQuantity,
  handleWholesaleRequest,
  getWholesaleMention,
  isWholesaleInquiry
};
