// ai/utils/dimensionParsers.js
// Centralized dimension parsing for all product types
//
// THREE PARSERS:
// 1. parseConfeccionadaDimensions - for rectangular pre-made products (malla sombra confeccionada)
// 2. parseCintaDimensions - for linear products (borde separador, cinta plástica)
// 3. parseRollDimensions - for roll products (rollo malla, groundcover, monofilamento)

// Import Spanish number conversion from single source of truth
const { convertSpanishNumbers } = require('./spanishNumbers');

// Conversion constant
const FEET_TO_METERS = 0.3048;

/**
 * Parse dimensions for CONFECCIONADA products (malla sombra confeccionada, etc.)
 * These are rectangular products with dimensions in whole meters.
 *
 * Formats handled:
 * - "4x3", "4 x 3", "4*3", "4×3"
 * - "4x3m", "4x3 metros", "4 mts x 3 mts"
 * - "4 por 3", "4 de 3"
 * - "4 y medio x 3" (converts to 4.5x3)
 * - "16x10 pies", "16 por 10 ft" (converts feet to meters)
 *
 * @param {string} str - User message
 * @returns {object|null} { width, height, area, normalized, hasFractional, convertedFromFeet, originalFeet } or null
 */
function parseConfeccionadaDimensions(str) {
  if (!str) return null;

  // First, convert Spanish number words to digits
  // "seis por cuatro" -> "6 por 4"
  let s = convertSpanishNumbers(String(str).toLowerCase());

  // Normalize spaces within decimal numbers: "4. 50" -> "4.50", "4 .50" -> "4.50"
  // This handles typos where users add spaces around decimal points
  s = s.replace(/(\d+)\s*\.\s*(\d+)/g, '$1.$2');

  // Check if dimensions are in feet
  const isFeet = /\b(pies?|ft|feet|foot)\b/i.test(s);

  // Convert 3-digit numbers to decimals (common Mexican shorthand)
  // 610 → 6.10, 420 → 4.20, 315 → 3.15, etc.
  // BUT keep multiples of 50 as-is (100, 150, 200, 250...) - those are real large dimensions
  s = s.replace(/\b([1-9])(\d{2})\b(?!\d)/g, (match, first, rest) => {
    const num = parseInt(match, 10);
    // Keep multiples of 50 as-is (100, 150, 200, 250, 300, etc.)
    if (num % 50 === 0) {
      return match;
    }
    const asDecimal = parseFloat(`${first}.${rest}`);
    // Only convert if result is a reasonable dimension (1-10 meters)
    if (asDecimal >= 1 && asDecimal <= 10) {
      return `${first}.${rest}`;
    }
    return match;
  });

  // Convert "y medio" to .5 (e.g., "2 y medio" -> "2.5")
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Pattern 1: "N de largo x M de ancho" or "N de ancho x M de largo"
  // Examples: "8 mts. de largo x 5 de ancho", "5 de ancho por 8 de largo", "3 largo x 2 ancho"
  // Note: "d" is common abbreviation for "de" in Mexican Spanish (e.g., "7 mtrs d ancho")
  // The "de"/"d" is now optional to handle "3 largo x 2 ancho" format
  const largoAnchoPattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:d(?:e)?\s*)?largo\s*(?:x|×|por|y)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:(?:d(?:e)?\s*)?ancho)?/i;
  const anchoLargoPattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:d(?:e)?\s*)?ancho\s*(?:x|×|por|y)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:(?:d(?:e)?\s*)?largo)?/i;

  // Pattern 1b: "N de ancho y de largo M" (number comes AFTER largo)
  // Example: "8 d ancho y d largo 610" -> width=8, height=6.10
  const anchoYLargoPattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:d(?:e)?\s*)?ancho\s*(?:x|×|por|y)\s*(?:d(?:e)?\s*)?largo\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?/i;

  let m = s.match(anchoYLargoPattern);
  if (m) {
    // "ancho ... y ... largo N" format - first number is width, second is height
    const width = parseFloat(m[1]);
    const height = parseFloat(m[2]);
    return buildResult(width, height, isFeet, `${m[1]} x ${m[2]}`);
  }

  m = s.match(largoAnchoPattern);
  if (m) {
    // "largo x ancho" format - first number is height (largo), second is width (ancho)
    const height = parseFloat(m[1]);
    const width = parseFloat(m[2]);
    // User expressed as "largo x ancho", preserve that order
    return buildResult(width, height, isFeet, `${m[1]} x ${m[2]}`);
  }

  m = s.match(anchoLargoPattern);
  if (m) {
    // "ancho x largo" format - first number is width (ancho), second is height (largo)
    const width = parseFloat(m[1]);
    const height = parseFloat(m[2]);
    // User expressed as "ancho x largo", preserve that order
    return buildResult(width, height, isFeet, `${m[1]} x ${m[2]}`);
  }

  // Pattern 2a: EXPLICIT separators (x, ×, *) - highest priority
  // These are unambiguous dimension separators, check first
  const explicitPattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?|(?:pies?|ft|feet))?\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?|(?:pies?|ft|feet))?/i;

  m = s.match(explicitPattern);
  if (m) {
    const dim1 = parseFloat(m[1]);
    const dim2 = parseFloat(m[2]);
    return buildResult(dim1, dim2, isFeet, `${m[1]} x ${m[2]}`);
  }

  // Pattern 2b: "por" and "de" separators - lower priority
  // "de" is ambiguous (can be "una de 10x8" where "de" doesn't mean dimensions)
  // Only use these when no explicit x/×/* pattern was found
  const softPattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?|(?:pies?|ft|feet))?\s*(?:por|de)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?|(?:pies?|ft|feet))?/i;

  m = s.match(softPattern);
  if (!m) return null;

  const dim1 = parseFloat(m[1]);
  const dim2 = parseFloat(m[2]);

  // Preserve the order user typed
  return buildResult(dim1, dim2, isFeet, `${m[1]} x ${m[2]}`);
}

