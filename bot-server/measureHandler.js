// measureHandler.js
//
// IMPORTANT: For rectangular products like "malla sombra confeccionada",
// width and length are INTERCHANGEABLE. A 4m x 2m product is the EXACT
// SAME as a 2m x 4m product. The fabric can be oriented either way.
// All dimension matching functions handle this by checking both orientations.
//
const ProductFamily = require("./models/ProductFamily");
const { extractReference } = require("./referenceEstimator");
const { convertSpanishNumbers } = require("./ai/utils/spanishNumbers");

/**
 * Check if we're in business hours (Mon-Fri, 9am-6pm Mexico City time)
 * @returns {boolean}
 */
function isBusinessHours() {
  const now = new Date();
  const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

  const day = mexicoTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = mexicoTime.getHours();

  // Monday-Friday (1-5) and between 9am-6pm
  const isWeekday = day >= 1 && day <= 5;
  const isDuringHours = hour >= 9 && hour < 18;

  return isWeekday && isDuringHours;
}

/**
 * Check if dimensions qualify as a custom order (both sides >= 8m)
 * @param {object} dimensions - {width, height}
 * @returns {boolean}
 */
function isCustomOrder(dimensions) {
  if (!dimensions) return false;

  // Both sides must be >= 8 meters for it to be a custom order
  const minSide = Math.min(dimensions.width, dimensions.height);
  const maxSide = Math.max(dimensions.width, dimensions.height);

  return minSide >= 8 && maxSide >= 8;
}

// Conversion constant for feet to meters
const FEET_TO_METERS = 0.3048;

/**
 * Helper to convert feet to meters and add conversion info to result
 */
function applyFeetConversion(result, isFeet) {
  if (!result || !isFeet) return result;

  const originalWidth = result.width;
  const originalHeight = result.height;

  // Convert feet to meters (rounded to 1 decimal)
  result.width = Math.round(result.width * FEET_TO_METERS * 10) / 10;
  result.height = Math.round(result.height * FEET_TO_METERS * 10) / 10;
  result.area = result.width * result.height;

  // Add conversion info
  result.convertedFromFeet = true;
  result.originalFeet = { width: originalWidth, height: originalHeight };
  result.originalFeetStr = `${originalWidth}x${originalHeight} pies`;

  console.log(`📏 Converted ${originalWidth}x${originalHeight} pies → ${result.width}x${result.height}m`);

  return result;
}

/**
 * Parses dimension patterns from user message
 * Supports: "15 x 25", "8x8", "De. 8 8", "2.80 x 3.80"
 * Also supports: "nueve metros y medio por uno treinta" (9.5 x 1.30)
 * Also supports feet: "16 por 10 pies" (converts to meters)
 * @param {string} message - User's message
 * @returns {object|null} - {width, height, area, convertedFromFeet?, originalFeet?} or null if not found
 */
