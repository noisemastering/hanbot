// ai/core/rollQuery.js
// Handles queries about rolls (rollos) with enriched product information
// Now with proper state tracking - remembers specs across messages

const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const { enrichProductWithContext, formatProductForBot, getProductDisplayName } = require("../utils/productEnricher");

/**
 * Extract product specs from a user message
 * @param {string} msg - User's message
 * @returns {object} - Extracted specs { size, width, length, percentage, quantity, color, customerName }
 */
function extractSpecsFromMessage(msg) {
  const specs = {};
  const cleanMsg = msg.toLowerCase().trim();

  // Extract roll dimension (e.g., "2x100", "4.2x100")
  const rollDimMatch = cleanMsg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(100)\b|(100)\s*[xX×*]\s*(\d+(?:\.\d+)?)/i);
  if (rollDimMatch) {
    specs.width = parseFloat(rollDimMatch[1] || rollDimMatch[4]);
    specs.length = 100;
    specs.size = `${specs.width}x100`;
  }

  // Extract percentage (e.g., "90%", "al 80%", "80 por ciento")
  const percentMatch = cleanMsg.match(/(?:al\s+)?(\d{2,3})\s*(?:%|por\s*ciento)/i);
  if (percentMatch) {
    specs.percentage = parseInt(percentMatch[1]);
  }

  // Extract quantity (e.g., "15 rollos", "quiero 10", "necesito 5")
  const qtyMatch = cleanMsg.match(/(\d+)\s*(?:rol+[oy]s?|unidades?|piezas?)/i) ||
                   cleanMsg.match(/(?:quiero|necesito|ocupo|son)\s+(\d+)/i) ||
                   cleanMsg.match(/(?:por\s+lo\s+menos|minimo|mínimo)\s+(\d+)/i);
  if (qtyMatch) {
    specs.quantity = parseInt(qtyMatch[1]);
  }

  // Extract color
  const colorMatch = cleanMsg.match(/\b(negro|verde|beige|blanco|azul|gris)\b/i);
  if (colorMatch) {
    specs.color = colorMatch[1].toLowerCase();
  }

  // Extract customer name (e.g., "a nombre de Juan Perez")
  const nameMatch = msg.match(/(?:nombre\s+de|para|cliente)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
  if (nameMatch) {
    specs.customerName = nameMatch[1];
  }

  return specs;
}

/**
 * Merge new specs with existing specs (new values override)
 * @param {object} existing - Existing specs from conversation
 * @param {object} newSpecs - Newly extracted specs
 * @returns {object} - Merged specs
 */
function mergeSpecs(existing, newSpecs) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(newSpecs)) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }
  merged.updatedAt = new Date();
  return merged;
}

/**
 * Check what specs are still missing for a roll quote
 * @param {object} specs - Current specs
 * @returns {Array<string>} - Array of missing spec names
 */
function getMissingSpecs(specs) {
  const missing = [];
  if (!specs.width && !specs.size) missing.push('size');
  if (!specs.percentage) missing.push('percentage');
  // quantity is optional - we can ask at the end
  return missing;
}

/**
 * Generate response asking for the next missing spec
 * @param {object} specs - Current specs
 * @param {Array<string>} missing - Missing spec names
 * @returns {string} - Response text
 */
function generateMissingSpecQuestion(specs, missing) {
  // Acknowledge what we already know
  let ack = "";
  if (specs.size || specs.width) {
    ack += `Rollo de ${specs.width || specs.size?.split('x')[0]}m x 100m`;
    if (specs.percentage) ack += ` al ${specs.percentage}%`;
    if (specs.quantity) ack += `, ${specs.quantity} unidades`;
    ack += ".\n\n";
  }

  // Ask for the first missing spec
  if (missing.includes('size')) {
    return ack + "¿Qué ancho necesitas? Manejamos rollos de 2.10m y 4.20m de ancho (100m de largo).";
  }
  if (missing.includes('percentage')) {
    return ack + "¿Qué porcentaje de sombra necesitas? Tenemos desde 35% hasta 90%.";
  }

  return ack;
}

/**
 * Detects if user is asking about roll dimensions/meters
 * "cuánto metro trae cada rollo", "cuantos metros tiene un rollo", etc.
 */
