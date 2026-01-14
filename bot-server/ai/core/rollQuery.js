// ai/core/rollQuery.js
// Handles queries about rolls (rollos) with enriched product information

const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const { enrichProductWithContext, formatProductForBot } = require("../utils/productEnricher");

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
  const rollPatterns = [
    /\b(rol+[oy]s?)\b/i,  // Matches rollo, rollos, royo, royos (handles typos)
    /\b(me\s+interesa\s+(?:un\s+)?rol+[oy])\b/i,  // "me interesa un rollo/royo"
    /\b(quiero\s+(?:un\s+)?rol+[oy])\b/i,  // "quiero un rollo/royo"
    /\b(necesito\s+(?:un\s+)?rol+[oy])\b/i,  // "necesito un rollo/royo"
    /\b(precio\s+rol+[oy]|rol+[oy]\s+precio)\b/i,
    /\b(rol+[oy]\s+completo|rol+[oy]\s+entero)\b/i,
    /\b(4\.?20?\s*[xX×*]\s*100|2\.?10?\s*[xX×*]\s*100)\b/i, // Common roll dimensions
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
 */
async function handleRollQuery(userMessage, psid, convo) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();

    // First check if it's a dimension-specific question
    const dimensionResponse = await handleRollDimensionQuery(userMessage, psid, convo);
    if (dimensionResponse) {
      return dimensionResponse;
    }

    if (!isRollQuery(cleanMsg)) {
      return null;
    }

    console.log("🎯 Roll query detected, fetching enriched roll products...");

    // Check if user is asking for a specific percentage
    const percentageMatch = cleanMsg.match(/(\d{2,3})\s*%/);
    const requestedPercentage = percentageMatch ? percentageMatch[1] : null;

    if (requestedPercentage) {
      console.log(`📊 User requested ${requestedPercentage}% shade`);
    }

    // Build query - ONLY match actual malla sombra rolls (not plastic tapes, borders, etc.)
    // Malla sombra rolls are characterized by:
    // - Large dimensions like "x 100m", "4.20", "2.10"
    // - Shade percentages like "70%", "80%", "90%"
    // - Keywords like "malla sombra", "shade"
    const mallaSombraRollPatterns = [
      /\b(malla\s*sombra|shade\s*cloth|sombra)\b/i,
      /\b(4\.?20?|2\.?10?)\s*[xX×*]\s*100\b/i,  // Standard roll dimensions
      /\b\d{2,3}\s*%\s*(sombra|shade)?\b/i,      // Shade percentages
      /\bx\s*100\s*m/i                            // "x 100m" pattern
    ];

    // Base query for malla sombra rolls
    const query = {
      sellable: true,
      active: true,
      $and: [
        // Must have "rollo" in name
        { name: /rollo/i },
        // Must match at least one malla sombra pattern (in name OR description)
        {
          $or: [
            { name: { $in: mallaSombraRollPatterns.map(p => p) } },
            { description: { $in: mallaSombraRollPatterns.map(p => p) } },
            // OR have a parent that's malla sombra (will check after query)
          ]
        }
      ]
    };

    // If specific percentage requested, add it to the query
    if (requestedPercentage) {
      query.$and.push({
        $or: [
          { name: new RegExp(`${requestedPercentage}\\s*%`, 'i') },
          { description: new RegExp(`${requestedPercentage}\\s*%`, 'i') }
        ]
      });
    }

    // Find potential roll products
    let rollProducts = await ProductFamily.find({
      sellable: true,
      active: true,
      name: /rollo/i
    })
      .populate('parentId')
      .sort({ priority: -1, createdAt: -1 })
      .limit(50);

    // Filter to only include actual malla sombra products
    // Exclude: Borde Separador, Cinta, Polipropileno, etc.
    const excludePatterns = [
      /borde\s*separador/i,
      /cinta\s*(r[ií]gida|pl[aá]stica)?/i,
      /polipropileno/i,
      /pulgadas?/i,
      /\bcm\s+de\s+ancho/i  // Small widths in cm, not meters
    ];

    rollProducts = rollProducts.filter(product => {
      const fullText = `${product.name} ${product.description || ''}`;

      // Exclude if matches any exclude pattern
      if (excludePatterns.some(pattern => pattern.test(fullText))) {
        console.log(`🚫 Excluding non-malla product: ${product.name}`);
        return false;
      }

      // Include if matches malla sombra patterns
      if (mallaSombraRollPatterns.some(pattern => pattern.test(fullText))) {
        return true;
      }

      // Include if parent is malla sombra related
      if (product.parentId) {
        const parentName = product.parentId.name || '';
        if (/malla\s*sombra|shade|sombra/i.test(parentName)) {
          return true;
        }
      }

      // If percentage requested and product has it, include
      if (requestedPercentage && new RegExp(`${requestedPercentage}\\s*%`, 'i').test(fullText)) {
        return true;
      }

      return false;
    });

    // Limit results
    rollProducts = rollProducts.slice(0, 20);

    if (!rollProducts || rollProducts.length === 0) {
      console.log("⚠️ No malla sombra roll products found in catalog, using default response");

      // Provide standard roll information
      await updateConversation(psid, {
        lastIntent: "roll_query",
        state: "active",
        unknownCount: 0
      });

      let responseText = "Manejamos rollos de malla sombra en las siguientes medidas:\n\n";
      responseText += "📏 **Rollos de 100 metros:**\n";
      responseText += "• 4.20m x 100m (420 m² por rollo)\n";
      responseText += "• 2.10m x 100m (210 m² por rollo)\n\n";
      responseText += "Disponibles en 35%, 50%, 70%, 80% y 90% de sombra.\n\n";

      if (requestedPercentage) {
        responseText += `Para cotizar rollos de ${requestedPercentage}%, contáctanos:\n`;
        responseText += "💬 WhatsApp: https://wa.me/524425957432\n";
      } else {
        responseText += "¿Qué porcentaje de sombra necesitas?";
      }

      return {
        type: "text",
        text: responseText
      };
    }

    console.log(`✅ Found ${rollProducts.length} roll products`);

    // Enrich products with parent context
    const enrichedRolls = await Promise.all(
      rollProducts.map(product => enrichProductWithContext(product))
    );

    // Build response with enriched information
    let responseText = "¡Claro! Manejamos rollos completos de malla sombra 🌿\n\n";

    // Group by parent/category if possible
    const byCategory = {};
    for (const roll of enrichedRolls) {
      const category = roll.parentContext?.name || "General";
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(roll);
    }

    // Build response organized by category
    for (const [category, rolls] of Object.entries(byCategory)) {
      if (category !== "General") {
        responseText += `${category}\n`;
      }

      for (const roll of rolls) {
        // Product name and dimensions
        responseText += `• ${roll.name}`;

        // Add description if available
        const description = roll.contextDescription || roll.genericDescription || roll.description;
        if (description && description.length < 100) {
          responseText += ` - ${description}`;
        }

        // Add price
        if (roll.price) {
          responseText += `\n  💰 $${roll.price}`;
        }

        // Add key specs if available
        if (roll.attributes) {
          const specs = [];
          if (roll.attributes.get('material')) specs.push(`Material: ${roll.attributes.get('material')}`);
          if (roll.attributes.get('shade')) specs.push(`Sombra: ${roll.attributes.get('shade')}`);
          if (specs.length > 0) {
            responseText += `\n  📋 ${specs.join(" | ")}`;
          }
        }

        responseText += "\n\n";
      }
    }

    // Add context based on customer type
    if (convo.customerType === 'distributor') {
      responseText += "Como distribuidor, podemos ofrecerte precios especiales en volumen. ¿Te interesa algún rollo en particular?";
    } else if (convo.customerType === 'fabricator') {
      responseText += "Estos rollos son ideales para confeccionar tus propias medidas. ¿Cuál te interesa?";
    } else {
      responseText += "¿Te interesa alguno de estos rollos? También tenemos medidas ya confeccionadas si las prefieres.";
    }

    await updateConversation(psid, {
      lastIntent: "roll_query",
      state: "active",
      unknownCount: 0
    });

    return {
      type: "text",
      text: responseText
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
