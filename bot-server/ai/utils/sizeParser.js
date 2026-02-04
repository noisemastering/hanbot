// ai/utils/sizeParser.js
// Utility to parse dimensions from user messages

// Convert Spanish number words to digits
function convertSpanishNumbers(text) {
  const numberMap = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
    'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9',
    'diez': '10', 'once': '11', 'doce': '12'
  };
  let converted = text.toLowerCase();
  converted = converted.replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+y\s+medio\b/gi, (match, num) => {
    const numVal = numberMap[num.toLowerCase()];
    return numVal ? `${numVal}.5` : match;
  });
  for (const [word, digit] of Object.entries(numberMap)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    converted = converted.replace(regex, digit);
  }
  return converted;
}

/**
 * Parse dimensions from a text string
 * Handles formats like: "3.5x4", "3.5 x 4", "3,5 por 4", "3.5m x 4m", "3.5 de 4"
 * Also handles Spanish: "seis por cuatro" -> 6x4
 *
 * @param {string} text - User message containing dimensions
 * @returns {object|null} { width, length, hasFractional, raw } or null if not found
 */
function parseDimensions(text) {
  if (!text) return null;

  // First convert Spanish number words to digits
  let normalized = convertSpanishNumbers(text.toLowerCase())
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ');

  // Handle fractions BEFORE removing units: "7mts y 1/2" or "7 y medio" → "7.5"
  normalized = normalized
    .replace(/(\d+)\s*(?:m|mts?|metros?)?\s*y\s*1\/2/g, (_, num) => `${parseFloat(num) + 0.5}`)
    .replace(/(\d+)\s*(?:m|mts?|metros?)?\s*y\s*medi[oa]/g, (_, num) => `${parseFloat(num) + 0.5}`)
    .replace(/(\d+)\s*1\/2/g, (_, num) => `${parseFloat(num) + 0.5}`);

  // Now normalize units
  normalized = normalized
    .replace(/mts?\.?/g, 'm')
    .replace(/metros?/g, 'm');

  // Patterns to match dimensions (most specific first)
  const patterns = [
    // 3.5x4, 3.5 x 4, 3.5m x 4m, 3.5 por 4, 3.5 de 4
    /(\d+(?:\.\d+)?)\s*(?:m\s*)?\s*(?:x|por|de|\*)\s*(\d+(?:\.\d+)?)\s*(?:m)?/,
    // "3.5 metros por 4 metros"
    /(\d+(?:\.\d+)?)\s*m?\s*(?:x|por|de|\*)\s*(\d+(?:\.\d+)?)\s*m?/,
    // Just a single dimension with decimal like "3.5m" or "3.5 metros"
    /(\d+\.\d+)\s*m?(?:\s|$)/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const dim1 = parseFloat(match[1]);
      const dim2 = match[2] ? parseFloat(match[2]) : null;

      // Determine width and length (smaller is width by convention)
      let width, length;
      if (dim2 !== null) {
        width = Math.min(dim1, dim2);
        length = Math.max(dim1, dim2);
      } else {
        // Single dimension - could be width or length
        width = dim1;
        length = null;
      }

      // Check if any dimension has fractional part
      const hasFractional = (dim1 % 1 !== 0) || (dim2 !== null && dim2 % 1 !== 0);

      return {
        width,
        length,
        hasFractional,
        raw: match[0],
        dim1,
        dim2
      };
    }
  }

  return null;
}

/**
 * Check if dimensions suggest a roll (any dimension > threshold)
 * @param {object} dimensions - Parsed dimensions object
 * @param {number} threshold - Size threshold (default 50m)
 * @returns {boolean}
 */
function suggestsRoll(dimensions, threshold = 50) {
  if (!dimensions) return false;
  return dimensions.width > threshold || (dimensions.length && dimensions.length > threshold);
}

/**
 * Infer product type from dimensions
 * Small dimensions (both < 12m) = likely confeccionada
 * Large dimensions (any > 50m) = likely rollo
 * Medium = uncertain
 *
 * @param {object} dimensions - Parsed dimensions object
 * @returns {string} 'confeccionada' | 'rollo' | 'unknown'
 */
function inferProductType(dimensions) {
  if (!dimensions) return 'unknown';

  const { width, length } = dimensions;

  // Large dimensions = rollo
  if (width > 50 || (length && length > 50)) {
    return 'rollo';
  }

  // Typical confeccionada range (both dimensions <= 12m)
  if (width <= 12 && (!length || length <= 12)) {
    return 'confeccionada';
  }

  // Medium range - uncertain
  return 'unknown';
}

/**
 * Find similar stock dimensions based on requested size
 * Returns dimensions where either side is close to requested
 *
 * @param {object} requested - Parsed dimensions { width, length }
 * @param {Array} availableSizes - Array of { width, length } objects
 * @param {number} tolerance - How close is "similar" (default 1m)
 * @returns {Array} Sorted array of similar sizes
 */
function findSimilarSizes(requested, availableSizes, tolerance = 1) {
  if (!requested || !availableSizes) return [];

  const { width: reqWidth, length: reqLength } = requested;

  return availableSizes.filter(size => {
    // Check if either dimension is close to either requested dimension
    const widthClose = Math.abs(size.width - reqWidth) <= tolerance ||
                       (reqLength && Math.abs(size.width - reqLength) <= tolerance);
    const lengthClose = (size.length && Math.abs(size.length - reqWidth) <= tolerance) ||
                        (size.length && reqLength && Math.abs(size.length - reqLength) <= tolerance);

    return widthClose || lengthClose;
  }).sort((a, b) => {
    // Sort by how close the total dimensions are
    const aDiff = Math.abs(a.width - reqWidth) + Math.abs((a.length || 0) - (reqLength || 0));
    const bDiff = Math.abs(b.width - reqWidth) + Math.abs((b.length || 0) - (reqLength || 0));
    return aDiff - bDiff;
  });
}

/**
 * Format dimensions for display
 * @param {number} width
 * @param {number} length
 * @returns {string} e.g., "3x4m"
 */
function formatDimensions(width, length) {
  if (length) {
    return `${width}x${length}m`;
  }
  return `${width}m`;
}

module.exports = {
  parseDimensions,
  suggestsRoll,
  inferProductType,
  findSimilarSizes,
  formatDimensions
};
