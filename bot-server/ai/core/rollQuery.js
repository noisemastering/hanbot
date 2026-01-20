// ai/core/rollQuery.js
// Handles queries about rolls (rollos) with enriched product information

const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const { enrichProductWithContext, formatProductForBot, getProductDisplayName } = require("../utils/productEnricher");

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

    // 📏 Check if user is asking for a SPECIFIC roll dimension (e.g., "4x100", "precio del 4x100")
    const rollDimMatch = cleanMsg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(100)\b|(100)\s*[xX×*]\s*(\d+(?:\.\d+)?)/i);
    if (rollDimMatch) {
      const width = rollDimMatch[1] || rollDimMatch[4];
      const length = rollDimMatch[2] || rollDimMatch[3];
      const requestedRollSize = `${width}x${length}`;
      console.log(`📦 Specific roll dimension requested: ${requestedRollSize}`);

      await updateConversation(psid, {
        lastIntent: "roll_query_specific",
        state: "active",
        unknownCount: 0,
        productInterest: "rollo"
      });

      // Common roll widths: 4.20m and 2.10m
      const standardWidths = [4.20, 2.10, 4.2, 2.1, 4, 2];
      const parsedWidth = parseFloat(width);
      const isStandardWidth = standardWidths.some(w => Math.abs(w - parsedWidth) < 0.1);

      if (isStandardWidth) {
        // Standard roll size - provide info and quote contact
        return {
          type: "text",
          text: `El rollo de ${width}m x 100m lo tenemos desde 35% hasta 90% de sombra.\n\n` +
                `¿Qué porcentaje necesitas?`
        };
      } else {
        // Non-standard width - inform of available widths
        return {
          type: "text",
          text: `Los rollos de malla sombra los manejamos en anchos estándar de:\n\n` +
                `• 4.20m x 100m (420 m² por rollo)\n` +
                `• 2.10m x 100m (210 m² por rollo)\n\n` +
                `¿Te interesa alguno de estos? Te paso la cotización.`
        };
      }
    }

    // Check if user is asking for a specific percentage
    const percentageMatch = cleanMsg.match(/(\d{2,3})\s*%/);
    const requestedPercentage = percentageMatch ? percentageMatch[1] : null;

    if (requestedPercentage) {
      console.log(`📊 User requested ${requestedPercentage}% shade`);
    }

    // PROPER FAMILY-BASED FILTERING
    // Only include products that are descendants of "Malla Sombra Raschel" family
    // This correctly excludes Borde Separador, Cinta Rígida, etc.

    const MALLA_SOMBRA_ROOT_ID = '68f6c372bfaca6a28884afd7'; // Malla Sombra Raschel root

    // Helper to get all descendant IDs of a family
    async function getDescendantIds(parentId, depth = 0) {
      if (depth > 6) return []; // Prevent infinite recursion
      const children = await ProductFamily.find({ parentId, active: true });
      let ids = children.map(c => c._id);
      for (const child of children) {
        const grandIds = await getDescendantIds(child._id, depth + 1);
        ids = ids.concat(grandIds);
      }
      return ids;
    }

    // Get all product IDs in the Malla Sombra family
    const mallaSombraFamilyIds = await getDescendantIds(MALLA_SOMBRA_ROOT_ID);
    console.log(`📊 Found ${mallaSombraFamilyIds.length} products in Malla Sombra family`);

    // Build query for sellable roll products ONLY in Malla Sombra family
    const query = {
      _id: { $in: mallaSombraFamilyIds },
      sellable: true,
      active: true
    };

    // If specific percentage requested, filter by it
    if (requestedPercentage) {
      // Find the percentage category first, then get its descendants
      const percentageCategory = await ProductFamily.findOne({
        parentId: MALLA_SOMBRA_ROOT_ID,
        name: new RegExp(`^${requestedPercentage}%?$`, 'i')
      });

      if (percentageCategory) {
        const percentageDescendants = await getDescendantIds(percentageCategory._id);
        query._id = { $in: percentageDescendants };
        console.log(`📊 Filtering to ${requestedPercentage}%: ${percentageDescendants.length} products`);
      }
    }

    // Find sellable products (rolls or roll-like products)
    let rollProducts = await ProductFamily.find(query)
      .populate('parentId')
      .sort({ priority: -1, createdAt: -1 })
      .limit(20);

    console.log(`✅ Found ${rollProducts.length} sellable malla sombra products`);

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
      responseText += "Disponibles desde 35% hasta 90% de sombra.\n\n";

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

    // Deduplicate by name + price (remove exact duplicates)
    const seen = new Set();
    const uniqueRolls = enrichedRolls.filter(roll => {
      const key = `${roll.name}|${roll.price || 0}`;
      if (seen.has(key)) {
        console.log(`⚠️ Skipping duplicate: ${roll.name} $${roll.price}`);
        return false;
      }
      seen.add(key);
      return true;
    });
    console.log(`📊 After deduplication: ${uniqueRolls.length} unique products (from ${enrichedRolls.length})`);

    // If user didn't specify percentage and we have multiple percentages, ask first
    // Get unique percentages from the products
    const percentages = new Set();
    for (const roll of uniqueRolls) {
      // Get percentage from ancestry (e.g., "80%" from grandparent)
      if (roll.ancestryPath) {
        const percentMatch = roll.ancestryPath.match(/(\d{2,3})%/);
        if (percentMatch) percentages.add(percentMatch[1]);
      }
    }

    // If multiple percentages and user didn't specify, ask first
    if (percentages.size > 1 && !requestedPercentage) {
      const percList = Array.from(percentages).sort((a, b) => parseInt(a) - parseInt(b));
      await updateConversation(psid, {
        lastIntent: "roll_query_need_percentage",
        state: "active",
        unknownCount: 0
      });

      // If more than 3 options, show range; otherwise list them
      let optionsText;
      if (percList.length > 3) {
        const minPerc = percList[0];
        const maxPerc = percList[percList.length - 1];
        optionsText = `desde ${minPerc}% hasta ${maxPerc}%`;
      } else {
        optionsText = `en ${percList.map(p => `${p}%`).join(', ')}`;
      }

      return {
        type: "text",
        text: `¡Claro! Manejamos rollos de malla sombra ${optionsText}.\n\n¿Qué porcentaje necesitas?`
      };
    }

    // Build response with enriched information
    let responseText = "¡Claro! Manejamos rollos completos de malla sombra 🌿\n\n";

    // Group by percentage (from ancestry path)
    const byPercentage = {};
    for (const roll of uniqueRolls) {
      let percentage = "General";
      if (roll.ancestryPath) {
        const percentMatch = roll.ancestryPath.match(/(\d{2,3})%/);
        if (percentMatch) percentage = `${percentMatch[1]}%`;
      }
      if (!byPercentage[percentage]) {
        byPercentage[percentage] = [];
      }
      byPercentage[percentage].push(roll);
    }

    // Build response organized by percentage
    for (const [percentage, rolls] of Object.entries(byPercentage)) {
      if (percentage !== "General") {
        responseText += `**${percentage} de sombra:**\n`;
      }

      for (const roll of rolls) {
        // Get proper display name using naming templates (mini verbosity for listings)
        const displayName = await getProductDisplayName(roll, 'mini');

        responseText += `• ${displayName}`;

        // Add price
        if (roll.price) {
          responseText += ` - $${roll.price}`;
        }

        responseText += "\n";
      }
      responseText += "\n";
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
