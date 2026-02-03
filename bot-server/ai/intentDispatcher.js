// ai/intentDispatcher.js
// Central dispatcher that routes intents to their handlers
// AI classification runs FIRST, then this dispatcher routes to pure business logic handlers

const { INTENTS } = require("./classifier");

// Import all handlers
const socialHandlers = require("./handlers/social");
const specsHandlers = require("./handlers/specs");
const logisticsHandlers = require("./handlers/logistics");
const escalationHandlers = require("./handlers/escalation");
const productsHandlers = require("./handlers/products");
const purchaseHandlers = require("./handlers/purchase");
const serviceHandlers = require("./handlers/service");
const conversationHandlers = require("./handlers/conversation");

/**
 * Handler registry - maps intent keys to handler functions
 * Each handler receives: { intent, entities, confidence, psid, convo, userMessage, classification }
 */
const handlers = {
  // ===== SOCIAL =====
  [INTENTS.GREETING]: socialHandlers.handleGreeting,
  [INTENTS.THANKS]: socialHandlers.handleThanks,
  [INTENTS.GOODBYE]: socialHandlers.handleGoodbye,

  // ===== SPECIFICATIONS =====
  [INTENTS.COLOR_QUERY]: specsHandlers.handleColorQuery,
  [INTENTS.SHADE_PERCENTAGE_QUERY]: specsHandlers.handleShadePercentageQuery,
  [INTENTS.EYELETS_QUERY]: specsHandlers.handleEyeletsQuery,

  // ===== LOGISTICS =====
  [INTENTS.SHIPPING_QUERY]: logisticsHandlers.handleShipping,
  [INTENTS.LOCATION_QUERY]: logisticsHandlers.handleLocation,
  [INTENTS.LOCATION_MENTION]: logisticsHandlers.handleLocationMention,
  [INTENTS.PAYMENT_QUERY]: logisticsHandlers.handlePayment,
  [INTENTS.PAY_ON_DELIVERY_QUERY]: logisticsHandlers.handlePayOnDelivery,
  [INTENTS.DELIVERY_TIME_QUERY]: logisticsHandlers.handleDeliveryTime,
  [INTENTS.SHIPPING_INCLUDED_QUERY]: logisticsHandlers.handleShippingIncluded,

  // ===== ESCALATION =====
  [INTENTS.FRUSTRATION]: escalationHandlers.handleFrustration,
  [INTENTS.HUMAN_REQUEST]: escalationHandlers.handleHumanRequest,
  [INTENTS.COMPLAINT]: escalationHandlers.handleComplaint,
  [INTENTS.PRICE_CONFUSION]: escalationHandlers.handlePriceConfusion,
  [INTENTS.OUT_OF_STOCK_REPORT]: escalationHandlers.handleOutOfStock,

  // ===== PRODUCTS =====
  [INTENTS.CATALOG_REQUEST]: productsHandlers.handleCatalogRequest,
  [INTENTS.PRODUCT_COMPARISON]: productsHandlers.handleProductComparison,
  [INTENTS.LARGEST_PRODUCT]: productsHandlers.handleLargestProduct,
  [INTENTS.SMALLEST_PRODUCT]: productsHandlers.handleSmallestProduct,
  [INTENTS.DURABILITY_QUERY]: productsHandlers.handleDurabilityQuery,

  // ===== PURCHASE =====
  [INTENTS.STORE_LINK_REQUEST]: purchaseHandlers.handleStoreLinkRequest,
  [INTENTS.HOW_TO_BUY]: purchaseHandlers.handleHowToBuy,
  [INTENTS.BULK_DISCOUNT]: purchaseHandlers.handleBulkDiscount,
  [INTENTS.PHONE_REQUEST]: purchaseHandlers.handlePhoneRequest,
  [INTENTS.PRICE_PER_SQM]: purchaseHandlers.handlePricePerSqm,

  // ===== SERVICE =====
  [INTENTS.INSTALLATION_QUERY]: serviceHandlers.handleInstallation,
  [INTENTS.STRUCTURE_QUERY]: serviceHandlers.handleStructure,
  [INTENTS.WARRANTY_QUERY]: serviceHandlers.handleWarranty,
  [INTENTS.CUSTOM_SIZE_QUERY]: serviceHandlers.handleCustomSize,
  [INTENTS.ACCESSORY_QUERY]: serviceHandlers.handleAccessory,

  // ===== CONVERSATION =====
  [INTENTS.FUTURE_INTEREST]: conversationHandlers.handleFutureInterest,
  [INTENTS.WILL_GET_BACK]: conversationHandlers.handleWillGetBack,
  // Note: CONFIRMATION and REJECTION are context-dependent, handled by flows
};

/**
 * Dispatch a classified intent to its handler
 *
 * @param {object} classification - Classification result from AI classifier
 * @param {object} context - Context object containing psid, convo, userMessage
 * @returns {object|null} Response if handled, null to continue to flows
 */
async function dispatch(classification, context) {
  const { intent, entities, confidence } = classification;
  const { psid, convo, userMessage } = context;

  console.log(`🎯 Intent Dispatcher: ${intent} (confidence: ${confidence})`);

  // Get handler for this intent
  const handler = handlers[intent];

  if (!handler) {
    console.log(`📋 No handler registered for intent "${intent}", passing to flows`);
    return null;
  }

  try {
    const response = await handler({
      intent,
      entities,
      confidence,
      psid,
      convo,
      userMessage,
      classification
    });

    if (response) {
      console.log(`✅ Intent "${intent}" handled by dispatcher`);
      return {
        ...response,
        handledBy: `dispatcher:${intent}`
      };
    }

    // Handler returned null - let flows handle it
    console.log(`📋 Handler for "${intent}" returned null, passing to flows`);
    return null;

  } catch (error) {
    console.error(`❌ Error in handler for intent "${intent}":`, error.message);
    return null; // Let flows try to handle it
  }
}

/**
 * Check if an intent has a registered handler
 */
function hasHandler(intent) {
  return !!handlers[intent];
}

/**
 * Get list of all registered intents
 */
function getRegisteredIntents() {
  return Object.keys(handlers);
}

module.exports = {
  dispatch,
  hasHandler,
  getRegisteredIntents,
  handlers
};