/**
 * Helper to build dimension result object
 * @param {number} dim1 - First dimension
 * @param {number} dim2 - Second dimension
 * @param {boolean} isFeet - Whether dimensions are in feet (need conversion)
 * @param {string} userExpressed - The dimension string in the order user expressed it (e.g., "7 x 5")
 */
function buildResult(dim1, dim2, isFeet = false, userExpressed = null) {
  if (Number.isNaN(dim1) || Number.isNaN(dim2)) return null;
  if (dim1 <= 0 || dim2 <= 0) return null;

  // Store original values before any conversion
  const originalDim1 = dim1;
  const originalDim2 = dim2;

  // Convert feet to meters if needed
  if (isFeet) {
    dim1 = dim1 * FEET_TO_METERS;
    dim2 = dim2 * FEET_TO_METERS;
    // Round to 1 decimal place for practical use
    dim1 = Math.round(dim1 * 10) / 10;
    dim2 = Math.round(dim2 * 10) / 10;
  }

  // Normalize: smaller dimension first for consistent DB matching
  const width = Math.min(dim1, dim2);
  const height = Math.max(dim1, dim2);

  // Check if any dimension has fractional part
  const hasFractional = (dim1 % 1 !== 0) || (dim2 % 1 !== 0);

  const result = {
    width,
    height,
    original: { dim1: originalDim1, dim2: originalDim2 },
    area: dim1 * dim2,
    normalized: `${width}x${height}`,
    // Display format: preserve user's order, or fall back to normalized
    userExpressed: userExpressed || `${dim1} x ${dim2}`,
    hasFractional
  };

  // Add conversion info if feet were converted
  if (isFeet) {
    result.convertedFromFeet = true;
    result.originalFeet = { dim1: originalDim1, dim2: originalDim2 };
    result.originalFeetStr = `${originalDim1}x${originalDim2} pies`;
  }

  return result;
}

/**
 * Parse dimensions for CINTA PLÁSTICA products (borde separador, etc.)
 * These are linear products measured by length only.
 *
 * Formats handled:
 * - "10m", "10 m", "10 metros"
 * - "15 mts", "20 mt"
 * - "de 10 metros", "unos 15m"
 * - Also handles common lengths: "rollo de 10", "10 metros de borde"
 *
 * @param {string} str - User message
 * @returns {object|null} { length, normalized } or null
 */
function parseCintaDimensions(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Common cinta/borde lengths to look for
  const commonLengths = [10, 15, 20, 25, 50];

  // Pattern for length: number + optional unit
  // "10m", "10 metros", "de 10m", "rollo de 10"
  const patterns = [
    // "10 metros", "10m", "10 mts"
    /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)/i,
    // "de 10", "unos 10" (when followed by context about borde/cinta)
    /(?:de|unos?|como)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?/i,
    // Just a number if it's a common length
    /\b(\d+)\b/
  ];

  for (const pattern of patterns) {
    const m = s.match(pattern);
    if (m) {
      const length = parseFloat(m[1]);

      if (Number.isNaN(length) || length <= 0) continue;

      // For just numbers, only accept if it's a common cinta length
      if (pattern === patterns[2] && !commonLengths.includes(length)) {
        continue;
      }

      return {
        length,
        normalized: `${length}m`
      };
    }
  }

  return null;
}

/**
 * Parse dimensions for ROLL products (rollo malla sombra, groundcover, monofilamento)
 * These have width × length where length is typically 50m or 100m.
 * Width is usually in meters with decimals (1.05, 2.10, 4.20).
 *
 * Formats handled:
 * - "4.20x100", "4.20 x 100", "4.20*100"
 * - "4.20m x 100m", "4.20 mts x 100 mts"
 * - "de 4.20 por 100"
 * - "rollo de 2 metros" (assumes 100m length)
 *
 * @param {string} str - User message
 * @returns {object|null} { width, length, normalized, isStandardRoll } or null
 */
