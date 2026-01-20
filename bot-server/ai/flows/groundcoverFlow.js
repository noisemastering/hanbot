// ai/flows/groundcoverFlow.js
// State machine for groundcover (malla antimaleza/antiáfido) product flow
// Groundcover comes in rolls, various widths and lengths

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { INTENTS } = require("../classifier");

/**
 * Flow stages for groundcover
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
    stage: specs.productType === 'groundcover' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
    width: specs.width || null,
    length: specs.length || null,
    quantity: specs.quantity || null
  };
}

/**
 * Handle groundcover flow
 */
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

  console.log(`🌱 Groundcover flow - Intent: ${intent}`);

  // Get current state
  let state = getFlowState(convo);

  // Update state with entities
  if (entities.width) state.width = entities.width;
  if (entities.length) state.length = entities.length;
  if (entities.quantity) state.quantity = entities.quantity;

  // Save state
  await updateConversation(psid, {
    lastIntent: "groundcover_inquiry",
    productInterest: "groundcover",
    productSpecs: {
      productType: "groundcover",
      width: state.width,
      length: state.length,
      quantity: state.quantity,
      updatedAt: new Date()
    }
  });

  // For now, hand off to human for groundcover quotes
  // TODO: Add ML product links when available
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Groundcover inquiry${state.width ? ` - ${state.width}m` : ''}${state.length ? ` x ${state.length}m` : ''}`,
    handoffTimestamp: new Date()
  });

  return {
    type: "text",
    text: "¡Sí manejamos malla antimaleza/groundcover! 🌱\n\n" +
          "Un asesor te contactará con opciones y precios.\n\n" +
          "¿Qué medida necesitas?"
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // Explicitly about groundcover
  if (product === "groundcover") return true;

  // Already in groundcover flow
  if (convo?.productSpecs?.productType === "groundcover") return true;
  if (convo?.lastIntent?.startsWith("groundcover_")) return true;
  if (convo?.productInterest === "groundcover") return true;

  // Source indicates groundcover
  if (sourceContext?.ad?.product === "groundcover") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState
};
