// ai/handlers/products.js
// Handlers for product-related intents: catalog, comparison, largest/smallest

const { updateConversation } = require("../../conversationManager");
const { getAvailableSizes } = require("../../measureHandler");
const { generateClickLink } = require("../../tracking");
const { generateBotResponse } = require("../responseGenerator");
const ProductFamily = require("../../models/ProductFamily");

/**
 * Handle catalog request - "Muéstrame las opciones", "Qué medidas tienen"
 */
async function handleCatalogRequest({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "catalog_request",
    unknownCount: 0
  });

  // Fetch REAL sizes from database
  const availableSizes = await getAvailableSizes(convo);

  if (availableSizes.length > 0) {
    // Sort by area
    const sorted = [...availableSizes].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaA - areaB;
    });

    const smallest = sorted[0];
    const largest = sorted[sorted.length - 1];

    // Build size list - show key sizes with prices
    // Pick: smallest, a few middle ones, largest
    const keyIndices = [0];
    if (sorted.length > 4) keyIndices.push(Math.floor(sorted.length * 0.25));
    if (sorted.length > 2) keyIndices.push(Math.floor(sorted.length * 0.5));
    if (sorted.length > 4) keyIndices.push(Math.floor(sorted.length * 0.75));
    keyIndices.push(sorted.length - 1);

    // Remove duplicates and get unique sizes
    const uniqueIndices = [...new Set(keyIndices)];
    const keySizes = uniqueIndices.map(i => sorted[i]);

    // Format as list
    const sizeList = keySizes.map(s => `• ${s.sizeStr} - $${s.price}`).join('\n');

    const response = `Estas son algunas de nuestras medidas disponibles:\n\n${sizeList}\n\nTenemos ${sorted.length} medidas en total, desde ${smallest.sizeStr} hasta ${largest.sizeStr}.\n\n¿Qué medida te interesa?`;

    return { type: "text", text: response };
  }

  // Fallback if no sizes found
  const response = await generateBotResponse("catalog_request", {
    hasVariousSizes: true,
    sizeRange: '2x2m hasta 6x10m',
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle product comparison - "Diferencia entre raschel y monofilamento"
 */
async function handleProductComparison({ entities, psid, userMessage, convo }) {
  await updateConversation(psid, {
    lastIntent: "product_comparison",
    unknownCount: 0
  });

  // Check what products are being compared
  const isRaschelMono = /raschel.*monofilamento|monofilamento.*raschel/i.test(userMessage);
  const isConfeccionadaRollo = /confeccionada.*rollo|rollo.*confeccionada/i.test(userMessage);

  let comparisonType = 'general';
  if (isRaschelMono) comparisonType = 'raschel_vs_monofilamento';
  if (isConfeccionadaRollo) comparisonType = 'confeccionada_vs_rollo';

  const response = await generateBotResponse("product_comparison", {
    comparisonType,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle largest product query - "La más grande", "Medida máxima"
 */
async function handleLargestProduct({ psid, convo }) {
  const availableSizes = await getAvailableSizes(convo);

  if (availableSizes.length > 0) {
    // Sort by area (largest first)
    const sorted = [...availableSizes].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaB - areaA;
    });

    const largest = sorted[0];

    // Try to find the product for ML link
    try {
      const sizeVariants = [largest.sizeStr, largest.sizeStr.replace('m', ''), largest.sizeStr + 'm'];
      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: { $ne: false }
      }).lean();

      if (product) {
        const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                             product.onlineStoreLinks?.[0]?.url;

        if (preferredLink) {
          const trackedLink = await generateClickLink(psid, preferredLink, {
            productName: product.name,
            productId: product._id,
            city: convo?.city,
            stateMx: convo?.stateMx
          });

          await updateConversation(psid, {
            lastIntent: "largest_product_shown",
            unknownCount: 0
          });

          const response = await generateBotResponse("largest_product", {
            dimensions: largest.sizeStr,
            price: largest.price,
            link: trackedLink,
            convo
          });

          return { type: "text", text: response };
        }
      }
    } catch (err) {
      console.error("Error fetching largest product:", err);
    }

    // Fallback without link
    await updateConversation(psid, {
      lastIntent: "largest_product_shown",
      unknownCount: 0
    });

    const response = await generateBotResponse("largest_product", {
      dimensions: largest.sizeStr,
      price: largest.price,
      convo
    });

    return { type: "text", text: response };
  }

  // Fallback
  const response = await generateBotResponse("largest_product", {
    dimensions: '6x10m',
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle smallest product query - "La más chica", "Medida mínima"
 */
async function handleSmallestProduct({ psid, convo }) {
  const availableSizes = await getAvailableSizes(convo);

  if (availableSizes.length > 0) {
    // Sort by area (smallest first)
    const sorted = [...availableSizes].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaA - areaB;
    });

    const smallest = sorted[0];

    await updateConversation(psid, {
      lastIntent: "smallest_product_shown",
      unknownCount: 0
    });

    const response = await generateBotResponse("smallest_product", {
      dimensions: smallest.sizeStr,
      price: smallest.price,
      convo
    });

    return { type: "text", text: response };
  }

  const response = await generateBotResponse("smallest_product", {
    dimensions: '2x2m',
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle durability query - "Cuánto tiempo dura?", "Vida útil?"
 */
async function handleDurabilityQuery({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "durability_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("durability_query", {
    lifespan: '8-10 años',
    hasUVProtection: true,
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleCatalogRequest,
  handleProductComparison,
  handleLargestProduct,
  handleSmallestProduct,
  handleDurabilityQuery
};
