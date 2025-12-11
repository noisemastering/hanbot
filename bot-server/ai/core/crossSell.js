// ai/core/crossSell.js
const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const { formatProductForBot, enrichProductWithContext } = require("../utils/productEnricher");

/**
 * Detects when customer asks about a product different from current conversation context
 * Returns generic product info, then allows AI to provide full details on follow-up
 */
async function handleProductCrossSell(userMessage, psid, convo, availableProducts) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();

    // Extract potential product mentions from user message
    const productKeywords = [
      'malla sombra', 'malla', 'sombra',
      'antimaleza', 'anti maleza', 'rollo antimaleza',
      'raschel', 'monofilamento',
      'invernadero', 'agricultura', 'agricola'
    ];

    // Check if user is asking about a product
    const isProductQuery = /\b(qu[eé]|tienen|manejan|venden|precio|costo|informaci[oó]n|medidas?|tama[ñn]os?|disponible)\b/i.test(cleanMsg);

    if (!isProductQuery) {
      return null;
    }

    // Find all sellable products in catalog (with parent populated for context)
    const allProducts = await ProductFamily.find({
      sellable: true,
      available: true
    }).populate('parentId').lean();

    if (!allProducts || allProducts.length === 0) {
      return null;
    }

    // Check if user is asking about a product not in current context
    let mentionedProduct = null;

    for (const product of allProducts) {
      const productName = product.name.toLowerCase();

      // Check if this product is mentioned in user message
      if (cleanMsg.includes(productName)) {
        // Check if this product is NOT in the available products for current conversation
        const isInContext = availableProducts.some(p =>
          p._id.toString() === product._id.toString()
        );

        if (!isInContext) {
          mentionedProduct = product;
          break;
        }
      }
    }

    if (!mentionedProduct) {
      return null;
    }

    console.log(`🔄 Cross-sell detected: Customer asking about ${mentionedProduct.name}`);

    // Enrich product with parent context and full descriptions
    const enrichedProduct = await enrichProductWithContext(mentionedProduct);

    // Build product description with parent context
    let productInfo = enrichedProduct.name;

    // Add parent category context if available
    if (enrichedProduct.parentContext && enrichedProduct.parentContext.name) {
      productInfo = `${enrichedProduct.name} (${enrichedProduct.parentContext.name})`;
    }

    // Add description (prefer contextDescription which includes parent info)
    const description = enrichedProduct.contextDescription ||
                       enrichedProduct.genericDescription ||
                       enrichedProduct.description;

    if (description) {
      productInfo += ` - ${description}`;
    }

    // Check if product requires human advisor
    if (mentionedProduct.requiresHumanAdvisor) {
      console.log(`👨‍💼 Product requires human advisor, will offer handoff`);
      await updateConversation(psid, {
        lastIntent: "cross_sell_human_required",
        requestedProduct: mentionedProduct._id
      });

      return {
        type: "text",
        text: `Claro, también manejamos ${productInfo} 🌿\n\n` +
              `Este producto requiere asesoría personalizada para asegurarnos de ofrecerte la mejor solución. ¿Te conecto con un asesor?`
      };
    }

    // Product doesn't require human advisor - provide enriched info
    await updateConversation(psid, {
      lastIntent: "cross_sell_info_provided",
      requestedProduct: mentionedProduct._id,
      // Allow AI to pull full catalog details on next message
      allowCatalogQuery: true
    });

    const response = {
      type: "text",
      text: `¡Claro! También manejamos ${productInfo} 🌿\n\n` +
            `¿Te gustaría conocer precios y medidas disponibles?`
    };

    return response;

  } catch (error) {
    console.error("❌ Error in handleProductCrossSell:", error);
    return null;
  }
}

/**
 * Check if conversation context indicates customer wants full product details
 * after a cross-sell generic response
 */
function shouldProvideFullCatalog(convo, userMessage) {
  if (!convo.lastIntent || !convo.requestedProduct) {
    return false;
  }

  if (convo.lastIntent !== "cross_sell_info_provided") {
    return false;
  }

  const cleanMsg = userMessage.toLowerCase().trim();
  const affirmativePatterns = /\b(s[ií]|claro|ok|bueno|dale|perfecto|me interesa|quiero|necesito)\b/i;

  return affirmativePatterns.test(cleanMsg);
}

module.exports = {
  handleProductCrossSell,
  shouldProvideFullCatalog
};