function isRollDimensionQuery(msg) {
  const dimensionPatterns = [
    /\b(cu[aá]nto|cuanto)s?\s+(metro|mt|mts|m)\s+(tra[ey]|tiene|mide|viene)/i,
    /\b(cu[aá]nto|cuanto)s?\s+metros?\s+(tra[ey]|tiene|mide|viene)/i,
    /\b(metros?|mt|mts)\s+(tra[ey]|tiene|mide|viene)\s+(cada|el|un|los)?\s*(rol+[oy])/i,
    /\b(cu[aá]nto|cuanto)\s+(mide|tra[ey]|viene)\s+(el|cada|un)?\s*(rol+[oy])/i,
    /\b(medida|dimensi[oó]n|tama[ñn]o)\s+(del?|cada)?\s*(rol+[oy])/i,
    /\brol+[oy]s?\s+(de\s+)?cu[aá]ntos?\s+metros?/i,
    /\bde\s+cu[aá]ntos?\s+metros?\s+(son|es|vienen?|tra[ey]n?)\s+(los\s+)?rol+[oy]s?/i
  ];
  return dimensionPatterns.some(pattern => pattern.test(msg));
}

/**
 * Detects if user is asking about rolls
 */
function isRollQuery(msg) {
  // Exclude quantity patterns like "15 rollos", "10 unidades", etc.
  // These are quantity responses, not roll queries
  const quantityPatterns = /^\s*\d+\s*(rol+[oy]s?|unidades?|piezas?)\s*$/i;
  if (quantityPatterns.test(msg)) {
    return false;
  }

  const rollPatterns = [
    /\b(rol+[oy]s?)\b/i,  // Matches rollo, rollos, royo, royos (handles typos)
    /\b(me\s+interesa\s+(?:un\s+)?rol+[oy])\b/i,  // "me interesa un rollo/royo"
    /\b(quiero\s+(?:un\s+)?rol+[oy])\b/i,  // "quiero un rollo/royo"
    /\b(necesito\s+(?:un\s+)?rol+[oy])\b/i,  // "necesito un rollo/royo"
    /\b(precio\s+rol+[oy]|rol+[oy]\s+precio)\b/i,
    /\b(rol+[oy]\s+completo|rol+[oy]\s+entero)\b/i,
    /\b(\d+(?:\.\d+)?\s*[xX×*]\s*100|100\s*[xX×*]\s*\d+(?:\.\d+)?)\b/i, // Any roll dimension (Nx100 or 100xN)
    /\b(comprar\s+rol+[oy]|vender\s+rol+[oy])\b/i
  ];

  return rollPatterns.some(pattern => pattern.test(msg));
}

/**
 * Handles questions about roll dimensions/meters
 * Provides direct answer about roll sizes
 */
async function handleRollDimensionQuery(userMessage, psid, convo) {
  const cleanMsg = userMessage.toLowerCase().trim();

  if (!isRollDimensionQuery(cleanMsg)) {
    return null;
  }

  console.log("📏 Roll dimension query detected:", cleanMsg);

  await updateConversation(psid, {
    lastIntent: "roll_dimension_query",
    state: "active",
    unknownCount: 0
  });

  // Direct answer about roll dimensions
  const responseText =
    "Los rollos de malla sombra vienen en 100 metros de largo 📏\n\n" +
    "Anchos disponibles:\n" +
    "• 4.20m x 100m (420 m² por rollo)\n" +
    "• 2.10m x 100m (210 m² por rollo)\n\n" +
    "¿Te interesa cotizar algún rollo?";

  return {
    type: "text",
    text: responseText
  };
}

/**
 * Handles roll queries with enriched product information
 * Now with proper state tracking across messages
 */
