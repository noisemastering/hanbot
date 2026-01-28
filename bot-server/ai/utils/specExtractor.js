// ai/utils/specExtractor.js
// Central spec extraction - extracts ALL product specs from any message
// and merges them with existing conversation specs (never overwrites)

/**
 * Extract all product specs from a user message
 * This is the SINGLE SOURCE OF TRUTH for spec extraction
 * @param {string} message - User's message
 * @param {object} context - Optional context { lastIntent, productType }
 * @returns {object} - Extracted specs
 */
function extractAllSpecs(message, context = {}) {
  const specs = {};
  const cleanMsg = message.toLowerCase().trim();

  // ============================================================
  // DIMENSIONS (for confeccionadas and rolls)
  // ============================================================

  // Roll dimensions: NxN where second N is 100 (normalize 4.x→4, 2.x→2)
  const rollDimMatch = cleanMsg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(100)\b|(100)\s*[xX×*]\s*(\d+(?:\.\d+)?)/i);
  if (rollDimMatch) {
    let rawWidth = parseFloat(rollDimMatch[1] || rollDimMatch[4]);
    // Normalize: 4.x → 4, 2.x → 2
    if (rawWidth >= 4 && rawWidth < 5) rawWidth = 4;
    else if (rawWidth >= 2 && rawWidth < 3) rawWidth = 2;
    specs.width = rawWidth;
    specs.length = 100;
    specs.size = `${rawWidth}x100`;
    specs.productType = 'rollo';
  }

  // Confeccionada dimensions: NxM where M is NOT 100
  if (!specs.size) {
    const dimMatch = cleanMsg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
    if (dimMatch && parseFloat(dimMatch[2]) !== 100) {
      specs.width = parseFloat(dimMatch[1]);
      specs.height = parseFloat(dimMatch[2]);
      specs.size = `${specs.width}x${specs.height}`;
      if (!specs.productType) specs.productType = 'confeccionada';
    }
  }

  // Width selection for rolls (when awaiting width)
  if (!specs.width && context.lastIntent === 'roll_awaiting_width') {
    if (/\b(primer[oa]|la\s+de\s+4|4\.?[12]0?|de\s+4)\b/i.test(cleanMsg)) {
      specs.width = 4;
      specs.length = 100;
      specs.size = '4x100';
      specs.productType = 'rollo';
    } else if (/\b(segund[oa]|la\s+de\s+2|2\.?[12]0?|de\s+2)\b/i.test(cleanMsg)) {
      specs.width = 2;
      specs.length = 100;
      specs.size = '2x100';
      specs.productType = 'rollo';
    }
  }

  // ============================================================
  // PERCENTAGE (shade percentage for malla sombra)
  // ============================================================
  const percentMatch = cleanMsg.match(/(?:al\s+)?(\d{2,3})\s*(?:%|por\s*ciento)/i);
  if (percentMatch) {
    specs.percentage = parseInt(percentMatch[1]);
  }

  // Natural language percentage
  if (!specs.percentage) {
    if (/\b(menos\s*sombra|menor\s*sombra|poca\s*sombra|m[aá]s\s*delgad[oa]|delgad[oa])\b/i.test(cleanMsg)) {
      specs.percentage = 35;
    } else if (/\b(m[aá]s\s*sombra|mayor\s*sombra|mucha\s*sombra|m[aá]s\s*grues[oa]|grues[oa]|m[aá]s\s*denso|denso)\b/i.test(cleanMsg)) {
      specs.percentage = 90;
    }
  }

  // ============================================================
  // COLOR
  // ============================================================
  const colorMatch = cleanMsg.match(/\b(negro|negra|verde|beige|bex|blanco|blanca|azul|gris)\b/i);
  if (colorMatch) {
    let color = colorMatch[1].toLowerCase();
    // Normalize: negra→negro, blanca→blanco, bex→beige
    if (color === 'negra') color = 'negro';
    if (color === 'blanca') color = 'blanco';
    if (color === 'bex') color = 'beige';
    specs.color = color;
  }

  // ============================================================
  // QUANTITY
  // ============================================================
  const qtyMatch = cleanMsg.match(/(\d+)\s*(?:rol+[oy]s?|unidades?|piezas?|mallas?)/i) ||
                   cleanMsg.match(/(?:quiero|necesito|ocupo|son|dame)\s+(\d+)/i) ||
                   cleanMsg.match(/(?:por\s+lo\s+menos|minimo|mínimo)\s+(\d+)/i);
  if (qtyMatch) {
    specs.quantity = parseInt(qtyMatch[1]);
  }

  // ============================================================
  // PRODUCT TYPE (if not already set)
  // ============================================================
  if (!specs.productType) {
    if (/\b(rol+[oy]s?|rollo\s+entero|rollo\s+completo)\b/i.test(cleanMsg)) {
      specs.productType = 'rollo';
    } else if (/\b(confeccionada|cortada|lista|terminada)\b/i.test(cleanMsg)) {
      specs.productType = 'confeccionada';
    } else if (/\b(ground\s*cover|antimaleza|anti-maleza)\b/i.test(cleanMsg)) {
      specs.productType = 'ground_cover';
    } else if (/\b(monofilamento)\b/i.test(cleanMsg)) {
      specs.productType = 'monofilamento';
    } else if (/\b(borde|separador)\b/i.test(cleanMsg)) {
      specs.productType = 'borde';
    }
  }

  // ============================================================
  // CUSTOMER NAME (for orders)
  // ============================================================
  const nameMatch = message.match(/(?:nombre\s+de|para|cliente)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
  if (nameMatch) {
    specs.customerName = nameMatch[1];
  }

  return specs;
}

