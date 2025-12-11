// ai/core/rollQuery.js
// Handles queries about rolls (rollos) with enriched product information

const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const { enrichProductWithContext, formatProductForBot } = require("../utils/productEnricher");

/**
 * Detects if user is asking about rolls
 */
function isRollQuery(msg) {
  const rollPatterns = [
    /\b(rollo|rollos)\b/i,
    /\b(precio\s+rollo|rollo\s+precio)\b/i,
    /\b(rollo\s+completo|rollo\s+entero)\b/i,
    /\b(4\.?20?\s*[xX×*]\s*100|2\.?10?\s*[xX×*]\s*100)\b/i, // Common roll dimensions
    /\b(metro\s+completo|por\s+metro)\b/i
  ];

  return rollPatterns.some(pattern => pattern.test(msg));
}

/**
 * Handles roll queries with enriched product information
 */
async function handleRollQuery(userMessage, psid, convo) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();

    if (!isRollQuery(cleanMsg)) {
      return null;
    }

    console.log("🎯 Roll query detected, fetching enriched roll products...");

    // Find all sellable roll products
    const rollProducts = await ProductFamily.find({
      sellable: true,
      available: true,
      name: /rollo/i
    })
      .populate('parentId')
      .sort({ priority: -1, createdAt: -1 })
      .limit(10);

    if (!rollProducts || rollProducts.length === 0) {
      console.log("⚠️ No roll products found in catalog");
      return null;
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
        responseText += `**${category}**\n`;
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
  handleRollQuery
};
