// measureHandler.js
//
// IMPORTANT: For rectangular products like "malla sombra confeccionada",
// width and length are INTERCHANGEABLE. A 4m x 2m product is the EXACT
// SAME as a 2m x 4m product. The fabric can be oriented either way.
// All dimension matching functions handle this by checking both orientations.
//
const ProductFamily = require("./models/ProductFamily");
const { extractReference } = require("./referenceEstimator");

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

  // PREPROCESSING: Fix spacing around decimal points (e.g., "7 .70" → "7.70")
  // This handles cases where users add spaces before decimal points
  let normalized = converted.replace(/(\d)\s+(\.\d+)/g, '$1$2');

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

  // PREPROCESSING: Strip out "m" units (e.g., "6.5 m x 3.17 m" → "6.5 x 3.17")
  // This allows all existing patterns to work with messages that include units
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*m\b/gi, '$1');

  // PREPROCESSING: Normalize "k" separator to "x" (common text abbreviation: "4 k 4" → "4 x 4")
  normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*k\s*(\d+(?:\.\d+)?)/gi, '$1 x $2');

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

  // Pattern 5: "3 ancho x 5 largo" - dimensions with ancho/largo labels
  const pattern5 = /(\d+(?:\.\d+)?)\s+(?:de\s+)?ancho\s+(?:por|x)\s+(\d+(?:\.\d+)?)\s+(?:de\s+)?largo/i;

  // Pattern 6: "8 metros de largo x 5 de ancho" or "8 metros de ancho x 5 de largo"
  const pattern6 = /(\d+(?:\.\d+)?)\s*metros?\s+de\s+(largo|ancho)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:metros?)?\s*(?:de\s+)?(largo|ancho)?/i;

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

  // Pattern 9: Single dimension implies square - "de 4 metros", "una de 4", "4 metros q sale"
  // Only match if it's clearly asking for a size (with "de" prefix or "metros" unit)
  const patternSquare = /\b(?:de|una?\s+de)\s+(\d+(?:\.\d+)?)\s*(?:metros?|m)?\b/i;
  const matchSquare = normalized.match(patternSquare);
  if (matchSquare) {
    const size = parseFloat(matchSquare[1]);
    // Only treat as square if size is reasonable (2-10 meters)
    if (size >= 2 && size <= 10) {
      console.log(`📐 Single dimension detected (${size}m), treating as ${size}x${size} square`);
      return {
        width: size,
        height: size,
        area: size * size,
        isSquare: true
      };
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
          mLink: preferredLink,
          permalink: preferredLink,
          imageUrl: product.imageUrl || product.thumbnail
        });
      }
    }
  }

  // Sort by area
  return sizes.sort((a, b) => a.area - b.area);
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
 * @returns {object} - {text, suggestedSizes, isCustomOrder, requiresHandoff} where suggestedSizes is array of size strings for context
 */
