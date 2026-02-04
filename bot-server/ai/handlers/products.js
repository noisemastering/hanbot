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
    const keyIndices = [0];
    if (sorted.length > 4) keyIndices.push(Math.floor(sorted.length * 0.25));
    if (sorted.length > 2) keyIndices.push(Math.floor(sorted.length * 0.5));
    if (sorted.length > 4) keyIndices.push(Math.floor(sorted.length * 0.75));
    keyIndices.push(sorted.length - 1);

    const uniqueIndices = [...new Set(keyIndices)];
    const keySizes = uniqueIndices.map(i => sorted[i]);
    const sizeList = keySizes.map(s => `${s.sizeStr} - $${s.price}`).join(', ');

    // Let AI generate the response with real data
    const response = await generateBotResponse("catalog_request", {
      sizeList,
      totalSizes: sorted.length,
      smallestSize: smallest.sizeStr,
      smallestPrice: smallest.price,
      largestSize: largest.sizeStr,
      largestPrice: largest.price,
      convo
    });

    return { type: "text", text: response };
  }

  // Fallback if no sizes found
  const response = await generateBotResponse("catalog_request", { convo });

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

  const response = await generateBotResponse("product_comparison", {
    userMessage,
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
 * Handle product inquiry with dimensions - "Necesito 3x3", "Malla de 4x5"
 * Looks up product, gets price/link, and addresses any concerns
 */
async function handleProductInquiry({ entities, psid, convo, userMessage }) {
  const { width, height, dimensions, location, concerns } = entities;

  // If we have dimensions, look up the product
  if (width && height) {
    const w = Math.min(Math.floor(width), Math.floor(height));
    const h = Math.max(Math.floor(width), Math.floor(height));

    // Build size regex for matching
    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`,
      'i'
    );

    try {
      const product = await ProductFamily.findOne({
        sellable: true,
        active: true,
        size: sizeRegex
      }).sort({ price: 1 }).lean();

      if (product) {
        // Get purchase link
        const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                             product.onlineStoreLinks?.[0]?.url;

        let trackedLink = null;
        if (preferredLink) {
          trackedLink = await generateClickLink(psid, preferredLink, {
            productName: product.name,
            productId: product._id,
            city: convo?.city || location,
            stateMx: convo?.stateMx
          });
        }

        await updateConversation(psid, {
          lastIntent: "product_inquiry_quoted",
          requestedSize: `${w}x${h}`,
          unknownCount: 0,
          city: location || convo?.city
        });

        const response = await generateBotResponse("price_quote", {
          dimensions: `${w}x${h}m`,
          price: product.price,
          link: trackedLink,
          concerns: concerns,
          userMessage,
          convo: { ...convo, city: location || convo?.city }
        });

        return { type: "text", text: response };
      }

      // Product not found - find closest alternative
      const requestedArea = w * h;
      const availableSizes = await getAvailableSizes(convo);

      // Find closest size by area
      let closestSize = null;
      let closestDiff = Infinity;

      for (const size of availableSizes) {
        const area = (size.width || 0) * (size.height || 0);
        const diff = Math.abs(area - requestedArea);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestSize = size;
        }
      }

      await updateConversation(psid, {
        lastIntent: "size_not_available",
        requestedSize: `${w}x${h}`,
        unknownCount: 0
      });

      // Build response with closest alternative
      const responseData = {
        dimensions: `${w}x${h}m`,
        concerns: concerns,
        whatsapp: "https://wa.me/524425957432",
        convo
      };

      if (closestSize) {
        responseData.alternativeSize = closestSize.sizeStr;
        responseData.alternativePrice = closestSize.price;

        // Get link for alternative
        const altProduct = await ProductFamily.findOne({
          sellable: true,
          active: true,
          size: new RegExp(closestSize.sizeStr.replace('x', '\\s*[xX×]\\s*'), 'i')
        }).lean();

        if (altProduct) {
          const altLink = altProduct.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                         altProduct.onlineStoreLinks?.[0]?.url;
          if (altLink) {
            responseData.alternativeLink = await generateClickLink(psid, altLink, {
              productName: altProduct.name,
              productId: altProduct._id
            });
          }
        }
      }

      const response = await generateBotResponse("size_not_available", responseData);

      return { type: "text", text: response };

    } catch (err) {
      console.error("Error finding product:", err);
    }
  }

  // No dimensions - general product inquiry
  await updateConversation(psid, {
    lastIntent: "product_inquiry_general",
    unknownCount: 0
  });

  const response = await generateBotResponse("product_inquiry", {
    userMessage,
    concerns: concerns,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle size specification - "4x5", "3 metros por 4"
 * Same as product inquiry but intent is more specific
 */
async function handleSizeSpecification({ entities, psid, convo, userMessage }) {
  // Delegate to product inquiry handler
  return handleProductInquiry({ entities, psid, convo, userMessage });
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
  handleDurabilityQuery,
  handleProductInquiry,
  handleSizeSpecification
};
