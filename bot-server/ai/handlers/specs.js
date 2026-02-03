// ai/handlers/specs.js
// Handlers for specification queries: colors, shade percentage, eyelets, etc.
// These handlers receive AI-classified entities - NO regex pattern matching

const { updateConversation } = require("../../conversationManager");
const { generateBotResponse } = require("../responseGenerator");

// Available colors for malla sombra confeccionada
const AVAILABLE_COLORS = ['beige'];
const ALL_MALLA_COLORS = ['beige', 'negro', 'verde']; // All colors in product line

/**
 * Handle color query - "Qué colores tienen?", "De qué colores hay?"
 *
 * THIS WAS A BUG: "Que colores tiene en existencia" was matching location_query
 * because "tiene en existencia" looked like a location pattern.
 * Now AI classification catches this as color_query FIRST.
 */
async function handleColorQuery({ entities, psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "color_query",
    unknownCount: 0
  });

  const productType = convo?.productInterest || convo?.productSpecs?.productType;
  const requestedColor = entities?.color?.toLowerCase();
  const isUnavailableColor = requestedColor && !AVAILABLE_COLORS.includes(requestedColor);

  const response = await generateBotResponse("color_query", {
    requestedColor,
    isUnavailableColor,
    productType,
    availableColors: productType === 'rollo' ? ALL_MALLA_COLORS : AVAILABLE_COLORS,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle shade percentage query - "Qué porcentaje de sombra?", "Cuánta sombra da?"
 */
async function handleShadePercentageQuery({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "shade_percentage_query",
    unknownCount: 0
  });

  const productType = convo?.productInterest || convo?.productSpecs?.productType;

  const response = await generateBotResponse("shade_percentage_query", {
    productType,
    availablePercentages: productType === 'rollo' ? ['35%', '50%', '70%', '80%', '90%'] : ['90%'],
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle eyelets/argollas query - "Tiene ojillos?", "Trae argollas?"
 */
async function handleEyeletsQuery({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "eyelets_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("eyelets_query", {
    hasEyelets: true,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleColorQuery,
  handleShadePercentageQuery,
  handleEyeletsQuery
};
