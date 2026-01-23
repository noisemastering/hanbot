// ai/flows/customSizeActions.js
// Handles dynamic actions for custom size flow

const Product = require("../../models/Product");
const { parseDimensions, suggestsRoll, inferProductType, formatDimensions } = require("../utils/sizeParser");

/**
 * Determine product type from context
 * Priority: 1) convo.productInterest, 2) flow collected data, 3) infer from dimensions
 */
function determineProductType(convo, collectedData, dimensions) {
  // 1. Check conversation context
  if (convo?.productInterest) {
    const interest = convo.productInterest.toLowerCase();
    if (interest.includes('rollo') || interest.includes('roll')) {
      return 'rollo';
    }
    if (interest.includes('malla') || interest.includes('confeccionada')) {
      return 'confeccionada';
    }
  }

  // 2. Check flow collected data
  if (collectedData?.productType) {
    return collectedData.productType === 'rollo' ? 'rollo' : 'confeccionada';
  }

  // 3. Infer from dimensions
  if (dimensions) {
    return inferProductType(dimensions);
  }

  return 'unknown';
}

/**
 * Check if we already have product context (to skip asking)
 */
function hasProductContext(convo) {
  if (!convo) return false;

  const interest = convo.productInterest;
  if (!interest) return false;

  const lower = interest.toLowerCase();
  return lower.includes('rollo') || lower.includes('roll') ||
         lower.includes('malla') || lower.includes('confeccionada');
}

/**
 * Check if we have dimensions from the trigger message
 */
function getDimensionsFromTrigger(convo) {
  // The original message that triggered this flow might have dimensions
  // We can check lastUserMessage or similar
  // For now, return null - dimensions will be collected
  return null;
}

/**
 * Find similar products from the database
 * @param {object} dimensions - Parsed dimensions { width, length }
 * @param {string} productType - 'confeccionada' or 'rollo'
 * @param {number} tolerance - How close dimensions can be (default 1m)
 */
async function findSimilarProducts(dimensions, productType, tolerance = 1) {
  if (!dimensions) return [];

  const { width, length } = dimensions;

  try {
    // Build query based on product type
    let query = { active: true };

    if (productType === 'confeccionada') {
      // Look for malla confeccionada products
      query.$or = [
        { category: 'confeccionada' },
        { category: 'malla' },
        { name: { $regex: /confeccionada|malla sombra/i } }
      ];
    } else if (productType === 'rollo') {
      query.$or = [
        { category: 'rollo' },
        { name: { $regex: /rollo/i } }
      ];
    }

    const products = await Product.find(query).lean();

    // Filter products by similar dimensions
    const similar = products.filter(p => {
      // Extract dimensions from product (specs or parsed from name)
      const prodDims = extractProductDimensions(p);
      if (!prodDims) return false;

      // Check if any dimension is close
      const widthClose = Math.abs(prodDims.width - width) <= tolerance ||
                        (length && Math.abs(prodDims.width - length) <= tolerance);
      const lengthClose = (prodDims.length && Math.abs(prodDims.length - width) <= tolerance) ||
                         (prodDims.length && length && Math.abs(prodDims.length - length) <= tolerance);

      return widthClose || lengthClose;
    });

    // Sort by how close the dimensions are
    similar.sort((a, b) => {
      const aDims = extractProductDimensions(a);
      const bDims = extractProductDimensions(b);
      const aDiff = dimensionDifference(aDims, dimensions);
      const bDiff = dimensionDifference(bDims, dimensions);
      return aDiff - bDiff;
    });

    return similar.slice(0, 5); // Return top 5 matches
  } catch (error) {
    console.error("Error finding similar products:", error);
    return [];
  }
}

/**
 * Extract dimensions from a product
 */
function extractProductDimensions(product) {
  // Try specs first
  if (product.specs?.width && product.specs?.length) {
    return {
      width: parseFloat(product.specs.width),
      length: parseFloat(product.specs.length)
    };
  }

  // Try to parse from name or SKU
  const nameMatch = product.name?.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (nameMatch) {
    const d1 = parseFloat(nameMatch[1]);
    const d2 = parseFloat(nameMatch[2]);
    return {
      width: Math.min(d1, d2),
      length: Math.max(d1, d2)
    };
  }

  const skuMatch = product.sku?.match(/(\d+)x(\d+)/i);
  if (skuMatch) {
    const d1 = parseFloat(skuMatch[1]);
    const d2 = parseFloat(skuMatch[2]);
    return {
      width: Math.min(d1, d2),
      length: Math.max(d1, d2)
    };
  }

  return null;
}

/**
 * Calculate dimension difference for sorting
 */
function dimensionDifference(prodDims, reqDims) {
  if (!prodDims || !reqDims) return Infinity;
  const widthDiff = Math.abs(prodDims.width - reqDims.width);
  const lengthDiff = Math.abs((prodDims.length || 0) - (reqDims.length || 0));
  return widthDiff + lengthDiff;
}

