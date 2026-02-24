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
  [INTENTS.CUSTOM_MODIFICATION]: escalationHandlers.handleCustomModification,

  // ===== PRODUCTS =====
  // NOTE: PRODUCT_INQUIRY, SIZE_SPECIFICATION, and PRICE_QUERY are NOT here
  // They fall through to flow manager which routes to the right flow (rolloFlow, mallaFlow, etc.)
  // based on the product type from classification
  [INTENTS.CATALOG_REQUEST]: productsHandlers.handleCatalogRequest,
  [INTENTS.PRODUCT_COMPARISON]: productsHandlers.handleProductComparison,
  [INTENTS.LARGEST_PRODUCT]: productsHandlers.handleLargestProduct,
  [INTENTS.SMALLEST_PRODUCT]: productsHandlers.handleSmallestProduct,
  [INTENTS.DURABILITY_QUERY]: productsHandlers.handleDurabilityQuery,
  [INTENTS.PHOTO_REQUEST]: productsHandlers.handlePhotoRequest,

  // ===== PURCHASE =====
  [INTENTS.STORE_LINK_REQUEST]: purchaseHandlers.handleStoreLinkRequest,
  [INTENTS.HOW_TO_BUY]: purchaseHandlers.handleHowToBuy,
  [INTENTS.BULK_DISCOUNT]: purchaseHandlers.handleBulkDiscount,
  [INTENTS.RESELLER_INQUIRY]: purchaseHandlers.handleResellerInquiry,
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
  [INTENTS.CONFIRMATION]: conversationHandlers.handleConfirmation,
  [INTENTS.STORE_VISIT]: conversationHandlers.handleStoreVisit,
  [INTENTS.PURCHASE_DEFERRAL]: conversationHandlers.handlePurchaseDeferral,
  [INTENTS.LOCATION_TOO_FAR]: conversationHandlers.handleLocationTooFar,

  // ===== OFF TOPIC =====
  [INTENTS.OFF_TOPIC]: escalationHandlers.handleOffTopic,
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

  // When conversation is in a specific product flow (not default/malla_sombra),
  // let product-related intents fall through to the flow manager so they use
  // the correct flow's DB queries (e.g. bordeFlow queries borde products)
  const PRODUCT_INTENTS_FOR_FLOWS = new Set([
    INTENTS.CATALOG_REQUEST,
    INTENTS.LARGEST_PRODUCT,
    INTENTS.SMALLEST_PRODUCT,
    INTENTS.DURABILITY_QUERY,
  ]);
  const currentFlow = convo?.currentFlow;
  const flowSpecificProducts = ['borde_separador', 'rollo', 'groundcover', 'monofilamento'];
  if (PRODUCT_INTENTS_FOR_FLOWS.has(intent) && flowSpecificProducts.includes(currentFlow)) {
    console.log(`📋 Skipping dispatcher for "${intent}" — conversation in ${currentFlow} flow, passing to flow manager`);
    return null;
  }

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
