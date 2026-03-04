// ai/utils/multiQuestionParser.js
// Parses messages for multiple questions and assigns priority

/**
 * Priority levels - lower number = higher priority
 */
const PRIORITY = {
  HIGH: 1,    // Has specific data (dimensions, product) - needs product flow
  MEDIUM: 2,  // Logistics questions - can be appended to response
  LOW: 3      // Social (greeting, thanks) - brief acknowledgment
};

/**
 * Question types with patterns and responses
 */
const QUESTION_TYPES = {
  // ============================================
  // HIGH PRIORITY - Product queries with data
  // ============================================
  price_query: {
    patterns: [
      /\b(precio|costo|cuánto|cuanto|vale|cuesta|cotiza|cotización)\b/i,
      /\b(a\s+cómo|a\s+como)\b/i
    ],
    priority: PRIORITY.HIGH,
    requiresData: true,
    category: 'product'
  },

  product_inquiry: {
    patterns: [
      /\b(tienen|tienes|manejan|venden|hay)\b.*\b(malla|rollo|borde)\b/i,
      /\b(malla|rollo|borde)\b.*\b(tienen|tienes|manejan|venden|hay)\b/i
    ],
    priority: PRIORITY.HIGH,
    requiresData: true,
    category: 'product'
  },

  size_query: {
    patterns: [
      /\b(medida|tamaño|dimensión|dimensiones)\b/i,
      /\d+\s*[xX×]\s*\d+/  // Explicit dimensions
    ],
    priority: PRIORITY.HIGH,
    requiresData: true,
    category: 'product'
  },

  // ============================================
  // MEDIUM PRIORITY - Logistics (appendable)
  // ============================================
  delivery_time: {
    patterns: [
      /\b(tiempo\s+de\s+entrega|cuánto\s+tarda|cuanto\s+tarda)\b/i,
      /\b(cuántos?\s+días|cuantos?\s+dias|cuando\s+llega|en\s+cuánto\s+llega)\b/i,
      /\b(tarda|demora|tardará|demorará)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "📦 Entrega en 2-5 días hábiles dependiendo de tu ubicación."
  },

  payment: {
    patterns: [
      /\b(formas?\s+de\s+pago|cómo\s+pago|como\s+pago|métodos?\s+de\s+pago)\b/i,
      /\b(aceptan\s+tarjeta|pago\s+con\s+tarjeta|meses\s+sin\s+intereses)\b/i,
      /\b(pago\s+contra\s+entrega|contraentrega|al\s+recibir)\b/i,
      /\b(oxxo|efectivo|transferencia)\b/i,
      /\b(c[oó]mo\s+(le\s+)?pago|como\s+es\s+el\s+pago)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "💳 Pago seguro por Mercado Libre: tarjeta, OXXO, o meses sin intereses."
  },

  shipping: {
    patterns: [
      /\b(envían|envian|hacen\s+envíos|hacen\s+envios)\b/i,
      /\b(llega\s+a|envío\s+a|envio\s+a|mandan\s+a)\b/i,
      /\b(costo\s+de\s+envío|costo\s+de\s+envio|cuánto\s+cuesta\s+el\s+envío)\b/i,
      /\b(envío\s+gratis|envio\s+gratis|incluye\s+envío)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "🚚 Envío a todo México incluido. También enviamos a USA."
  },

  availability: {
    patterns: [
      /\b(tienen\s+disponible|hay\s+en\s+existencia|está\s+disponible)\b/i,
      /\b(disponibilidad|existencia|stock|inventario)\b/i,
      /\b(lo\s+tienen|la\s+tienen|tienen\s+en\s+stock)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "✅ Disponibilidad inmediata en la mayoría de medidas."
  },

  installation: {
    patterns: [
      /\b(instalan|instalación|colocan|colocación)\b/i,
      /\b(cómo\s+se\s+instala|como\s+se\s+instala|fácil\s+de\s+instalar)\b/i,
      /\b(incluye\s+instalación|con\s+instalación)\b/i,
      /\b(ojillos?|argollas?|ganchos?)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "🔧 Viene lista para instalar con ojillos en todo el perímetro."
  },

  warranty: {
    patterns: [
      /\b(garantía|garantia|duración|duracion|vida\s+útil|cuánto\s+dura)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "⭐ Material de alta calidad con vida útil de 5+ años."
  },

  location: {
    patterns: [
      /\b(dónde\s+están|donde\s+estan|ubicación|ubicacion|dirección|direccion)\b/i,
      /\b(tienda\s+física|sucursal|pueden\s+recoger|paso\s+a\s+recoger)\b/i
    ],
    priority: PRIORITY.MEDIUM,
    category: 'logistics',
    appendResponse: "📍 Estamos en Querétaro, pero enviamos a todo México."
  },

  // ============================================
  // LOW PRIORITY - Social (brief acknowledgment)
  // ============================================
  greeting: {
    patterns: [
      /^(hola|buenas?|buenos?\s+d[ií]as?|buenas?\s+tardes?|buenas?\s+noches?|qué\s+tal|hey|hi)\b/i,
      /\b(buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches)\b/i
    ],
    priority: PRIORITY.LOW,
    category: 'social',
    prefixResponse: "¡Hola! ",
    skipIfCombined: false  // Include greeting prefix
  },

  thanks: {
    patterns: [
      /\b(gracias|muchas\s+gracias|mil\s+gracias|te\s+agradezco)\b/i
    ],
    priority: PRIORITY.LOW,
    category: 'social',
    suffixResponse: "\n\n¡Con gusto!",
    skipIfCombined: true  // Skip if combined with product questions
  },

  goodbye: {
    patterns: [
      /\b(adiós|adios|bye|hasta\s+luego|nos\s+vemos|chao)\b/i
    ],
    priority: PRIORITY.LOW,
    category: 'social',
    skipIfCombined: true
  }
};

/**
 * Extract specific data from message
 */
function extractData(message) {
  const data = {};

  // Dimensions (e.g., 6x5, 4x3m)
  const dimMatch = message.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (dimMatch) {
    data.dimensions = {
      width: parseFloat(dimMatch[1]),
      height: parseFloat(dimMatch[2]),
      raw: dimMatch[0]
    };
  }

  // Product keywords
  const productMatch = message.match(/\b(malla|rollo|borde|confeccionada|raschel|antiafido|anti-?[aá]fido|ground\s*cover|monofilamento)\b/i);
  if (productMatch) {
    data.product = productMatch[1].toLowerCase();
  }

  // Percentage
  const pctMatch = message.match(/(\d{2,3})\s*%/);
  if (pctMatch) {
    data.percentage = parseInt(pctMatch[1]);
  }

  // Quantity
  const qtyMatch = message.match(/(\d+)\s*(piezas?|rollos?|unidades?|metros?)/i);
  if (qtyMatch) {
    data.quantity = parseInt(qtyMatch[1]);
  }

  // Color
  const colorMatch = message.match(/\b(negro|negra|verde|beige|blanco|blanca|azul)\b/i);
  if (colorMatch) {
    data.color = colorMatch[1].toLowerCase();
  }

  // Location (city/state mentioned)
  const locationMatch = message.match(/\b(cdmx|monterrey|guadalajara|quer[eé]taro|tijuana|puebla|le[oó]n|canc[uú]n|m[eé]rida)\b/i);
  if (locationMatch) {
    data.location = locationMatch[1];
  }

  return data;
}

/**
 * Parse a message and extract all questions with priorities
 * @param {string} message - User's message
 * @returns {object} Parsed questions with primary, secondary, and extracted data
 */
function parseQuestions(message) {
  if (!message) {
    return { primary: null, secondary: [], all: [], data: {}, hasMultiple: false };
  }

  const cleanMsg = message.toLowerCase().trim();
  const questions = [];
  const matchedTypes = new Set();

  // Extract data first
  const data = extractData(message);
  const hasSpecificData = !!(data.dimensions || data.product || data.percentage);

  // Detect all question types
  for (const [type, config] of Object.entries(QUESTION_TYPES)) {
    // Skip if already matched this type
    if (matchedTypes.has(type)) continue;

    for (const pattern of config.patterns) {
      if (pattern.test(cleanMsg)) {
        let priority = config.priority;

        // Upgrade to HIGH priority if has specific data and question is data-dependent
        if (config.requiresData && hasSpecificData) {
          priority = PRIORITY.HIGH;
        }
        // Downgrade product questions without data to MEDIUM
        else if (config.requiresData && !hasSpecificData) {
          priority = PRIORITY.MEDIUM;
        }

        questions.push({
          type,
          priority,
          category: config.category,
          appendResponse: config.appendResponse,
          prefixResponse: config.prefixResponse,
          suffixResponse: config.suffixResponse,
          skipIfCombined: config.skipIfCombined || false,
          hasData: hasSpecificData
        });

        matchedTypes.add(type);
        break; // Only match once per type
      }
    }
  }

  // Sort by priority (ascending - lower number = higher priority)
  questions.sort((a, b) => a.priority - b.priority);

  // Determine primary question (highest priority, preferring ones with data)
  let primary = questions.find(q => q.priority === PRIORITY.HIGH) ||
                questions.find(q => q.category === 'product') ||
                questions[0] || null;

  // Secondary questions (everything except primary)
  const secondary = questions.filter(q => q !== primary);

  // Check if we have multiple substantive questions
  const substantiveCount = questions.filter(q => q.priority <= PRIORITY.MEDIUM).length;

  return {
    primary,
    secondary,
    all: questions,
    data,
    hasMultiple: substantiveCount > 1,
    hasSpecificData,
    questionCount: questions.length
  };
}

/**
 * Build prefix/suffix/followUp responses from secondary questions.
 * Location answers go into followUp (separate message bubble) instead
 * of being appended to the main text.
 *
 * @param {array} secondary - Array of secondary questions
 * @param {object} options - Options for building response
 * @returns {object} { prefix, suffix, followUp } strings
 */
function buildAppendableResponse(secondary, options = {}) {
  if (!secondary || secondary.length === 0) {
    return { prefix: '', suffix: '', followUp: '' };
  }

  const { skipSocial = false } = options;

  // Build prefix from LOW priority greetings
  let prefix = '';
  const greeting = secondary.find(q => q.type === 'greeting' && !q.skipIfCombined);
  if (greeting && greeting.prefixResponse) {
    prefix = greeting.prefixResponse;
  }

  // Build suffix from MEDIUM priority logistics questions
  // Location goes into followUp instead of suffix
  const suffixParts = [];
  const followUpParts = [];

  for (const q of secondary) {
    // Skip LOW priority if combined with substantive questions
    if (q.priority === PRIORITY.LOW) {
      if (!q.skipIfCombined && q.suffixResponse) {
        suffixParts.push(q.suffixResponse);
      }
      continue;
    }

    // Location → separate message (followUp)
    if (q.priority === PRIORITY.MEDIUM && q.type === 'location' && q.appendResponse) {
      followUpParts.push(q.appendResponse);
      continue;
    }

    // Other MEDIUM priority → inline suffix
    if (q.priority === PRIORITY.MEDIUM && q.appendResponse) {
      suffixParts.push(q.appendResponse);
    }
  }

  return {
    prefix,
    suffix: suffixParts.length > 0 ? '\n\n' + suffixParts.join('\n') : '',
    followUp: followUpParts.join('\n')
  };
}

/**
 * Wrap a response with prefix/suffix from parsed questions.
 * Location answers are returned in the followUp field (separate message).
 *
 * @param {string} mainResponse - The main response text
 * @param {object} parsed - Result from parseQuestions()
 * @returns {{ text: string, followUp?: string }}
 */
function wrapResponse(mainResponse, parsed) {
  if (!parsed || !mainResponse) {
    return { text: mainResponse };
  }

  const { prefix, suffix, followUp } = buildAppendableResponse(parsed.secondary);

  // Don't double-add greeting if response already starts with one
  const startsWithGreeting = /^[¡!]?hola/i.test(mainResponse);
  const finalPrefix = startsWithGreeting ? '' : prefix;

  const result = { text: `${finalPrefix}${mainResponse}${suffix}` };
  if (followUp) result.followUp = followUp;
  return result;
}

/**
 * Check if message should be handled by product flow
 * (has HIGH priority question with data)
 */
function shouldUseProductFlow(parsed) {
  return parsed.primary &&
         parsed.primary.priority === PRIORITY.HIGH &&
         parsed.hasSpecificData;
}

/**
 * Get list of unanswered question types from parsed result
 * Useful for flows to check what else needs to be addressed
 */
function getUnansweredTypes(parsed, answeredTypes = []) {
  return parsed.all
    .filter(q => !answeredTypes.includes(q.type))
    .map(q => q.type);
}

module.exports = {
  parseQuestions,
  buildAppendableResponse,
  wrapResponse,
  shouldUseProductFlow,
  getUnansweredTypes,
  extractData,
  PRIORITY,
  QUESTION_TYPES
};
