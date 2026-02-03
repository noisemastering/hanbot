// ai/handlers/specs.js
// Handlers for specification queries: colors, shade percentage, eyelets, etc.
// These handlers receive AI-classified entities - NO regex pattern matching

const { updateConversation } = require("../../conversationManager");

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

  // Check if user is asking about a specific unavailable color
  if (entities.color) {
    const requestedColor = entities.color.toLowerCase();

    if (!AVAILABLE_COLORS.includes(requestedColor)) {
      return {
        type: "text",
        text: `No manejamos malla sombra en color ${requestedColor}.\n\n` +
              `La malla confeccionada lista para instalar es color beige.\n\n` +
              `¿Te interesa en beige?`
      };
    }
  }

  // General color availability question
  const productType = convo?.productInterest || convo?.productSpecs?.productType;

  if (productType === 'rollo') {
    return {
      type: "text",
      text: "Los rollos de malla sombra los manejamos en:\n\n" +
            "• Beige\n" +
            "• Negro\n" +
            "• Verde\n\n" +
            "¿Qué color te interesa?"
    };
  }

  // Default: malla confeccionada
  return {
    type: "text",
    text: "La malla sombra confeccionada lista para instalar es color beige.\n\n" +
          "¿Qué medida necesitas?"
  };
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

  if (productType === 'rollo') {
    return {
      type: "text",
      text: "En rollos manejamos malla sombra desde 35% (sombra ligera) hasta 90% (máxima protección).\n\n" +
            "¿Qué porcentaje te interesa?"
    };
  }

  // Default: malla confeccionada is always 90%
  return {
    type: "text",
    text: "Manejamos malla sombra desde 35% (sombra ligera) hasta 90% (máxima protección).\n\n" +
          "El más popular es el 80%, ofrece buena sombra sin oscurecer demasiado.\n\n" +
          "¿Qué porcentaje te interesa?"
  };
}

/**
 * Handle eyelets/argollas query - "Tiene ojillos?", "Trae argollas?"
 */
async function handleEyeletsQuery({ psid }) {
  await updateConversation(psid, {
    lastIntent: "eyelets_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Sí, nuestra malla confeccionada viene con argollas reforzadas en todo el perímetro, lista para instalar.\n\n" +
          "Solo necesitas amarrarla o usar ganchos. ¿Qué medida te interesa?"
  };
}

module.exports = {
  handleColorQuery,
  handleShadePercentageQuery,
  handleEyeletsQuery
};
