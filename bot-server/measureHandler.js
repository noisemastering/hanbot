// measureHandler.js
const Product = require("./models/Product");
const CampaignProduct = require("./models/CampaignProduct");
const { extractReference } = require("./referenceEstimator");

/**
 * Converts Spanish number words to digits
 * @param {string} text - Text containing number words
 * @returns {string} - Text with numbers converted to digits
 */
function convertSpanishNumbersToDigits(text) {
  const numberMap = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
    'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9',
    'diez': '10', 'once': '11', 'doce': '12', 'trece': '13', 'catorce': '14',
    'quince': '15', 'dieciséis': '16', 'dieciseis': '16', 'diecisiete': '17',
    'dieciocho': '18', 'diecinueve': '19', 'veinte': '20', 'veintiuno': '21',
    'veintidós': '22', 'veintidos': '22', 'veintitrés': '23', 'veintitres': '23',
    'veinticuatro': '24', 'veinticinco': '25', 'treinta': '30', 'cuarenta': '40',
    'cincuenta': '50', 'sesenta': '60', 'setenta': '70', 'ochenta': '80', 'noventa': '90'
  };

  let converted = text.toLowerCase();

  // STEP 1: Handle "NUMBER y medio" patterns first (e.g., "nueve metros y medio" → "9.5")
  // This must happen BEFORE we replace individual number words
  // Note: We remove "metros" from the output to allow "9.5 por 1.30" pattern matching
  converted = converted.replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidós|veintidos|veintitrés|veintitres|veinticuatro|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+metros?\s+y\s+medio\b/gi, (match, num) => {
    const numVal = numberMap[num.toLowerCase()];
    if (numVal) {
      return `${numVal}.5`;
    }
    return match;
  });

  // STEP 2: Handle decimal patterns like "uno treinta" (1.30)
  // Small number (≤10) followed by another number = decimal
  converted = converted.replace(/\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, (match, ones, decimal) => {
    const onesVal = numberMap[ones.toLowerCase()];
    const decimalVal = numberMap[decimal.toLowerCase()];

    if (onesVal && decimalVal && parseInt(onesVal) <= 10) {
      return `${onesVal}.${decimalVal}`;
    }
    return match;
  });

  // STEP 3: Handle compound numbers like "treinta y cinco" (35)
  converted = converted.replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+y\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, (match, tens, ones) => {
    const tensVal = numberMap[tens.toLowerCase()];
    const onesVal = numberMap[ones.toLowerCase()];
    if (tensVal && onesVal) {
      return (parseInt(tensVal) + parseInt(onesVal)).toString();
    }
    return match;
  });

  // STEP 4: Replace remaining simple number words
  for (const [word, digit] of Object.entries(numberMap)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    converted = converted.replace(regex, digit);
  }

  return converted;
}

/**
 * Parses dimension patterns from user message
 * Supports: "15 x 25", "8x8", "De. 8 8", "2.80 x 3.80"
 * Also supports: "nueve metros y medio por uno treinta" (9.5 x 1.30)
 * @param {string} message - User's message
 * @returns {object|null} - {width, height, area} or null if not found
 */