function parseRollDimensions(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Convert 3-digit numbers to decimals (common Mexican shorthand)
  // 420 → 4.20, 315 → 3.15, etc.
  // BUT keep multiples of 50 as-is (100, 150, 200, 250...)
  s = s.replace(/\b([1-9])(\d{2})\b(?!\d)/g, (match, first, rest) => {
    const num = parseInt(match, 10);
    if (num % 50 === 0) return match;
    const asDecimal = parseFloat(`${first}.${rest}`);
    if (asDecimal >= 1 && asDecimal <= 10) {
      return `${first}.${rest}`;
    }
    return match;
  });

  // Standard roll lengths
  const standardLengths = [50, 100];

  // Pattern for width x length
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:x|×|\*|por|de)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?/i;

  const m = s.match(pattern);
  if (m) {
    const dim1 = parseFloat(m[1]);
    const dim2 = parseFloat(m[2]);

    if (Number.isNaN(dim1) || Number.isNaN(dim2)) return null;
    if (dim1 <= 0 || dim2 <= 0) return null;

    // For rolls, the larger dimension is always length (50m or 100m typically)
    const width = Math.min(dim1, dim2);
    const length = Math.max(dim1, dim2);

    return {
      width,
      length,
      normalized: `${width}x${length}`,
      isStandardRoll: standardLengths.includes(length)
    };
  }

  // Also try to match just width if user mentions "rollo de X metros"
  const widthOnlyPattern = /rollo\s*(?:de)?\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?/i;
  const widthMatch = s.match(widthOnlyPattern);
  if (widthMatch) {
    const width = parseFloat(widthMatch[1]);
    if (!Number.isNaN(width) && width > 0 && width <= 10) {
      return {
        width,
        length: null, // User needs to specify
        normalized: `${width}x?`,
        isStandardRoll: false
      };
    }
  }

  return null;
}

/**
 * Parse a single dimension from message (for follow-up questions)
 * E.g., when user says "2 y medio" or "3 metros" in response to "¿Qué ancho?"
 *
 * @param {string} str - User message
 * @returns {number|null} Dimension in meters or null
 */
function parseSingleDimension(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Convert 3-digit numbers to decimals (common Mexican shorthand)
  // 610 → 6.10, 420 → 4.20, etc.
  // BUT keep multiples of 50 as-is (100, 150, 200, 250...)
  s = s.replace(/\b([1-9])(\d{2})\b(?!\d)/g, (match, first, rest) => {
    const num = parseInt(match, 10);
    if (num % 50 === 0) return match;
    const asDecimal = parseFloat(`${first}.${rest}`);
    if (asDecimal >= 1 && asDecimal <= 10) {
      return `${first}.${rest}`;
    }
    return match;
  });

  // Convert "y medio" to .5
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Match single number with optional units
  const pattern = /(?:de|como|ha\s*de|unos?)?\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?(?:\s|$)/i;

  const m = s.match(pattern);
  if (!m) return null;

  const dim = parseFloat(m[1]);
  if (Number.isNaN(dim) || dim <= 0 || dim > 100) return null; // Sanity check

  return dim;
}

/**
 * Extract ALL dimensions from a message (for multiple size requests)
 * E.g., "quiero de 4x3 y de 5x5" -> [{4,3}, {5,5}]
 *
 * @param {string} str - User message
 * @param {string} type - 'confeccionada' | 'roll' | 'cinta'
 * @returns {Array} Array of dimension objects
 */
function extractAllDimensions(str, type = 'confeccionada') {
  if (!str) return [];

  const results = [];
  let s = String(str).toLowerCase();

  // Convert 3-digit numbers to decimals (common Mexican shorthand)
  // BUT keep multiples of 50 as-is (100, 150, 200, 250...)
  s = s.replace(/\b([1-9])(\d{2})\b(?!\d)/g, (match, first, rest) => {
    const num = parseInt(match, 10);
    if (num % 50 === 0) return match;
    const asDecimal = parseFloat(`${first}.${rest}`);
    if (asDecimal >= 1 && asDecimal <= 10) {
      return `${first}.${rest}`;
    }
    return match;
  });

  // Convert "y medio" to .5
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Global pattern to find all dimension pairs
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?\s*(?:x|×|\*|por)\s*(\d+(?:\.\d+)?)\s*(?:m(?:trs?|ts|etros?|t)?\.?)?/gi;

  let match;
  while ((match = pattern.exec(s)) !== null) {
    const dim1 = parseFloat(match[1]);
    const dim2 = parseFloat(match[2]);

    if (!Number.isNaN(dim1) && !Number.isNaN(dim2) && dim1 > 0 && dim2 > 0) {
      if (type === 'confeccionada') {
        results.push({
          width: Math.min(dim1, dim2),
          height: Math.max(dim1, dim2)
        });
      } else {
        results.push({
          width: Math.min(dim1, dim2),
          length: Math.max(dim1, dim2)
        });
      }
    }
  }

  return results;
}

module.exports = {
  parseConfeccionadaDimensions,
  parseCintaDimensions,
  parseRollDimensions,
  parseSingleDimension,
  extractAllDimensions
};