async function handleRollQuery(userMessage, psid, convo) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();

    // First check if it's a dimension-specific question
    const dimensionResponse = await handleRollDimensionQuery(userMessage, psid, convo);
    if (dimensionResponse) {
      return dimensionResponse;
    }

    // Check if this is a roll-related query OR if we're in the middle of a roll flow
    const isRollFlow = convo.productSpecs?.productType === 'rollo' && convo.lastIntent?.startsWith('roll_');

    if (!isRollQuery(cleanMsg) && !isRollFlow) {
      return null;
    }

    console.log("🎯 Roll query detected, checking conversation state...");

    // ============================================================
    // STEP 1: Extract specs from current message
    // ============================================================
    const newSpecs = extractSpecsFromMessage(userMessage);
    console.log("📝 Extracted specs from message:", newSpecs);

    // ============================================================
    // STEP 2: Merge with existing specs from conversation
    // ============================================================
    const existingSpecs = convo.productSpecs || {};
    const mergedSpecs = mergeSpecs(existingSpecs, newSpecs);
    mergedSpecs.productType = 'rollo';

    console.log("📋 Merged specs:", mergedSpecs);

    // ============================================================
    // STEP 3: Check what's still missing
    // ============================================================
    const missing = getMissingSpecs(mergedSpecs);
    console.log("❓ Missing specs:", missing);

    // ============================================================
    // STEP 4: Save updated specs to conversation
    // ============================================================
    await updateConversation(psid, {
      lastIntent: missing.length > 0 ? "roll_query_incomplete" : "roll_query_complete",
      state: "active",
      unknownCount: 0,
      productInterest: "rollo",
      productSpecs: mergedSpecs
    });

    // ============================================================
    // STEP 5: If specs are complete, provide quote or hand off
    // ============================================================
    if (missing.length === 0) {
      // We have size and percentage - provide quote info
      const width = mergedSpecs.width;
      const percentage = mergedSpecs.percentage;
      const quantity = mergedSpecs.quantity || 1;
      const color = mergedSpecs.color;

      let response = `✅ Perfecto, te confirmo:\n\n`;
      response += `📦 Rollo de ${width}m x 100m al ${percentage}%`;
      if (color) response += ` color ${color}`;
      response += `\n📊 Cantidad: ${quantity} rollo${quantity > 1 ? 's' : ''}`;

      if (mergedSpecs.customerName) {
        response += `\n👤 Cliente: ${mergedSpecs.customerName}`;
      }

      response += `\n\nUn especialista te contactará para confirmar precio y disponibilidad. `;
      response += `¿Necesitas algo más?`;

      // Mark for human handoff
      await updateConversation(psid, {
        lastIntent: "roll_quote_ready",
        handoffRequested: true,
        handoffReason: `Roll quote: ${quantity}x ${width}m x 100m @ ${percentage}%${color ? ' ' + color : ''}`
      });

      return { type: "text", text: response };
    }

    // ============================================================
    // STEP 6: Ask for missing info (respecting what we already know)
    // ============================================================

    // If we have size but missing percentage
    if (!missing.includes('size') && missing.includes('percentage')) {
      const width = mergedSpecs.width;
      return {
        type: "text",
        text: `El rollo de ${width}m x 100m lo tenemos desde 35% hasta 90% de sombra.\n\n¿Qué porcentaje necesitas?`
      };
    }

    // If we're missing size
    if (missing.includes('size')) {
      // Check if user mentioned a non-standard width
      const rollDimMatch = cleanMsg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(100)\b|(100)\s*[xX×*]\s*(\d+(?:\.\d+)?)/i);
      if (rollDimMatch) {
        const width = parseFloat(rollDimMatch[1] || rollDimMatch[4]);
        const standardWidths = [4.20, 2.10, 4.2, 2.1, 4, 2];
        const isStandardWidth = standardWidths.some(w => Math.abs(w - width) < 0.1);

        if (!isStandardWidth) {
          return {
            type: "text",
            text: `Los rollos de malla sombra los manejamos en anchos estándar de:\n\n` +
                  `• 4.20m x 100m (420 m² por rollo)\n` +
                  `• 2.10m x 100m (210 m² por rollo)\n\n` +
                  `¿Te interesa alguno de estos?`
          };
        }
      }

      // Generic roll query - ask for size
      return {
        type: "text",
        text: `¡Claro! Manejamos rollos de malla sombra en:\n\n` +
              `• 4.20m x 100m (420 m² por rollo)\n` +
              `• 2.10m x 100m (210 m² por rollo)\n\n` +
              `¿Qué ancho necesitas?`
      };
    }

    // Fallback - ask for the first missing spec
    return {
      type: "text",
      text: generateMissingSpecQuestion(mergedSpecs, missing)
    };

  } catch (error) {
    console.error("❌ Error in handleRollQuery:", error);
    return null;
  }
}

module.exports = {
  isRollQuery,
  isRollDimensionQuery,
  handleRollQuery,
  handleRollDimensionQuery
};
