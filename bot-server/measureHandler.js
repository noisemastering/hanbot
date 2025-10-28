// measureHandler.js
const Product = require("./models/Product");
const CampaignProduct = require("./models/CampaignProduct");

/**
 * Parses dimension patterns from user message
 * Supports: "15 x 25", "8x8", "De. 8 8", "2.80 x 3.80"
 * @param {string} message - User's message
 * @returns {object|null} - {width, height, area} or null if not found
 */
function parseDimensions(message) {
  // Pattern 1: "15 x 25" or "15x25"
  const pattern1 = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/;

  // Pattern 2: "De. 8 8" or "de 8 8"
  const pattern2 = /(?:de\.?|medida)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i;

  let match = message.match(pattern1) || message.match(pattern2);

  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[2]);
    return {
      width,
      height,
      area: width * height
    };
  }

  return null;
}

/**
 * Converts size string to numeric area
 * @param {string} sizeStr - e.g., "4x6m", "3x4", "4.2x25m"
 * @returns {object} - {width, height, area, sizeStr}
 */
function parseSizeString(sizeStr) {
  const cleaned = sizeStr.toLowerCase().replace(/m$/i, '').trim();
  const parts = cleaned.split('x');

  if (parts.length === 2) {
    const width = parseFloat(parts[0]);
    const height = parseFloat(parts[1]);
    return {
      width,
      height,
      area: width * height,
      sizeStr
    };
  }

  return null;
}

/**
 * Queries all available sizes from Products and CampaignProducts
 * @param {string} campaignRef - Optional campaign reference to prioritize campaign products
 * @returns {Array} - Array of size objects sorted by area
 */
async function getAvailableSizes(campaignRef = null) {
  const sizes = [];

  // Get sizes from CampaignProducts
  if (campaignRef) {
    const campaignProducts = await CampaignProduct.find({
      campaignRef,
      active: true
    }).lean();

    for (const cp of campaignProducts) {
      if (cp.variants && cp.variants.length > 0) {
        for (const variant of cp.variants) {
          if (variant.stock && variant.size) {
            const parsed = parseSizeString(variant.size);
            if (parsed) {
              sizes.push({
                ...parsed,
                price: variant.price,
                source: 'campaign',
                productName: cp.name,
                permalink: variant.permalink,
                imageUrl: variant.imageUrl
              });
            }
          }
        }
      }
    }
  }

  // Get sizes from regular Products (confeccionada type)
  const products = await Product.find({
    type: "confeccionada",
    size: { $exists: true, $ne: null }
  }).lean();

  for (const product of products) {
    if (product.size) {
      const parsed = parseSizeString(product.size);
      if (parsed) {
        sizes.push({
          ...parsed,
          price: product.price,
          source: 'product',
          productName: product.name,
          mLink: product.mLink,
          imageUrl: product.imageUrl
        });
      }
    }
  }

  // Sort by area
  return sizes.sort((a, b) => a.area - b.area);
}

/**
 * Finds closest smaller and bigger sizes to requested dimension
 * @param {object} requestedDim - {width, height, area}
 * @param {Array} availableSizes - Array from getAvailableSizes()
 * @returns {object} - {smaller, bigger, exact}
 */
function findClosestSizes(requestedDim, availableSizes) {
  const requestedArea = requestedDim.area;

  // Check for exact match (within 0.5 sq meters tolerance)
  const exact = availableSizes.find(size => Math.abs(size.area - requestedArea) < 0.5);

  // Find smaller and bigger
  let smaller = null;
  let bigger = null;

  for (const size of availableSizes) {
    if (size.area < requestedArea) {
      smaller = size; // Keep updating to get the largest smaller size
    } else if (size.area > requestedArea && !bigger) {
      bigger = size; // Get the smallest bigger size
      break;
    }
  }

  return { smaller, bigger, exact };
}

/**
 * Calculates recommended size based on area (area - 1 sq meter for tensors)
 * @param {number} area - Total area in sq meters
 * @returns {number} - Recommended area
 */
function calculateRecommendedArea(area) {
  return Math.max(area - 1, 1); // At least 1 sq meter
}

