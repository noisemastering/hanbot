// ai/flows/bordeFlow.js
// State machine for borde separador (garden edging) product flow
// Borde comes in 6m, 9m, 18m, or 54m lengths

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { INTENTS } = require("../classifier");

/**
 * Flow stages for borde
 */
const STAGES = {
  START: "start",
  AWAITING_LENGTH: "awaiting_length",
  COMPLETE: "complete"
};

/**
 * Valid lengths and their ML links
 */
const BORDE_PRODUCTS = {
  6: {
    length: 6,
    link: "https://articulo.mercadolibre.com.mx/MLM-923085679-borde-separador-grueso-para-jardin-rollo-de-6-metros-_JM",
    description: "Rollo de 6 metros"
  },
  9: {
    length: 9,
    link: "https://articulo.mercadolibre.com.mx/MLM-923081079-borde-separador-grueso-para-jardin-rollo-de-9-metros-_JM",
    description: "Rollo de 9 metros"
  },
  18: {
    length: 18,
    link: "https://articulo.mercadolibre.com.mx/MLM-801430874-borde-separador-grueso-para-jardin-rollo-de-18-metros-_JM",
    description: "Rollo de 18 metros"
  },
  54: {
    length: 54,
    link: "https://articulo.mercadolibre.com.mx/MLM-1493170566-borde-separador-para-jardin-rollo-de-54-m-_JM",
    description: "Rollo de 54 metros"
  }
};

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'borde_separador' ? STAGES.AWAITING_LENGTH : STAGES.START,
    length: specs.borde_length || null,
    quantity: specs.quantity || null
  };
}

/**
 * Handle borde flow
 *
 * @param {object} classification - From Layer 1 classifier
 * @param {object} sourceContext - From Layer 0
 * @param {object} convo - Current conversation
 * @param {string} psid - User's PSID
 * @returns {object} Response { text, type }
 */
async function handle(classification, sourceContext, convo, psid) {
  const { intent, entities } = classification;

  // Get current state
  let state = getFlowState(convo);

  console.log(`🌱 Borde flow - Current state:`, state);
  console.log(`🌱 Borde flow - Intent: ${intent}, Entities:`, entities);

  // Check for borde length in entities
  let selectedLength = null;

  if (entities.borde_length && BORDE_PRODUCTS[entities.borde_length]) {
    selectedLength = entities.borde_length;
  }

  // If we have a length, show the product link
  if (selectedLength) {
    const product = BORDE_PRODUCTS[selectedLength];
    const trackedLink = await generateClickLink(psid, product.link, {
      productName: `Borde Separador ${selectedLength}m`,
      city: convo?.city,
      stateMx: convo?.stateMx
    });

    // Save state
    await updateConversation(psid, {
      lastIntent: "borde_complete",
      productInterest: "borde_separador",
      productSpecs: {
        productType: "borde_separador",
        borde_length: selectedLength,
        quantity: entities.quantity || state.quantity,
        updatedAt: new Date()
      }
    });

    const quantityText = entities.quantity ? `Para ${entities.quantity} rollos, ` : "";

    return {
      type: "text",
      text: `¡Claro! ${quantityText}Aquí está el borde separador de ${selectedLength} metros:\n\n` +
            `${trackedLink}\n\n` +
            `Ahí puedes ver el precio y realizar tu compra. El envío está incluido 📦\n\n` +
            `¿Necesitas algo más?`
    };
  }

  // No length specified - ask for it
  await updateConversation(psid, {
    lastIntent: "borde_awaiting_length",
    productInterest: "borde_separador",
    productSpecs: {
      productType: "borde_separador",
      updatedAt: new Date()
    }
  });

  // Check if this is a price query
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "¡Claro! Manejamos borde separador para jardín en diferentes presentaciones:\n\n" +
            "• Rollo de 6 metros\n" +
            "• Rollo de 9 metros\n" +
            "• Rollo de 18 metros\n" +
            "• Rollo de 54 metros\n\n" +
            "¿Qué largo necesitas? Te paso el link con precio."
    };
  }

  // General inquiry
  return {
    type: "text",
    text: "¡Hola! Sí manejamos borde separador para jardín 🌿\n\n" +
          "Sirve para delimitar áreas de pasto, crear caminos y separar zonas de tu jardín.\n\n" +
          "Tenemos rollos de 6m, 9m, 18m y 54m.\n\n" +
          "¿Qué largo te interesa?"
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // Explicitly about borde
  if (product === "borde_separador") return true;

  // Already in borde flow
  if (convo?.productSpecs?.productType === "borde_separador") return true;
  if (convo?.lastIntent?.startsWith("borde_")) return true;
  if (convo?.productInterest === "borde_separador") return true;

  // Source indicates borde
  if (sourceContext?.ad?.product === "borde_separador") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  BORDE_PRODUCTS
};
