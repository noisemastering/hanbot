// ai/flows/monofilamentoFlow.js
// State machine for monofilamento (monofilament mesh) product flow
// Monofilamento is used for agricultural applications

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { INTENTS } = require("../classifier");

/**
 * Flow stages for monofilamento
 */
const STAGES = {
  START: "start",
  AWAITING_DIMENSIONS: "awaiting_dimensions",
  COMPLETE: "complete"
};

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'monofilamento' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
    width: specs.width || null,
    length: specs.length || null,
    quantity: specs.quantity || null
  };
}

/**
 * Handle monofilamento flow
 */
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

  console.log(`🧵 Monofilamento flow - Intent: ${intent}`);

  // Get current state
  let state = getFlowState(convo);

  // Update state with entities
  if (entities.width) state.width = entities.width;
  if (entities.length) state.length = entities.length;
  if (entities.quantity) state.quantity = entities.quantity;

  // Save state
  await updateConversation(psid, {
    lastIntent: "monofilamento_inquiry",
    productInterest: "monofilamento",
    productSpecs: {
      productType: "monofilamento",
      width: state.width,
      length: state.length,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  // For now, hand off to human for monofilamento quotes
  // TODO: Add ML product links when available
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Monofilamento inquiry${state.width ? ` - ${state.width}m` : ''}${state.length ? ` x ${state.length}m` : ''}`,
    handoffTimestamp: new Date()
  });

  return {
    type: "text",
    text: "¡Sí manejamos malla monofilamento! 🧵\n\n" +
          "Un asesor te contactará con opciones y precios.\n\n" +
          "¿Qué medida necesitas?"
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // Explicitly about monofilamento
  if (product === "monofilamento") return true;

  // Already in monofilamento flow
  if (convo?.productSpecs?.productType === "monofilamento") return true;
  if (convo?.lastIntent?.startsWith("monofilamento_")) return true;
  if (convo?.productInterest === "monofilamento") return true;

  // Source indicates monofilamento
  if (sourceContext?.ad?.product === "monofilamento") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState
};
