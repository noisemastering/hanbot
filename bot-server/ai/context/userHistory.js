// ai/context/userHistory.js
// Check user history - returning users, previous products, conversation count

const Message = require("../../models/Message");
const Conversation = require("../../models/Conversation");

/**
 * Get user history to enrich source context
 *
 * @param {string} psid - User's PSID
 * @param {object} convo - Current conversation document
 * @returns {object} User history details
 */
async function getUserHistory(psid, convo) {
  const history = {
    isReturning: false,
    hoursSinceLastMessage: 0,
    daysSinceLastMessage: 0,
    previousProducts: [],
    messageCount: 0,
    lastProductInterest: null,
    hadPreviousHandoff: false,
    lastConvoDate: null
  };

  try {
    // Get message count
    history.messageCount = await Message.countDocuments({ psid, senderType: "user" });

    // Calculate time since last message
    if (convo?.lastMessageAt) {
      const lastMessageTime = new Date(convo.lastMessageAt).getTime();
      const now = Date.now();
      history.hoursSinceLastMessage = (now - lastMessageTime) / (1000 * 60 * 60);
      history.daysSinceLastMessage = history.hoursSinceLastMessage / 24;
      history.lastConvoDate = convo.lastMessageAt;

      // Consider returning if > 24 hours since last message
      history.isReturning = history.hoursSinceLastMessage > 24;
    }

    // Get previous product interest
    if (convo?.productInterest) {
      history.lastProductInterest = convo.productInterest;
      history.previousProducts.push(convo.productInterest);
    }

    // Check if they had a previous handoff
    if (convo?.handoffRequested || convo?.handoffResolved) {
      history.hadPreviousHandoff = true;
    }

    // TODO: In the future, could query Order model to see actual purchases
    // const Order = require("../../models/Order");
    // const orders = await Order.find({ psid }).populate('items.productId');
    // history.purchasedProducts = orders.flatMap(o => o.items.map(i => i.productId?.name));

    console.log(`📜 User history:`, {
      psid: psid.slice(-6),
      isReturning: history.isReturning,
      hoursSince: Math.round(history.hoursSinceLastMessage),
      messageCount: history.messageCount,
      lastProduct: history.lastProductInterest
    });

    return history;

  } catch (error) {
    console.error(`❌ Error getting user history:`, error);
    return history;
  }
}

/**
 * Get a personalized returning user greeting
 *
 * @param {object} history - User history from getUserHistory
 * @returns {string|null} Greeting message or null if not returning
 */
function getReturningGreeting(history) {
  if (!history.isReturning) {
    return null;
  }

  // If they had a product interest, reference it
  if (history.lastProductInterest) {
    const productNames = {
      malla_sombra: "malla sombra",
      rollo: "rollos de malla",
      borde_separador: "borde separador",
      groundcover: "ground cover",
      monofilamento: "malla monofilamento"
    };

    const productName = productNames[history.lastProductInterest] || history.lastProductInterest;

    // If it's been a while, ask if they still need it
    if (history.daysSinceLastMessage > 7) {
      return `¡Hola de nuevo! 👋 Hace tiempo hablamos sobre ${productName}. ¿Sigues interesado o te puedo ayudar con algo más?`;
    }

    return `¡Hola de nuevo! 👋 ¿Te puedo ayudar con algo más sobre ${productName}?`;
  }

  // Generic returning greeting
  if (history.daysSinceLastMessage > 7) {
    return "¡Hola de nuevo! 👋 ¿En qué te puedo ayudar hoy?";
  }

  return "¡Hola de nuevo! 👋 ¿En qué más te puedo ayudar?";
}

/**
 * Check if this is a high-value returning user
 * (multiple interactions, previous purchase interest, etc.)
 *
 * @param {object} history - User history
 * @returns {boolean}
 */
function isHighValueUser(history) {
  return (
    history.messageCount > 10 ||
    history.hadPreviousHandoff ||
    history.previousProducts.length > 1
  );
}

module.exports = {
  getUserHistory,
  getReturningGreeting,
  isHighValueUser
};
