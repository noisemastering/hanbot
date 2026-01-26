// ai/utils/dimensionParsers.js
// Centralized dimension parsing for all product types
//
// THREE PARSERS:
// 1. parseConfeccionadaDimensions - for rectangular pre-made products (malla sombra confeccionada)
// 2. parseCintaDimensions - for linear products (borde separador, cinta plástica)
// 3. parseRollDimensions - for roll products (rollo malla, groundcover, monofilamento)

/**
 * Parse dimensions for CONFECCIONADA products (malla sombra confeccionada, etc.)
 * These are rectangular products with dimensions in whole meters.
 *
 * Formats handled:
 * - "4x3", "4 x 3", "4*3", "4×3"
 * - "4x3m", "4x3 metros", "4 mts x 3 mts"
 * - "4 por 3", "4 de 3"
 * - "4 y medio x 3" (converts to 4.5x3)
 *
 * @param {string} str - User message
 * @returns {object|null} { width, height, area, normalized, hasFractional } or null
 */
function parseConfeccionadaDimensions(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Convert "y medio" to .5 (e.g., "2 y medio" -> "2.5")
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Universal pattern for rectangular dimensions:
  // Number + optional unit + separator (x/×/*/por/de) + number + optional unit
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?\s*(?:x|×|\*|por|de)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i;

  const m = s.match(pattern);
  if (!m) return null;

  const dim1 = parseFloat(m[1]);
  const dim2 = parseFloat(m[2]);

  if (Number.isNaN(dim1) || Number.isNaN(dim2)) return null;
  if (dim1 <= 0 || dim2 <= 0) return null;

  // Normalize: smaller dimension first for consistent DB matching
  const width = Math.min(dim1, dim2);
  const height = Math.max(dim1, dim2);

  // Check if any dimension has fractional part
  const hasFractional = (dim1 % 1 !== 0) || (dim2 % 1 !== 0);

  return {
    width,
    height,
    original: { dim1, dim2 },
    area: dim1 * dim2,
    normalized: `${width}x${height}`,
    hasFractional
  };
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
    /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)/i,
    // "de 10", "unos 10" (when followed by context about borde/cinta)
    /(?:de|unos?|como)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i,
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

  // Standard roll lengths
  const standardLengths = [50, 100];

  // Pattern for width x length
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?\s*(?:x|×|\*|por|de)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i;

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
  const widthOnlyPattern = /rollo\s*(?:de)?\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i;
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

  // Convert "y medio" to .5
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Match single number with optional units
  const pattern = /(?:de|como|ha\s*de|unos?)?\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?(?:\s|$)/i;

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

  // Convert "y medio" to .5
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Global pattern to find all dimension pairs
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?\s*(?:x|×|\*|por)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/gi;

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
