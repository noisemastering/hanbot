// ai/flows/rolloFlow.js
// State machine for roll (rollo) product flow
// Rolls are 100m long, come in 2.10m or 4.20m widths, various shade percentages

const { updateConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");

/**
 * Flow stages for rollo
 */
const STAGES = {
  START: "start",
  AWAITING_WIDTH: "awaiting_width",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  AWAITING_QUANTITY: "awaiting_quantity",
  COMPLETE: "complete"
};

/**
 * Valid widths for rolls
 */
const VALID_WIDTHS = [2.1, 2.10, 4.2, 4.20];

/**
 * Valid percentages
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

/**
 * Normalize width to standard format
 */
function normalizeWidth(width) {
  if (!width) return null;
  // Round to nearest valid width
  if (width >= 1.5 && width <= 2.5) return 2.10;
  if (width >= 3.5 && width <= 4.5) return 4.20;
  return null;
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'rollo' ? (convo?.lastIntent?.replace('roll_', '') || STAGES.START) : STAGES.START,
    width: specs.width || null,
    percentage: specs.percentage || null,
    quantity: specs.quantity || null,
    color: specs.color || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  if (!state.width) return STAGES.AWAITING_WIDTH;
  if (!state.percentage) return STAGES.AWAITING_PERCENTAGE;
  return STAGES.COMPLETE;
}

/**
 * Handle rollo flow
 *
 * @param {object} classification - From Layer 1 classifier
 * @param {object} sourceContext - From Layer 0
 * @param {object} convo - Current conversation
 * @param {string} psid - User's PSID
 * @returns {object} Response { text, nextStage, updatedSpecs }
 */
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

  // Get current state
  let state = getFlowState(convo);

  console.log(`📦 Rollo flow - Current state:`, state);
  console.log(`📦 Rollo flow - Intent: ${intent}, Entities:`, entities);

  // Update state with any new entities
  if (entities.width) {
    const normalized = normalizeWidth(entities.width);
    if (normalized) {
      state.width = normalized;
    }
  }
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }
  if (entities.color) {
    state.color = entities.color;
  }

  // Determine current stage based on what we have
  const stage = determineStage(state);

  // Generate response based on stage
  let response;

  switch (stage) {
    case STAGES.AWAITING_WIDTH:
      response = handleAwaitingWidth(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_PERCENTAGE:
      response = handleAwaitingPercentage(intent, state, sourceContext);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = handleStart(sourceContext);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `roll_${stage}`,
    productInterest: "rollo",
    productSpecs: {
      productType: "rollo",
      width: state.width,
      length: 100,
      percentage: state.percentage,
      quantity: state.quantity,
      color: state.color,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned rolls
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Claro! Manejamos rollos de malla sombra en dos anchos:\n\n" +
          "• 4.20m x 100m (420 m² por rollo)\n" +
          "• 2.10m x 100m (210 m² por rollo)\n\n" +
          "¿Qué ancho necesitas?"
  };
}

/**
 * Handle awaiting width stage
 */
function handleAwaitingWidth(intent, state, sourceContext) {
  // If they confirmed something, they might be confirming a width we mentioned
  if (intent === INTENTS.CONFIRMATION) {
    return {
      type: "text",
      text: "¿Cuál ancho te interesa? ¿4.20m o 2.10m?"
    };
  }

  // Ask for width
  return {
    type: "text",
    text: "Los rollos de malla sombra los manejamos en:\n\n" +
          "• 4.20m x 100m\n" +
          "• 2.10m x 100m\n\n" +
          "¿Qué ancho necesitas?"
  };
}

/**
 * Handle awaiting percentage stage
 */
function handleAwaitingPercentage(intent, state, sourceContext) {
  const widthStr = state.width === 4.20 ? "4.20" : "2.10";

  // Acknowledge the width and ask for percentage
  return {
    type: "text",
    text: `Perfecto, rollo de ${widthStr}m x 100m 📦\n\n` +
          `Lo tenemos desde 35% hasta 90% de sombra.\n\n` +
          `¿Qué porcentaje necesitas?`
  };
}

/**
 * Handle complete - we have all required info
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const widthStr = state.width === 4.20 ? "4.20" : "2.10";
  const quantity = state.quantity || 1;

  let summary = `✅ Perfecto, te confirmo:\n\n`;
  summary += `📦 Rollo de ${widthStr}m x 100m al ${state.percentage}%\n`;
  summary += `📊 Cantidad: ${quantity} rollo${quantity > 1 ? 's' : ''}`;

  if (state.color) {
    summary += `\n🎨 Color: ${state.color}`;
  }

  summary += `\n\nUn asesor te contactará para confirmar precio y disponibilidad. `;

  // If they want more, ask
  if (intent === INTENTS.QUANTITY_SPECIFICATION || state.quantity) {
    summary += `¿Necesitas algo más?`;
  } else {
    summary += `¿Cuántos rollos necesitas?`;
  }

  // Mark for human handoff
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: `Roll quote: ${quantity}x ${widthStr}m x 100m @ ${state.percentage}%${state.color ? ' ' + state.color : ''}`,
    handoffTimestamp: new Date()
  });

  return {
    type: "text",
    text: summary
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // Explicitly about rolls
  if (product === "rollo") return true;

  // Already in roll flow
  if (convo?.productSpecs?.productType === "rollo") return true;
  if (convo?.lastIntent?.startsWith("roll_")) return true;

  // Source indicates rolls
  if (sourceContext?.ad?.product === "rollo") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
