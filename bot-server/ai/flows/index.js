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
 * @param {object} campaign - Campaign document (optional)
 * @returns {object|null} Response { text, type } or null if no flow handles it
 */
async function routeToFlow(classification, sourceContext, convo, psid, campaign = null) {
  const { intent, product, entities, confidence, responseGuidance } = classification;

  console.log(`🔀 Flow router - Product: ${product}, Intent: ${intent}, Confidence: ${confidence}`);

  // If classification has responseGuidance from DB (ai_generate handler), use it
  // This allows dashboard-defined responses to take precedence over hardcoded flow logic
  if (responseGuidance) {
    const { updateConversation } = require("../../conversationManager");
    console.log(`✅ Using DB responseGuidance in flow router for ${intent}`);
    await updateConversation(psid, { lastIntent: intent });
    return {
      type: "text",
      text: responseGuidance,
      handledBy: "intent_ai_generate"
    };
  }

  if (campaign) {
    console.log(`📣 Campaign active: ${campaign.name} (goal: ${campaign.conversationGoal})`);
  }

  // Check each flow in priority order
  for (const { name, flow } of FLOWS) {
    if (flow.shouldHandle(classification, sourceContext, convo)) {
      console.log(`✅ Routing to ${name} flow`);

      // Pass campaign to flow handler
      const response = await flow.handle(classification, sourceContext, convo, psid, campaign);

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
function determinePrimaryProduct(classification, sourceContext, convo, campaign = null) {
  // Explicit product from classification
  if (classification.product && classification.product !== PRODUCTS.UNKNOWN) {
    return classification.product;
  }

  // Product from campaign
  if (campaign?.products?.length > 0) {
    // Map campaign product to our product types
    const campaignProduct = campaign.products[0];
    if (campaignProduct.category === "agricultura" || campaignProduct.sku?.includes("AGR")) {
      return PRODUCTS.ROLLO;
    }
    if (campaignProduct.name?.toLowerCase().includes("borde")) {
      return PRODUCTS.BORDE_SEPARADOR;
    }
    // Default to malla sombra for confeccionada
    return PRODUCTS.MALLA_SOMBRA;
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
function isColdStart(classification, sourceContext, convo, campaign = null) {
  // Has campaign = not cold (we know the product context)
  if (campaign?.products?.length > 0) return false;

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
function logRouting(psid, classification, sourceContext, handledBy, campaign = null) {
  console.log(`📊 [${psid?.slice(-4) || '????'}] Routing decision:`, {
    intent: classification.intent,
    product: classification.product,
    handledBy: handledBy || "none",
    sourceProduct: sourceContext?.inferredProduct || "none",
    campaign: campaign?.ref || "none",
    goal: campaign?.conversationGoal || "none"
  });
}

/**
 * Check if we should hand off to human based on campaign goal
 */
function shouldHandoffForQuote(campaign) {
  if (!campaign) return false;

  // Check conversation goal
  if (campaign.conversationGoal === "cotizacion") return true;

  // Check if any product requires quote
  if (typeof campaign.requiresQuote === 'function') {
    return campaign.requiresQuote();
  }

  return false;
}

/**
 * Main entry point for Layer 2-3
 * Called from ai/index.js after classification
 */
async function processMessage(classification, sourceContext, convo, psid, userMessage, campaign = null) {
  // Check for cold start (but campaign context means not cold)
  if (isColdStart(classification, sourceContext, convo, campaign) &&
      classification.intent !== INTENTS.GREETING) {
    // But first check if this is a general query that we can handle
    const generalResponse = await generalFlow.handle(classification, sourceContext, convo, psid, campaign);
    if (generalResponse) {
      logRouting(psid, classification, sourceContext, "general", campaign);
      return generalResponse;
    }

    // True cold start
    const coldResponse = await handleColdStart(classification, sourceContext, convo, psid);
    logRouting(psid, classification, sourceContext, "cold_start", campaign);
    return coldResponse;
  }

  // Route to appropriate flow
  const response = await routeToFlow(classification, sourceContext, convo, psid, campaign);

  if (response) {
    logRouting(psid, classification, sourceContext, response.handledBy, campaign);
    return response;
  }

  // Fallback: No flow handled it
  logRouting(psid, classification, sourceContext, null, campaign);
  return null;
}

module.exports = {
  routeToFlow,
  processMessage,
  determinePrimaryProduct,
  isColdStart,
  handleColdStart,
  shouldHandoffForQuote,
  FLOWS
};