function parseDimensions(message) {
  // FIRST: Check if user mentioned a reference object (e.g., "tamaño de un carro")
  const reference = extractReference(message);
  if (reference) {
    // Return estimated dimensions with reference marker
    return {
      width: reference.width,
      height: reference.height,
      area: reference.width * reference.height,
      isEstimated: true,
      referenceObject: reference.description
    };
  }

  // Convert Spanish number words to digits first
  const converted = convertSpanishNumbersToDigits(message);

  // PREPROCESSING: Strip out "m" units (e.g., "6.5 m x 3.17 m" → "6.5 x 3.17")
  // This allows all existing patterns to work with messages that include units
  const normalized = converted.replace(/(\d+(?:\.\d+)?)\s*m\b/gi, '$1');

  // Pattern 1: "15 x 25" or "15x25"
  const pattern1 = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/;

  // Pattern 2: "De. 8 8" or "de 8 8"
  const pattern2 = /(?:de\.?|medida)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i;

  // Pattern 3: "9.5 por 1.30" (por = by in Spanish)
  const pattern3 = /(\d+(?:\.\d+)?)\s+por\s+(\d+(?:\.\d+)?)/i;

  // Pattern 4: "metros por metros" with optional "de"
  const pattern4 = /(\d+(?:\.\d+)?)\s+metros?\s+(?:de\s+)?(?:ancho\s+)?(?:por|x)\s+(\d+(?:\.\d+)?)\s*metros?/i;

  // Pattern 5: "3 ancho x 5 largo" - dimensions with ancho/largo labels
  const pattern5 = /(\d+(?:\.\d+)?)\s+(?:de\s+)?ancho\s+(?:por|x)\s+(\d+(?:\.\d+)?)\s+(?:de\s+)?largo/i;

  // Pattern 6: "8 metros de largo x 5 de ancho" or "8 metros de ancho x 5 de largo"
  const pattern6 = /(\d+(?:\.\d+)?)\s*metros?\s+de\s+(largo|ancho)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:metros?)?\s*(?:de\s+)?(largo|ancho)?/i;

  // Pattern 7: "10 metros de ancho por 27 de largo" - using "por" instead of "x"
  const pattern7 = /(\d+(?:\.\d+)?)\s*metros?\s+de\s+(ancho|largo)\s+por\s+(\d+(?:\.\d+)?)\s*(?:metros?)?\s*(?:de\s+)?(largo|ancho)/i;

  // Pattern 8: "Largo 6.00 Ancho 5.00" or "Ancho 5.00 Largo 6.00" (formal specification without connector)
  const pattern8 = /(largo|ancho)\s+(\d+(?:\.\d+)?)\s+(ancho|largo)\s+(\d+(?:\.\d+)?)/i;

  let match = normalized.match(pattern1) ||
              normalized.match(pattern2) ||
              normalized.match(pattern3) ||
              normalized.match(pattern4) ||
              normalized.match(pattern5);

  // Handle pattern 8 first (most specific - formal specification)
  const match8 = normalized.match(pattern8);
  if (match8) {
    // match8[1] = first label ("largo" or "ancho")
    // match8[2] = first number
    // match8[3] = second label ("ancho" or "largo")
    // match8[4] = second number
    const firstLabel = match8[1].toLowerCase();
    const firstNum = parseFloat(match8[2]);
    const secondLabel = match8[3].toLowerCase();
    const secondNum = parseFloat(match8[4]);

    // Determine which is width and which is height
    const width = firstLabel === 'ancho' ? firstNum : secondNum;
    const height = firstLabel === 'largo' ? firstNum : secondNum;

    return {
      width,
      height,
      area: width * height
    };
  }

  // Handle pattern 7 next
  const match7 = normalized.match(pattern7);
  if (match7) {
    // match7[1] = first number, match7[2] = "ancho" or "largo"
    // match7[3] = second number, match7[4] = "largo" or "ancho"
    const firstNum = parseFloat(match7[1]);
    const secondNum = parseFloat(match7[3]);
    const firstLabel = match7[2].toLowerCase();

    // Determine which is width and which is height
    const width = firstLabel === 'ancho' ? firstNum : secondNum;
    const height = firstLabel === 'largo' ? firstNum : secondNum;

    return {
      width,
      height,
      area: width * height
    };
  }

  // Handle pattern 6 separately due to different capture groups
  const match6 = normalized.match(pattern6);
  if (match6) {
    // match6[1] = first number, match6[2] = "largo" or "ancho"
    // match6[3] = second number, match6[4] = "largo" or "ancho"
    const width = parseFloat(match6[1]);
    const height = parseFloat(match6[3]);
    return {
      width,
      height,
      area: width * height
    };
  }

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

  // Check for exact match by dimensions (not just area!)
  // Must match either width×height or height×width (swapped dimensions)
  const dimensionTolerance = 0.2; // 20cm tolerance for each dimension
  const exact = availableSizes.find(size => {
    // Check if dimensions match (within tolerance)
    const matchesDirect =
      Math.abs(size.width - requestedDim.width) < dimensionTolerance &&
      Math.abs(size.height - requestedDim.height) < dimensionTolerance;

    // Check if swapped dimensions match (3x10 matches 10x3)
    const matchesSwapped =
      Math.abs(size.width - requestedDim.height) < dimensionTolerance &&
      Math.abs(size.height - requestedDim.width) < dimensionTolerance;

    return matchesDirect || matchesSwapped;
  });

  // Filter to only sizes that can actually cover the space in at least one orientation
  const validSizes = availableSizes.filter(size => {
    const canCoverNormal = size.width >= requestedDim.width && size.height >= requestedDim.height;
    const canCoverSwapped = size.width >= requestedDim.height && size.height >= requestedDim.width;
    return canCoverNormal || canCoverSwapped;
  });

  // Among valid sizes, find the closest smaller and bigger by area
  let smaller = null;
  let bigger = null;
  let smallestDiffSmaller = Infinity;
  let smallestDiffBigger = Infinity;

  for (const size of validSizes) {
    const areaDiff = Math.abs(size.area - requestedArea);

    if (size.area < requestedArea && areaDiff < smallestDiffSmaller) {
      smaller = size;
      smallestDiffSmaller = areaDiff;
    } else if (size.area > requestedArea && areaDiff < smallestDiffBigger) {
      bigger = size;
      smallestDiffBigger = areaDiff;
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
  // Only match explicit installation service questions, not general "poner" statements
  // ✅ Matches: "¿Ustedes instalan?", "Hacen instalación?", "Quién pone la malla?"
  // ❌ Doesn't match: "ocupo poner una malla", "necesito poner" (buying intent)
  return /\b(instalad[ao]|instalaci[oó]n|instalar|colocad[ao]|colocar)\b/i.test(message) ||
         /\b(ustedes|usted|hacen|ofrec\w+|dan|tienen)\s+.*\b(ponen|pone|ponemos|instalaci[oó]n)\b/i.test(message) ||
         /\b(qui[eé]n|c[oó]mo)\s+.*\b(pone|instala|coloca)\b/i.test(message);
}

/**
 * Detects if message is asking about colors
 * @param {string} message
 * @returns {boolean}
 */
function isColorQuery(message) {
  return /\b(color|colores|qu[eé]\s+color|tonos?|verde|azul|negra?|blanca?|beige|bex)\b/i.test(message);
}

/**
 * Detects if dimensions contain fractional meters
 * @param {object} dimensions - {width, height, area}
 * @returns {boolean}
 */
function hasFractionalMeters(dimensions) {
  if (!dimensions) return false;

  const widthHasFraction = dimensions.width % 1 !== 0;
  const heightHasFraction = dimensions.height % 1 !== 0;

  return widthHasFraction || heightHasFraction;
}

/**
 * Detects if message is asking about weed control (maleza)
 * @param {string} message
 * @returns {boolean}
 */
function isWeedControlQuery(message) {
  return /\b(maleza|antimaleza|anti-maleza|hierba|malas?\s+hierbas?|ground\s*cover|crec[eé]\s+(la\s+)?maleza|quita\s+maleza|evita\s+maleza|bloquea\s+maleza)\b/i.test(message);
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
 * @returns {object} - {text, suggestedSizes} where suggestedSizes is array of size strings for context
 */
function generateSizeResponse(options) {
  const { smaller, bigger, exact, requestedDim, availableSizes, isRepeated } = options;

  const responses = [];
  const suggestedSizes = []; // Track suggested sizes for context

  if (exact) {
    // Generic responses WITHOUT ML link (link shown only on buying intent or when user asks for details)
    suggestedSizes.push(exact.sizeStr);
    responses.push(
      `Por supuesto, de **${exact.sizeStr}** la tenemos en $${exact.price}`,
      `Claro, **${exact.sizeStr}** la tenemos disponible en $${exact.price}`,
      `Perfecto, **${exact.sizeStr}** está disponible por $${exact.price}`
    );
  } else {
    const parts = [];

    // Check if multiple pieces can cover the area
    const requestedArea = requestedDim ? requestedDim.area : 0;
    let multiPieceOption = null;

    if (requestedDim && availableSizes.length > 0) {
      // Look for sizes that, when multiplied, match the requested area
      // For example: 10x10m (100m²) = 2x 10x5m (2 × 50m²)
      for (const size of availableSizes) {
        const piecesNeeded = Math.round(requestedArea / size.area);

        // Check if 2-4 pieces would cover exactly (within 5% tolerance)
        if (piecesNeeded >= 2 && piecesNeeded <= 4) {
          const totalArea = size.area * piecesNeeded;
          const areaDiff = Math.abs(totalArea - requestedArea);
          const tolerance = requestedArea * 0.05; // 5% tolerance

          if (areaDiff <= tolerance) {
            multiPieceOption = {
              size: size.sizeStr,
              pieces: piecesNeeded,
              priceEach: size.price,
              priceTotal: size.price * piecesNeeded
            };
            break; // Use first match
          }
        }
      }
    }

    // If we found a multi-piece solution, lead with clarification + multi-piece + custom option
    if (multiPieceOption) {
      // First clarify this is a special/oversized request
      const largestAvailable = availableSizes[availableSizes.length - 1];
      const isOversized = requestedDim.width > largestAvailable.width || requestedDim.height > largestAvailable.height;

      if (isOversized) {
        parts.push(`La medida de ${requestedDim.width}x${requestedDim.height}m excede nuestras medidas estándar (la más grande es ${largestAvailable.sizeStr}).\n\n`);
      }

      parts.push(`**Para cubrir ${requestedDim.width}x${requestedDim.height}m, tienes estas opciones:**\n`);
      parts.push(`\n• ${multiPieceOption.pieces} piezas de **${multiPieceOption.size}** por $${multiPieceOption.priceEach} c/u = **$${multiPieceOption.priceTotal} total**`);
      suggestedSizes.push(multiPieceOption.size);

      // Always mention custom fabrication for oversized requests
      if (isOversized) {
        parts.push(`\n• También fabricamos medidas personalizadas. Para cotizar ${requestedDim.width}x${requestedDim.height}m exacta, contáctanos.`);
      }

      // Still show other standard sizes if available
      if (smaller && smaller.sizeStr !== multiPieceOption.size) {
        parts.push(`\n• **${smaller.sizeStr}** (más pequeña) por $${smaller.price}`);
        suggestedSizes.push(smaller.sizeStr);
      }
      if (bigger && bigger.sizeStr !== multiPieceOption.size) {
        parts.push(`\n• **${bigger.sizeStr}** (más grande) por $${bigger.price}`);
        suggestedSizes.push(bigger.sizeStr);
      }

      parts.push('\n\n¿Cuál opción te interesa?');
    } else {
      // No multi-piece solution - use existing logic
      // Lead with custom/special size message
      if (requestedDim) {
        parts.push(`La medida de ${requestedDim.width}x${requestedDim.height}m es una medida especial que necesitaríamos fabricar a la medida para ti.`);
      } else {
        parts.push(`Esa medida es especial y necesitaríamos fabricarla a la medida.`);
      }

      // Show alternatives WITH PRICES
      const suggestions = [];
      if (smaller) {
        suggestions.push(`• **${smaller.sizeStr}** por $${smaller.price}`);
        suggestedSizes.push(smaller.sizeStr);
      }
      if (bigger) {
        suggestions.push(`• **${bigger.sizeStr}** por $${bigger.price}`);
        suggestedSizes.push(bigger.sizeStr);
      }

      if (suggestions.length > 0) {
        parts.push('\n\nTenemos estas opciones cercanas disponibles:');
        parts.push('\n' + suggestions.join('\n'));
        parts.push('\n\n¿Cuál te interesa?');
      } else {
        parts.push('\n\n¿Te gustaría ver nuestras medidas estándar?');
      }
    }

    responses.push(parts.join(''));
  }

  return {
    text: responses[Math.floor(Math.random() * responses.length)],
    suggestedSizes
  };
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

  // Show range: smallest to largest
  const smallest = availableSizes[0];
  const largest = availableSizes[availableSizes.length - 1];

  const responses = [
    `Tenemos diferentes medidas y precios, desde $${smallest.price} en tamaño de ${smallest.sizeStr} hasta $${largest.price} en tamaño de ${largest.sizeStr}.\n\n¿Qué medida necesitas?`,
    `Contamos con varias opciones, desde $${smallest.price} en ${smallest.sizeStr} hasta $${largest.price} en ${largest.sizeStr}.\n\n¿Cuál se adapta mejor a tu proyecto?`,
    `Manejamos diferentes tamaños y precios, desde $${smallest.price} (${smallest.sizeStr}) hasta $${largest.price} (${largest.sizeStr}).\n\n¿Qué dimensiones estás buscando?`
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
  isWeedControlQuery,
  isApproximateMeasure,
  hasFractionalMeters,
  generateSizeResponse,
  generateGenericSizeResponse
};