function parseDimensions(message) {
  // Check if dimensions are in feet
  const isFeet = /\b(pies?|ft|feet|foot)\b/i.test(message);

  // First, check if there are EXPLICIT dimensions in the message (e.g., "8x10", "8.00 x 10.00")
  // These should take priority over reference object estimates
  const hasExplicitDimensions = /\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?/.test(message) ||
                                 /\d+(?:\.\d+)?\s+(?:por|x)\s+\d+(?:\.\d+)?/i.test(message);

  // Only use reference object estimation if NO explicit dimensions are provided
  if (!hasExplicitDimensions) {
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
  }

  // Convert Spanish number words to digits first
  const converted = convertSpanishNumbers(message);

  // PREPROCESSING: Handle numeric fractions BEFORE removing units
  // "7mts y 1/2" → "7.5", "7 y medio" → "7.5", "7 y media" → "7.5"
  let withFractions = converted
    .replace(/(\d+)\s*(?:m|mts?|metros?)?\s*y\s*1\/2/gi, (_, num) => `${parseFloat(num) + 0.5}`)
    .replace(/(\d+)\s*(?:m|mts?|metros?)?\s*y\s*medi[oa]/gi, (_, num) => `${parseFloat(num) + 0.5}`)
    .replace(/(\d+)\s*1\/2/gi, (_, num) => `${parseFloat(num) + 0.5}`);

  // PREPROCESSING: Fix spacing around decimal points (e.g., "7 .70" → "7.70")
  // This handles cases where users add spaces before decimal points
  let normalized = withFractions.replace(/(\d)\s+(\.\d+)/g, '$1$2');

  // PREPROCESSING: Handle "2 00" → "2.00" (space as decimal separator)
  // Also handles "2:00" → "2.00" (colon as decimal separator, common typo)
  normalized = normalized.replace(/(\d+)\s+(\d{2})(?=\s*[xX×*]|\s+por\s|\s*$)/g, '$1.$2');
  normalized = normalized.replace(/(\d+):(\d{2})(?=\s*[xX×*]|\s+por\s|\s*$)/g, '$1.$2');
  // Also handle after the separator: "x 10 00" → "x 10.00"
  normalized = normalized.replace(/([xX×*]\s*)(\d+)\s+(\d{2})(?=\s|$)/g, '$1$2.$3');
  normalized = normalized.replace(/([xX×*]\s*)(\d+):(\d{2})(?=\s|$)/g, '$1$2.$3');

  // PREPROCESSING: Normalize "más" typo for "m" (common autocorrect: "3 más" → "3m")
  // Also handles "mas" without accent
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*m[aá]s\b/gi, '$1m');

  // PREPROCESSING: Strip out "m", "mts", "metros" units (e.g., "6.5 m x 3.17 m" → "6.5 x 3.17")
  // This allows all existing patterns to work with messages that include units
  // Handle "mts" BEFORE "m" to avoid partial matches
  // Use lookahead for word boundary OR separator to handle "mtsx" (no space before x)
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*mts(?=\s|[xX×*]|$)/gi, '$1');
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*m(?=\s|[xX×*]|$)/gi, '$1');

  // PREPROCESSING: Normalize "k" separator to "x" (common text abbreviation: "4 k 4" → "4 x 4")
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*k\s*(\d+(?:\.\d+)?)/gi, '$1 x $2');

  // PREPROCESSING: Remove stray commas near dimension separators (e.g., "4,×8" → "4×8", "4x,8" → "4x8")
  normalized = normalized.replace(/,\s*([xX×*])/g, '$1');
  normalized = normalized.replace(/([xX×*])\s*,/g, '$1');

  // Pattern 1: "15 x 25" or "15x25" or "15*25"
  const pattern1 = /(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/;

  // Pattern 2: "De. 8 8" or "de 8 8"
  const pattern2 = /(?:de\.?|medida)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i;

  // Pattern 3: "9.5 por 1.30" (por = by in Spanish)
  const pattern3 = /(\d+(?:\.\d+)?)\s+por\s+(\d+(?:\.\d+)?)/i;

  // Pattern 4: "metros por metros" with optional "de"
  // NOTE: Final (?:\s*metros?)? is wrapped to make the entire unit truly optional
  // Without this fix, "3 metros x 1.70" wouldn't match (requires trailing "metros")
  const pattern4 = /(\d+(?:\.\d+)?)\s+metros?\s+(?:de\s+)?(?:ancho\s+)?(?:por|x)\s+(\d+(?:\.\d+)?)(?:\s*metros?)?/i;

  // Pattern 5: "3 ancho x 5 largo" - dimensions with ancho/largo labels (ancho first)
  // Also handles "y" as separator (e.g., "3 de ancho y 5 de largo")
  const pattern5 = /(\d+(?:\.\d+)?)\s+(?:de\s+)?ancho\s+(?:por|x|y)\s+(\d+(?:\.\d+)?)\s+(?:de\s+)?largo/i;

  // Pattern 5b: "4 de largo por 3 de ancho" - dimensions with largo first (opposite of pattern 5)
  const pattern5b = /(\d+(?:\.\d+)?)\s+(?:de\s+)?largo\s+(?:por|x|y)\s+(\d+(?:\.\d+)?)\s+(?:de\s+)?ancho/i;

  // Pattern 6: "8 metros de largo x 5 de ancho" or "8 metros de ancho x 5 de largo"
  // Also handles "y" as separator
  const pattern6 = /(\d+(?:\.\d+)?)\s*metros?\s+de\s+(largo|ancho)\s*(?:[xX×*]|y)\s*(\d+(?:\.\d+)?)\s*(?:metros?)?\s*(?:de\s+)?(largo|ancho)?/i;

  // Pattern 7: "10 metros de ancho por 27 de largo" - using "por" or "y" instead of "x"
  const pattern7 = /(\d+(?:\.\d+)?)\s*metros?\s+de\s+(ancho|largo)\s+(?:por|y)\s+(\d+(?:\.\d+)?)\s*(?:metros?)?\s*(?:de\s+)?(largo|ancho)/i;

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

    return applyFeetConversion({
      width,
      height,
      area: width * height
    }, isFeet);
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

    return applyFeetConversion({
      width,
      height,
      area: width * height
    }, isFeet);
  }

  // Handle pattern 5b: "N de largo por M de ancho" (largo first, opposite of pattern 5)
  const match5b = normalized.match(pattern5b);
  if (match5b) {
    // match5b[1] = largo value (height), match5b[2] = ancho value (width)
    const height = parseFloat(match5b[1]);
    const width = parseFloat(match5b[2]);
    return applyFeetConversion({
      width,
      height,
      area: width * height
    }, isFeet);
  }

  // Handle pattern 6 separately due to different capture groups
  const match6 = normalized.match(pattern6);
  if (match6) {
    // match6[1] = first number, match6[2] = "largo" or "ancho"
    // match6[3] = second number, match6[4] = "largo" or "ancho"
    const width = parseFloat(match6[1]);
    const height = parseFloat(match6[3]);
    return applyFeetConversion({
      width,
      height,
      area: width * height
    }, isFeet);
  }

  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[2]);
    return applyFeetConversion({
      width,
      height,
      area: width * height
    }, isFeet);
  }

  // Pattern 9: Single dimension implies square - "de 4 metros", "una de 4", "4 metros q sale"
  // Only match if it's clearly asking for a size (with "de" prefix or "metros" unit)
  // IMPORTANT: Only use this if the message truly has ONE dimension number.
  // If there are TWO DIFFERENT numbers, the customer gave both dimensions - don't assume square!
  const patternSquare = /\b(?:de|una?\s+de)\s+(\d+(?:\.\d+)?)\s*(?:metros?|m)?\b/i;
  const matchSquare = normalized.match(patternSquare);
  if (matchSquare) {
    const size = parseFloat(matchSquare[1]);
    // Only treat as square if size is reasonable (2-10 meters)
    if (size >= 2 && size <= 10) {
      // SAFETY CHECK: Look for other dimension numbers in the message
      // If we find a DIFFERENT number that could be a dimension, don't assume square
      const allNumbers = normalized.match(/\b(\d+(?:\.\d+)?)\b/g) || [];
      const dimensionNumbers = allNumbers
        .map(n => parseFloat(n))
        .filter(n => n >= 1 && n <= 50); // Reasonable dimension range (1-50 meters)
      const uniqueDimensions = [...new Set(dimensionNumbers)];

      // If there are 2+ different dimension-like numbers, customer specified both - don't assume square
      if (uniqueDimensions.length >= 2) {
        console.log(`⚠️ Found multiple dimensions (${uniqueDimensions.join(', ')}), not assuming square`);
        return null;
      }

      console.log(`📐 Single dimension detected (${size}m), treating as ${size}x${size} square`);
      return applyFeetConversion({
        width: size,
        height: size,
        area: size * size,
        isSquare: true
      }, isFeet);
    }
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
 * Queries all available sizes from ProductFamily (Inventario)
 * @param {object} conversation - Optional conversation object (with campaign/ad info)
 * @returns {Array} - Array of size objects sorted by area
 */
async function getAvailableSizes(conversation = null) {
  const sizes = [];
  let campaignProducts = null;

  // Try to get products from campaign/ad if conversation has that info
  if (conversation && (conversation.campaignRef || conversation.adId)) {
    try {
      const Campaign = require("./models/Campaign");
      const Ad = require("./models/Ad");

      // First try to find products from the specific Ad
      if (conversation.adId) {
        const ad = await Ad.findOne({ fbAdId: conversation.adId }).populate('productIds');
        if (ad && ad.productIds && ad.productIds.length > 0) {
          campaignProducts = ad.productIds;
          console.log(`📦 Using ${campaignProducts.length} products from Ad (${conversation.adId})`);
        }
      }

      // If no products from Ad, try Campaign
      if (!campaignProducts && conversation.campaignRef) {
        const campaign = await Campaign.findOne({ ref: conversation.campaignRef }).populate('productIds');
        if (campaign && campaign.productIds && campaign.productIds.length > 0) {
          campaignProducts = campaign.productIds;
          console.log(`📦 Using ${campaignProducts.length} products from Campaign (${conversation.campaignRef})`);
        }
      }
    } catch (err) {
      console.error('⚠️ Error fetching campaign/ad products:', err.message);
    }
  }

  // If we found campaign-specific products, use those
  if (campaignProducts && campaignProducts.length > 0) {
    for (const product of campaignProducts) {
      if (product.size && product.sellable && product.active) {
        const parsed = parseSizeString(product.size);
        if (parsed) {
          // Skip products with cm dimensions (not malla sombra)
          if (product.dimensionUnits?.width === 'cm') continue;

          // Get preferred online store link (Mercado Libre)
          const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                               product.onlineStoreLinks?.[0]?.url || null;

          sizes.push({
            ...parsed,
            price: product.price || 0,
            source: preferredLink ? 'mercadolibre' : 'product',
            productName: product.name,
            productId: product._id,
            mLink: preferredLink,
            permalink: preferredLink,
            imageUrl: product.imageUrl || product.thumbnail
          });
        }
      }
    }

    // If we found campaign products with sizes, return them
    if (sizes.length > 0) {
      return sizes.sort((a, b) => a.area - b.area);
    }
    console.log('⚠️ Campaign products found but none with valid sizes, falling back to all products');
  } else if (conversation && (conversation.campaignRef || conversation.adId)) {
    console.log('⚠️ No products found for campaign/ad, falling back to all products');
  }

  // Fallback: Get all sellable and active products from ProductFamily (Inventario)
  // Exclude products with dimensions in centimeters (these are rolls like "Borde Separador", not malla sombra)
  console.log('📦 Using sellable products from Inventario (ProductFamily)');
  const products = await ProductFamily.find({
    sellable: true,
    active: true,
    size: { $exists: true, $ne: null },
    price: { $exists: true, $gt: 0 },
    // Exclude products where width is in cm (rolls/borders, not malla sombra sheets)
    'dimensionUnits.width': { $ne: 'cm' }
  }).lean();

  console.log(`📦 Found ${products.length} active sellable products with size and price`);

  for (const product of products) {
    if (product.size) {
      const parsed = parseSizeString(product.size);
      if (parsed) {
        // Get preferred online store link
        const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                             product.onlineStoreLinks?.[0]?.url || null;

        sizes.push({
          ...parsed,
          price: product.price,
          source: preferredLink ? 'mercadolibre' : 'product',
          productName: product.name,
          productId: product._id,
          mLink: preferredLink,
          permalink: preferredLink,
          imageUrl: product.imageUrl || product.thumbnail
        });
      }
    }
  }

  // Deduplicate by size (keep first occurrence, which has the link)
  const seen = new Set();
  const uniqueSizes = sizes.filter(s => {
    const key = s.sizeStr;
    if (seen.has(key)) {
      console.log(`⚠️ Duplicate size ${key} filtered out`);
      return false;
    }
    seen.add(key);
    return true;
  });

  // Sort by area
  return uniqueSizes.sort((a, b) => a.area - b.area);
}

/**
 * Finds closest smaller and bigger sizes to requested dimension
 *
 * IMPORTANT - DIMENSION INTERCHANGEABILITY:
 * For rectangular products (malla sombra confeccionada), width and length are
 * INTERCHANGEABLE. A 4x2m is the SAME product as 2x4m - the fabric can be
 * oriented either way. This function checks BOTH orientations when matching.
 *
 * For physical coverage, we need dimensions that can COVER the requested space,
 * not just match the area. If user wants 10x8m, they need at least 10m in one
 * direction AND 8m in the other (in either orientation).
 *
 * @param {object} requestedDim - {width, height, area}
 * @param {Array} availableSizes - Array from getAvailableSizes()
 * @returns {object} - {smaller, bigger, exact}
 */
function findClosestSizes(requestedDim, availableSizes) {
  const requestedArea = requestedDim.area;

  // Check for exact match by dimensions (not just area!)
  // INTERCHANGEABLE: Must match either width×height OR height×width (swapped)
  // Example: 4x2m matches both "4x2" and "2x4" products
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
  // This ensures we suggest sizes that are physically useful, not just area-equivalent
  const validSizes = availableSizes.filter(size => {
    const canCoverNormal = size.width >= requestedDim.width && size.height >= requestedDim.height;
    const canCoverSwapped = size.width >= requestedDim.height && size.height >= requestedDim.width;
    return canCoverNormal || canCoverSwapped;
  });

  // Among valid sizes that can cover the space, find closest match
  // Priority: smallest size that still covers the requested dimensions
  let bestMatch = null;
  let smallestValidArea = Infinity;

  for (const size of validSizes) {
    if (size.area < smallestValidArea) {
      bestMatch = size;
      smallestValidArea = size.area;
    }
  }

  // If we found a valid covering size, return it as "bigger"
  // We don't suggest "smaller" sizes anymore since they can't physically cover the space
  return {
    smaller: null,  // No smaller sizes - they won't physically cover the requested dimensions
    bigger: bestMatch,
    exact
  };
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
  return /\b(color|colores|qu[eé]\s+colou?r|qu[eé]\s+colores|tonos?|verde|azul|negra?|blanca?|beige|bex)\b/i.test(message) ||
         /\b(tienes?|tienen?|hay|manejan?)\s+(otros?\s+)?colou?res?\b/i.test(message);
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
  return /\b(maleza|antimaleza|anti-maleza|hierba|malas?\s+hierbas?|ground\s*cover|gran\s*cover|crec[eé]\s+(la\s+)?maleza|quita\s+maleza|evita\s+maleza|bloquea\s+maleza)\b/i.test(message);
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
 * Check if a size was already offered in this conversation
 * @param {string} sizeStr - Size to check, e.g., "3x2m"
 * @param {Array} offeredSizes - Array from conversation.offeredSizes
 * @returns {object|null} - The offer if found, null otherwise
 */
function wasAlreadyOffered(sizeStr, offeredSizes) {
  if (!offeredSizes || offeredSizes.length === 0) return null;
  return offeredSizes.find(o => o.size === sizeStr);
}

/**
 * Generates natural response for size inquiry using AI
 * @param {object} options - Response configuration
 * @returns {Promise<object>} - {text, suggestedSizes, isCustomOrder, requiresHandoff}
 */
async function generateSizeResponse(options) {
  const { smaller, bigger, exact, requestedDim, availableSizes, isRepeated, businessInfo, offeredSizes } = options;
  const { generatePriceResponse, generateCustomOrderResponse, generateNoMatchResponse } = require('./ai/responseGenerator');

  const suggestedSizes = [];

  // Check if we're about to suggest a size we already offered
  const suggestedSize = exact?.sizeStr || bigger?.sizeStr;
  const previousOffer = suggestedSize ? wasAlreadyOffered(suggestedSize, offeredSizes) : null;

  if (previousOffer && requestedDim) {
    suggestedSizes.push(suggestedSize);
    const link = exact?.mLink || exact?.permalink || bigger?.mLink || bigger?.permalink;
    const price = exact?.price || bigger?.price;

    // Use AI for repeat offer
    try {
      const { generateResponse } = require('./ai/responseGenerator');
      const aiResponse = await generateResponse({
        intent: "repeat_offer",
        context: {
          requestedSize: `${requestedDim.width}x${requestedDim.height}m`,
          offeredSize: suggestedSize,
          price: price,
          link: link
        }
      });
      if (aiResponse) {
        return { text: aiResponse, suggestedSizes, offeredToShowAllSizes: false, alreadyOffered: true };
      }
    } catch (err) {
      console.error("AI failed for repeat offer:", err.message);
    }
  }

  // CUSTOM ORDER: Both sides >= 8m
  if (requestedDim && isCustomOrder(requestedDim)) {
    const inBusinessHours = isBusinessHours();
    const largestSizes = availableSizes
      .filter(s => s.price > 0)
      .sort((a, b) => b.area - a.area)
      .slice(0, 4);

    try {
      const aiResponse = await generateCustomOrderResponse({
        dimensions: requestedDim,
        largestSizes
      });
      if (aiResponse) {
        return {
          text: aiResponse,
          suggestedSizes: largestSizes.map(s => s.sizeStr),
          offeredToShowAllSizes: false,
          isCustomOrder: true,
          requiresHandoff: inBusinessHours,
          largestSizes
        };
      }
    } catch (err) {
      console.error("AI failed for custom order:", err.message);
    }
  }

  // EXACT MATCH
  if (exact) {
    suggestedSizes.push(exact.sizeStr);
    const link = exact.mLink || exact.permalink;

    try {
      const aiResponse = await generatePriceResponse({
        dimensions: requestedDim || { width: exact.width, height: exact.height },
        price: exact.price,
        link: link,
        userExpression: requestedDim ? `${requestedDim.width} x ${requestedDim.height} metros` : exact.sizeStr
      });
      if (aiResponse) {
        return { text: aiResponse, suggestedSizes, offeredToShowAllSizes: false };
      }
    } catch (err) {
      console.error("AI failed for price response:", err.message);
    }
  }

  // NO EXACT MATCH - suggest alternative or custom fabrication
  const closestSize = bigger || null;
  const largestSize = availableSizes.length > 0 ? availableSizes[availableSizes.length - 1] : null;

  if (closestSize) suggestedSizes.push(closestSize.sizeStr);
  else if (largestSize) suggestedSizes.push(largestSize.sizeStr);

  try {
    const aiResponse = await generateNoMatchResponse({
      dimensions: requestedDim,
      closestSize,
      largestSize
    });
    if (aiResponse) {
      return { text: aiResponse, suggestedSizes, offeredToShowAllSizes: false };
    }
  } catch (err) {
    console.error("AI failed for no-match response:", err.message);
  }

  // Final fallback - should rarely hit this
  return {
    text: "Esa medida no la manejamos como estándar. Contáctanos por WhatsApp para cotizar: https://wa.me/524425957432",
    suggestedSizes,
    offeredToShowAllSizes: false
  };
}

/**
 * Generates response for generic size/price inquiry
 * @param {Array} availableSizes - not used, kept for compatibility
 * @returns {string}
 */
function generateGenericSizeResponse(availableSizes) {
  // Ask directly for the size they need - DON'T offer lists we can't provide
  const responses = [
    "El precio depende de la medida, manejamos desde 2x2m hasta 6x10m. ¿Qué medida necesitas?",
    "El precio varía según la medida. Tenemos desde 2x2m hasta 6x10m. ¿Qué tamaño buscas?",
    "Manejamos medidas desde 2x2m hasta 6x10m. ¿Qué medida necesitas para darte el precio exacto?"
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Checks if a dimension looks like it might be missing a decimal point
 * e.g., 380 might mean 3.80, 450 might mean 4.50
 * @param {object} dimensions - {width, height, area}
 * @returns {object|null} - {original, corrected, dimension} if suspicious, null otherwise
 */
function hasSuspiciousLargeDimension(dimensions) {
  if (!dimensions) return null;

  const checkDimension = (value, name) => {
    // Check if value is >= 100 and when divided by 100 gives reasonable meters (1.5-10m)
    if (value >= 100 && value <= 1000) {
      const corrected = value / 100;
      // Only flag if corrected value is reasonable (1.5m to 10m)
      if (corrected >= 1.5 && corrected <= 10) {
        return { original: value, corrected, dimension: name };
      }
    }
    return null;
  };

  // Check width first, then height
  const widthCheck = checkDimension(dimensions.width, 'width');
  if (widthCheck) return widthCheck;

  const heightCheck = checkDimension(dimensions.height, 'height');
  if (heightCheck) return heightCheck;

  return null;
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
  hasSuspiciousLargeDimension,
  generateSizeResponse,
  generateGenericSizeResponse,
  isCustomOrder,
  isBusinessHours
};