/**
 * Generate the "find similar sizes" response
 */
async function generateFindSimilarResponse(collectedData, convo) {
  const requestedSize = collectedData.requestedSize;
  const dimensions = parseDimensions(requestedSize);

  if (!dimensions) {
    return {
      message: "No pude entender las medidas. ¿Podrías darme las dimensiones en formato ancho x largo? Por ejemplo: 3.5 x 4",
      options: [],
      continueFlow: false,
      repeatStep: "collect_dimensions"
    };
  }

  // Check if dimensions are too large (>50m) - suggest rolls
  if (suggestsRoll(dimensions, 50)) {
    const productType = determineProductType(convo, collectedData, dimensions);

    if (productType === 'confeccionada') {
      return {
        message: `Para medidas tan grandes (${formatDimensions(dimensions.width, dimensions.length)}), te conviene más un rollo de malla. Tenemos rollos de 4x50m y 4x100m. ¿Te interesa cotizar un rollo?`,
        options: [
          { label: "Sí, cotizar rollo", value: "rollo" },
          { label: "No, prefiero medida exacta", value: "custom" }
        ],
        continueFlow: true,
        nextStep: "handle_large_size"
      };
    }
  }

  // Determine product type
  const productType = determineProductType(convo, collectedData, dimensions);

  // Find similar products
  const similar = await findSimilarProducts(dimensions, productType);

  if (similar.length === 0) {
    // No similar products found
    return {
      message: `No tenemos una medida exacta de ${formatDimensions(dimensions.width, dimensions.length)} en stock, pero podemos fabricarla a la medida. ¿Te gustaría una cotización personalizada?`,
      options: [
        { label: "Sí, cotizar medida especial", value: "custom_quote" },
        { label: "Ver otras opciones", value: "see_catalog" }
      ],
      continueFlow: true
    };
  }

  // Build response with similar options
  const optionsList = similar.map(p => {
    const dims = extractProductDimensions(p);
    const dimStr = dims ? formatDimensions(dims.width, dims.length) : "";
    const price = p.price ? ` - $${p.price}` : "";
    return {
      label: `${dimStr}${price}`,
      value: p._id.toString(),
      product: p
    };
  });

  // Add "none of these" option
  optionsList.push({
    label: "Ninguna, necesito medida exacta",
    value: "custom_quote"
  });

  const dimStr = formatDimensions(dimensions.width, dimensions.length);
  const message = `Para ${dimStr}, estas son las medidas más cercanas que tenemos en stock:\n\n` +
    optionsList.slice(0, -1).map((opt, i) => `${i + 1}. ${opt.label}`).join('\n') +
    `\n\n¿Te funciona alguna de estas opciones?`;

  return {
    message,
    options: optionsList,
    continueFlow: true,
    similarProducts: similar,
    requestedDimensions: dimensions
  };
}

/**
 * Process the user's choice after seeing similar sizes
 */
async function processUserChoice(userChoice, collectedData, convo) {
  if (userChoice === 'custom_quote' || userChoice.toLowerCase().includes('ninguna') ||
      userChoice.toLowerCase().includes('exacta') || userChoice.toLowerCase().includes('especial')) {
    // User wants custom quote - handoff
    return {
      action: 'handoff',
      message: `Entendido, te comunico con un asesor para cotizar tu medida especial de ${collectedData.requestedSize}. En breve te atienden.`,
      handoffReason: `Solicita medida especial: ${collectedData.requestedSize}`
    };
  }

  if (userChoice === 'see_catalog') {
    return {
      action: 'message',
      message: "Puedes ver todas nuestras medidas disponibles en nuestra tienda:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Hay algo más en lo que te pueda ayudar?"
    };
  }

  if (userChoice === 'rollo') {
    return {
      action: 'message',
      message: "Tenemos rollos de malla sombra en 4x50m y 4x100m. Puedes verlos aquí:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Te interesa alguno en específico?"
    };
  }

  // User selected a specific product - try to find it
  // The value might be a product ID
  try {
    const product = await Product.findById(userChoice);
    if (product) {
      const mlLink = product.mlLink || "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
      return {
        action: 'message',
        message: `¡Excelente elección! Aquí está el link para ordenar:\n${mlLink}\n\n¿Necesitas algo más?`
      };
    }
  } catch (e) {
    // Not a valid product ID, try to match by dimension string
  }

  // Generic response
  return {
    action: 'message',
    message: "Puedes ordenar directamente en nuestra tienda de Mercado Libre:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Hay algo más en lo que te pueda ayudar?"
  };
}

module.exports = {
  determineProductType,
  hasProductContext,
  getDimensionsFromTrigger,
  findSimilarProducts,
  generateFindSimilarResponse,
  processUserChoice,
  extractProductDimensions
};