/**
 * Detects if message is asking about installation
 * @param {string} message
 * @returns {boolean}
 */
function isInstallationQuery(message) {
  return /\b(instalad[ao]|instalaci[oó]n|instalar|colocad[ao]|colocar|poner)\b/i.test(message);
}

/**
 * Detects if message is asking about colors
 * @param {string} message
 * @returns {boolean}
 */
function isColorQuery(message) {
  return /\b(color|colores|qu[eé]\s+color|tonos?|verde|azul|negra?|blanca?)\b/i.test(message);
}

/**
 * Detects if message mentions approximate/needs to measure
 * @param {string} message
 * @returns {boolean}
 */
function isApproximateMeasure(message) {
  return /\b(aprox|aproximad[ao]|necesito medir|tengo que medir|debo medir|medir bien|m[aá]s o menos)\b/i.test(message);
}

/**
 * Generates natural response for size inquiry
 * @param {object} options - Response configuration
 * @returns {string}
 */
function generateSizeResponse(options) {
  const { smaller, bigger, exact, requestedDim, availableSizes, isRepeated } = options;

  const responses = [];

  if (exact) {
    // Generic responses WITHOUT ML link (link shown only on buying intent or when user asks for details)
    responses.push(
      `¡Perfecto! Tenemos justo la medida **${exact.sizeStr}** disponible por $${exact.price} 🌿`,
      `Sí, contamos con **${exact.sizeStr}** por $${exact.price}. ¿Te gustaría ver más detalles?`,
      `Tenemos la medida exacta **${exact.sizeStr}** en stock por $${exact.price} ✨`
    );
  } else {
    const parts = [];

    if (requestedDim) {
      parts.push(`Para un área de ${requestedDim.width}x${requestedDim.height}m, te sugiero estas opciones cercanas:`);
    } else {
      parts.push(`Las medidas más cercanas que tengo disponibles son:`);
    }

    const suggestions = [];
    if (smaller) suggestions.push(`• **${smaller.sizeStr}** por $${smaller.price}`);
    if (bigger) suggestions.push(`• **${bigger.sizeStr}** por $${bigger.price}`);

    if (suggestions.length > 0) {
      parts.push('\n' + suggestions.join('\n'));

      // If user is repeating the request, mention custom sizes
      if (isRepeated) {
        parts.push('\n\n💡 **También fabricamos medidas personalizadas.**');
        parts.push('\nSi realmente necesitas esa medida exacta, podemos cotizarla para ti.');
        parts.push('\n\n¿Te gustaría una cotización personalizada o prefieres una de las medidas disponibles? 😊');
      } else {
        parts.push('\n\n¿Cuál te gustaría ver con más detalle? 🌿');
      }
    } else {
      parts.push('\nPor el momento no tenemos esa medida exacta en stock. ¿Te gustaría ver nuestras medidas estándar?');
    }

    responses.push(parts.join(''));
  }

  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Generates response for generic size/price inquiry
 * @param {Array} availableSizes
 * @returns {string}
 */
function generateGenericSizeResponse(availableSizes) {
  if (availableSizes.length === 0) {
    return "Por el momento no tengo medidas disponibles en stock. ¿Te gustaría que te avise cuando tengamos nuevas opciones?";
  }

  const sizeList = availableSizes
    .slice(0, 5) // Show max 5 sizes
    .map(s => `• **${s.sizeStr}** - $${s.price}`)
    .join('\n');

  const responses = [
    `Estas son nuestras medidas disponibles en malla sombra beige confeccionada 🌿:\n\n${sizeList}\n\n¿Te gustaría más información sobre alguna?`,
    `Contamos con las siguientes medidas:\n\n${sizeList}\n\n¿Cuál se adapta mejor a tu proyecto?`,
    `Tengo estas opciones disponibles:\n\n${sizeList}\n\n¿Te interesa alguna en particular? 😊`
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

module.exports = {
  parseDimensions,
  parseSizeString,
  getAvailableSizes,
  findClosestSizes,
  calculateRecommendedArea,
  isInstallationQuery,
  isColorQuery,
  isApproximateMeasure,
  generateSizeResponse,
  generateGenericSizeResponse
};