function generateSizeResponse(options) {
  const { smaller, bigger, exact, requestedDim, availableSizes, isRepeated, businessInfo } = options;

  const responses = [];
  const suggestedSizes = []; // Track suggested sizes for context

  // FIRST: Check if this is a custom order (both sides >= 8m)
  // These ALWAYS need human attention, even if product exists in inventory
  if (requestedDim && isCustomOrder(requestedDim)) {
    const inBusinessHours = isBusinessHours();

    let customOrderText = `La medida de ${requestedDim.width}x${requestedDim.height}m es un pedido especial que requiere fabricación personalizada.\n\n`;
    customOrderText += `Este tipo de medidas necesitan cotización directa con nuestro equipo de ventas.\n\n`;

    if (businessInfo) {
      const whatsappLink = "https://wa.me/524425957432";
      customOrderText += `💬 WhatsApp: ${whatsappLink}\n`;
      customOrderText += `📞 Contáctanos: ${businessInfo.phones?.join(' / ') || 'Contacto no disponible'}\n`;
      customOrderText += `🕓 Horario: ${businessInfo.hours || 'Lunes a Viernes 9:00-18:00'}\n`;
      customOrderText += `📍 ${businessInfo.address || ''}`;
    }

    if (inBusinessHours) {
      customOrderText += `\n\n✅ Estamos en horario de atención. Un asesor te contactará en breve para ayudarte con tu cotización.`;
    }

    return {
      text: customOrderText,
      suggestedSizes: [],
      offeredToShowAllSizes: false,
      isCustomOrder: true,
      requiresHandoff: inBusinessHours
    };
  }

  if (exact) {
    // Generic responses WITHOUT ML link (link shown only on buying intent or when user asks for details)
    suggestedSizes.push(exact.sizeStr);
    responses.push(
      `¡Claro! 😊 De ${exact.sizeStr} la tenemos en $${exact.price}`,
      `¡Perfecto! La ${exact.sizeStr} está disponible por $${exact.price} 🌿`,
      `Con gusto 😊 La malla de ${exact.sizeStr} la manejamos en $${exact.price}`
    );
  } else {
    const parts = [];

    // No exact match - suggest closest size that can cover the dimensions, or custom fabrication
    if (bigger) {
      // We have a size that can cover the requested dimensions
      if (requestedDim) {
        parts.push(`La medida exacta de ${requestedDim.width}x${requestedDim.height}m no la manejamos, pero tengo dos opciones para ti:\n`);
        parts.push(`\nOpción 1: Medida estándar más cercana que cubre tus dimensiones:`);
        parts.push(`\n• ${bigger.sizeStr} por $${bigger.price}`);
        suggestedSizes.push(bigger.sizeStr);

        // ALWAYS mention custom fabrication option with contact info
        if (businessInfo) {
          const whatsappLink = "https://wa.me/524425957432";
          parts.push(`\n\nOpción 2: Fabricación a la medida exacta (${requestedDim.width}x${requestedDim.height}m)`);
          parts.push(`\nPara cotizar medidas personalizadas, contáctanos:`);
          parts.push(`\n💬 WhatsApp: ${whatsappLink}`);
          parts.push(`\n📞 ${businessInfo.phones?.join(' / ') || 'Contacto no disponible'}`);
          parts.push(`\n🕓 ${businessInfo.hours || 'Lunes a Viernes 9:00-18:00'}`);
        }

        parts.push('\n\n¿Te interesa la medida estándar o prefieres cotizar la fabricación personalizada?');
      } else {
        parts.push(`Esa medida no la manejamos como estándar.\n`);
        parts.push(`\nLa medida más cercana disponible es:`);
        parts.push(`\n• ${bigger.sizeStr} por $${bigger.price}`);
        suggestedSizes.push(bigger.sizeStr);
        parts.push('\n\n¿Te interesa esta opción?');
      }
    } else {
      // No standard size can cover the requested dimensions - custom fabrication only
      if (availableSizes.length > 0) {
        const largest = availableSizes[availableSizes.length - 1];

        if (requestedDim) {
          parts.push(`La medida de ${requestedDim.width}x${requestedDim.height}m excede nuestras medidas estándar.`);
          parts.push(`\n\nNuestra medida más grande disponible es ${largest.sizeStr} por $${largest.price}.`);
          suggestedSizes.push(largest.sizeStr);
        } else {
          parts.push(`Esa medida excede nuestras medidas estándar.`);
          parts.push(`\n\nLa más grande disponible es ${largest.sizeStr} por $${largest.price}.`);
          suggestedSizes.push(largest.sizeStr);
        }
      }

      // Offer custom fabrication
      if (businessInfo && requestedDim) {
        const whatsappLink = "https://wa.me/524425957432";
        parts.push(`\n\nPara la medida que necesitas (${requestedDim.width}x${requestedDim.height}m), podemos fabricarla a la medida. Para cotizar, contáctanos:\n`);
        parts.push(`\n💬 WhatsApp: ${whatsappLink}`);
        parts.push(`\n📞 ${businessInfo.phones?.join(' / ') || 'Contacto no disponible'}`);
        parts.push(`\n🕓 ${businessInfo.hours || 'Lunes a Viernes 9:00-18:00'}`);
      } else if (businessInfo) {
        const whatsappLink = "https://wa.me/524425957432";
        parts.push(`\n\nPara medidas personalizadas, contáctanos:\n`);
        parts.push(`\n💬 WhatsApp: ${whatsappLink}`);
        parts.push(`\n📞 ${businessInfo.phones?.join(' / ') || 'Contacto no disponible'}`);
        parts.push(`\n🕓 ${businessInfo.hours || 'Lunes a Viernes 9:00-18:00'}`);
      }

      parts.push(`\n\nO también puedes ver todas nuestras medidas estándar en nuestra Tienda Oficial:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob`);
    }

    responses.push(parts.join(''));
  }

  // Check if we're offering to show all sizes (when we ask the question)
  const offeredToShowAllSizes = responses.some(r => r.includes('¿Te gustaría ver todas nuestras medidas estándar?'));

  return {
    text: responses[Math.floor(Math.random() * responses.length)],
    suggestedSizes,
    offeredToShowAllSizes
  };
}

/**
 * Generates response for generic size/price inquiry
 * @param {Array} availableSizes - not used, kept for compatibility
 * @returns {string}
 */
function generateGenericSizeResponse(availableSizes) {
  // Simple response asking for size - don't quote specific prices that may be outdated
  const responses = [
    "El precio depende de la medida, manejamos desde 2x2m hasta 6x10m. ¿Deseas ver la lista?",
    "El precio varía según la medida. Tenemos desde 2x2m hasta 6x10m. ¿Te muestro las opciones?",
    "Manejamos medidas desde 2x2m hasta 6x10m. ¿Qué medida necesitas para darte el precio exacto?"
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
  generateGenericSizeResponse,
  isCustomOrder,
  isBusinessHours
};
