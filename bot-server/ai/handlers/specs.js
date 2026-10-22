// ⚠️ UNREACHABLE SINCE 27305c0 (2026-06-15) — "Cut the legacy tie for workflow-owned
// conversations". ai/index.js returns at the WORKFLOW OWNERSHIP block (~line 582);
// everything that requires this file sits BELOW that return, so for every ad and
// cold-start conversation — i.e. all traffic — none of this runs.
//
// DO NOT fix a customer-facing bug here: the fix will not ship. Four months of fixes
// in this directory went silent in that one commit and resurfaced as customer reports
// (location answered as an offer instead of an address, garantía never answered,
// "¿a cómo el metro cuadrado?" answered with a question). The live answers now live in
// ai/workflow/setupContext.js (company + product facts) and the deterministic gates in
// ai/workflow/index.js. Scenario group `info` in scripts/scenarioBattery.js covers them.
//
// Kept, not deleted: the file is still imported below the cutover and by
// ai/middleware/*, so removing it is a separate change with its own testing.
// ai/handlers/specs.js
// Handlers for specification queries: colors, shade percentage, eyelets, etc.
// These handlers receive AI-classified entities - NO regex pattern matching

const { updateConversation } = require("../../conversationManager");
const { generateBotResponse } = require("../responseGenerator");

// Available colors for malla sombra confeccionada
const AVAILABLE_COLORS = ['beige'];
const ALL_MALLA_COLORS = ['beige', 'negro', 'verde']; // All colors in product line

// Normalize feminine/variant color names to canonical masculine form
function normalizeColor(color) {
  if (!color) return null;
  const map = {
    'negra': 'negro', 'blanca': 'blanco', 'roja': 'rojo',
    'café': 'cafe', 'marrón': 'marron', 'marron': 'marron'
  };
  const lower = color.toLowerCase();
  return map[lower] || lower;
}

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
  const requestedColor = normalizeColor(entities?.color);
  const colorList = productType === 'rollo' ? ALL_MALLA_COLORS : AVAILABLE_COLORS;
  const isUnavailableColor = requestedColor && !colorList.includes(requestedColor);

  const response = await generateBotResponse("color_query", {
    requestedColor,
    isUnavailableColor,
    productType,
    availableColors: colorList,
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
