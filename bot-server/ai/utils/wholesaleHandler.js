// ai/utils/wholesaleHandler.js
// Handles wholesale pricing detection and handoff

const Product = require("../../models/Product");
const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getHandoffTimingMessage } = require("./businessHours");

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

  // Build response message
  const message = `¡Excelente! Para ${quantity} ${quantity > 1 ? 'piezas' : 'pieza'} de ${product.name} te paso con un especialista para darte precio de mayoreo. ${getHandoffTimingMessage()}`;

  // Update conversation for handoff
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Mayoreo: ${quantity}x ${product.name}`,
    handoffTimestamp: new Date(),
    state: "needs_human",
    wholesaleRequest: {
      productId: product._id,
      productName: product.name,
      quantity,
      retailPrice: product.price
    }
  });

  // Send notification
  const notificationMsg = `Pedido mayoreo: ${quantity}x ${product.name}`;
  await sendHandoffNotification(psid, convo, notificationMsg).catch(err => {
    console.error("❌ Failed to send wholesale notification:", err);
  });

  console.log(`📦 Wholesale request: ${quantity}x ${product.name} for ${psid}`);

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
