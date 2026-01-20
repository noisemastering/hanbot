// ai/flows/index.js
// Layer 2-3: Flow Router
// Routes classified messages to the appropriate product/general flow

const rolloFlow = require("./rolloFlow");
const bordeFlow = require("./bordeFlow");
const mallaFlow = require("./mallaFlow");
const groundcoverFlow = require("./groundcoverFlow");
const monofilamentoFlow = require("./monofilamentoFlow");
const generalFlow = require("./generalFlow");
const { INTENTS, PRODUCTS } = require("../classifier");

/**
 * All available flows in priority order
 * More specific flows first, general flow last
 */
const FLOWS = [
  { name: "borde", flow: bordeFlow },
  { name: "rollo", flow: rolloFlow },
  { name: "malla", flow: mallaFlow },
  { name: "groundcover", flow: groundcoverFlow },
  { name: "monofilamento", flow: monofilamentoFlow },
  { name: "general", flow: generalFlow }
];

/**
 * Route a classified message to the appropriate flow
 *
 * @param {object} classification - From Layer 1 (intent, product, entities, confidence)
 * @param {object} sourceContext - From Layer 0 (channel, entry point, ad context)
 * @param {object} convo - Current conversation state
 * @param {string} psid - User's PSID
 * @returns {object|null} Response { text, type } or null if no flow handles it
 */
async function routeToFlow(classification, sourceContext, convo, psid) {
  const { intent, product, entities, confidence } = classification;

  console.log(`🔀 Flow router - Product: ${product}, Intent: ${intent}, Confidence: ${confidence}`);

  // Check each flow in priority order
  for (const { name, flow } of FLOWS) {
    if (flow.shouldHandle(classification, sourceContext, convo)) {
      console.log(`✅ Routing to ${name} flow`);

      const response = await flow.handle(classification, sourceContext, convo, psid);

      if (response) {
        return {
          ...response,
          handledBy: name
        };
      }
    }
  }

  // No flow handled the message
  console.log(`⚠️ No flow handled this message`);
  return null;
}

/**
 * Determine the primary product from classification and context
 */
function determinePrimaryProduct(classification, sourceContext, convo) {
  // Explicit product from classification
  if (classification.product && classification.product !== PRODUCTS.UNKNOWN) {
    return classification.product;
  }

  // Product from ad context
  if (sourceContext?.inferredProduct) {
    return sourceContext.inferredProduct;
  }

  // Product from conversation history
  if (convo?.productInterest) {
    return convo.productInterest;
  }

  if (convo?.productSpecs?.productType) {
    return convo.productSpecs.productType;
  }

  return PRODUCTS.UNKNOWN;
}

/**
 * Check if the conversation is in a "cold start" state
 * (no product context established yet)
 */
function isColdStart(classification, sourceContext, convo) {
  // Has ad context with product = not cold
  if (sourceContext?.ad?.product) return false;

  // Has existing product interest = not cold
  if (convo?.productInterest) return false;
  if (convo?.productSpecs?.productType) return false;

  // Classification found a product = not cold
  if (classification.product && classification.product !== PRODUCTS.UNKNOWN) return false;

  // Truly cold start
  return true;
}

/**
 * Handle cold start scenario
 * When we don't know what product the user wants
 */
async function handleColdStart(classification, sourceContext, convo, psid) {
  const { intent } = classification;

  console.log(`❄️ Cold start detected - Intent: ${intent}`);

  // If they're asking about price without context
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "¿De qué producto quieres saber el precio?\n\n" +
            "• Malla sombra confeccionada\n" +
            "• Rollos de malla sombra\n" +
            "• Borde separador para jardín",
      handledBy: "cold_start"
    };
  }

  // Generic cold start
  return {
    type: "text",
    text: "Hola, ¿qué producto te interesa?",
    handledBy: "cold_start"
  };
}

/**
 * Log the routing decision for debugging
 */
function logRouting(psid, classification, sourceContext, handledBy) {
  console.log(`📊 [${psid?.slice(-4) || '????'}] Routing decision:`, {
    intent: classification.intent,
    product: classification.product,
    handledBy: handledBy || "none",
    sourceProduct: sourceContext?.inferredProduct || "none"
  });
}

/**
 * Main entry point for Layer 2-3
 * Called from ai/index.js after classification
 */
async function processMessage(classification, sourceContext, convo, psid, userMessage) {
  // Check for cold start
  if (isColdStart(classification, sourceContext, convo) &&
      classification.intent !== INTENTS.GREETING) {
    // But first check if this is a general query that we can handle
    const generalResponse = await generalFlow.handle(classification, sourceContext, convo, psid);
    if (generalResponse) {
      logRouting(psid, classification, sourceContext, "general");
      return generalResponse;
    }

    // True cold start
    const coldResponse = await handleColdStart(classification, sourceContext, convo, psid);
    logRouting(psid, classification, sourceContext, "cold_start");
    return coldResponse;
  }

  // Route to appropriate flow
  const response = await routeToFlow(classification, sourceContext, convo, psid);

  if (response) {
    logRouting(psid, classification, sourceContext, response.handledBy);
    return response;
  }

  // Fallback: No flow handled it
  logRouting(psid, classification, sourceContext, null);
  return null;
}

module.exports = {
  routeToFlow,
  processMessage,
  determinePrimaryProduct,
  isColdStart,
  handleColdStart,
  FLOWS
};