/**
 * Merge new specs with existing specs
 * New values override existing, but nulls don't wipe out existing values
 * @param {object} existing - Existing specs from conversation
 * @param {object} newSpecs - Newly extracted specs
 * @returns {object} - Merged specs
 */
function mergeSpecs(existing = {}, newSpecs = {}) {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(newSpecs)) {
    // Only override if new value is not null/undefined
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  merged.updatedAt = new Date();
  return merged;
}

/**
 * Get a human-readable summary of current specs
 * Useful for confirming what we know with the user
 * @param {object} specs - Product specs
 * @returns {string} - Summary text
 */
function getSpecsSummary(specs) {
  if (!specs || Object.keys(specs).length === 0) return null;

  const parts = [];

  if (specs.productType) {
    const typeNames = {
      'rollo': 'Rollo',
      'confeccionada': 'Malla confeccionada',
      'ground_cover': 'Ground Cover',
      'monofilamento': 'Monofilamento',
      'borde': 'Borde Separador'
    };
    parts.push(typeNames[specs.productType] || specs.productType);
  }

  if (specs.size) {
    parts.push(`${specs.size}m`);
  }

  if (specs.percentage) {
    parts.push(`${specs.percentage}%`);
  }

  if (specs.color) {
    parts.push(specs.color);
  }

  if (specs.quantity && specs.quantity > 1) {
    parts.push(`${specs.quantity} unidades`);
  }

  return parts.length > 0 ? parts.join(' - ') : null;
}

/**
 * Check what specs are still needed for a complete quote
 * @param {object} specs - Current specs
 * @param {string} productType - Product type (for type-specific requirements)
 * @returns {string[]} - Array of missing spec names
 */
function getMissingSpecs(specs, productType = null) {
  const type = productType || specs?.productType;
  const missing = [];

  if (!type) {
    missing.push('productType');
  }

  if (type === 'rollo') {
    if (!specs?.width) missing.push('width');
    if (!specs?.percentage) missing.push('percentage');
    // quantity is optional
  } else if (type === 'confeccionada') {
    if (!specs?.size && !specs?.width) missing.push('size');
    // percentage, color, quantity are optional
  }

  return missing;
}

module.exports = {
  extractAllSpecs,
  mergeSpecs,
  getSpecsSummary,
  getMissingSpecs
};
