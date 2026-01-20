// ai/customerClassifier.js
// Intelligent customer type classification based on conversation patterns

/**
 * Customer types and their characteristics
 */
const CUSTOMER_TYPES = {
  residential: {
    label: "Residencial",
    description: "Cliente final para casa/terraza",
    keywords: [
      /\b(terraza|patio|casa|hogar|jard[ií]n|cochera|estacionamiento)\b/i,
      /\b(privacidad|sombra para casa|mi casa|en casa)\b/i,
      /\b(lista para instalar|ya confeccionada|hecha)\b/i,
      /\b\d+x\d+\b/i, // Dimensions like 3x4, 6x4
      /\b(beige|color|instalaci[oó]n)\b/i
    ],
    productFamilyRoots: ["Malla Sombra Confeccionada 90%"], // Root product family names
    priority: 5,
    responseStyle: "friendly" // más casual y explicativo
  },

  fabricator: {
    label: "Confeccionista/Revendedor",
    description: "Compra rollos para confeccionar",
    keywords: [
      /\b(rollo\s+(?:de\s+)?(?:\d+(?:\.\d+)?)\s*[xX×*]\s*(?:\d+(?:\.\d+)?))\b/i, // "rollo 4x100"
      /\b(rollo\s+(?:completo|entero))\b/i,
      /\b(confeccionar|fabricar|hacer mallas)\b/i,
      /\b(mayoreo\s+rollos?|precio\s+rollo)\b/i,
      /\b(4x100|3x100|2x100)\b/i // Common roll dimensions
    ],
    productFamilyRoots: ["Rollos 90%"],
    priority: 9,
    responseStyle: "professional" // más directo y técnico
  },

  agricultural: {
    label: "Agrícola",
    description: "Cliente agrícola (raschel)",
    keywords: [
      /\b(raschel\s*(?:35|50|70)?)\b/i,
      /\b(malla agr[ií]cola|agricultura|cultivo)\b/i,
      /\b(invernadero|vivero|hortalizas?)\b/i,
      /\b(35%|50%|70%)\b/i, // Shade percentages for raschel
      /\b(protecci[oó]n\s+solar\s+cultivo)\b/i
    ],
    productFamilyRoots: ["Mallas Agrícolas Raschel"],
    priority: 8,
    responseStyle: "technical" // técnico y especializado
  },

  groundCover: {
    label: "Ground Cover",
    description: "Control de maleza",
    keywords: [
      /\b(anti.?maleza|antimaleza)\b/i,
      /\b(ground\s*cover|groundcover|gran\s*cover)\b/i,
      /\b(control\s+(?:de\s+)?maleza)\b/i,
      /\b(hierbas?|yerbas?|malas?\s+hierbas?)\b/i,
      /\b(bloquear\s+maleza|evitar\s+maleza)\b/i
    ],
    productFamilyRoots: ["Malla Antimaleza (Ground Cover)"],
    priority: 8,
    responseStyle: "solution-focused" // enfocado en solución de problema
  },

  edgeSeparator: {
    label: "Bordes/Separadores",
    description: "Bordes y delineadores",
    keywords: [
      /\b(borde|bordes)\b/i,
      /\b(delineador|separador)\b/i,
      /\b(delimitar|delimitador)\b/i,
      /\b(18m|rollo\s+18)\b/i, // Common edge roll size
      /\b(jardin[er][ií]a|paisajismo)\b/i
    ],
    productFamilyRoots: ["Bordes Separadores"],
    priority: 7,
    responseStyle: "friendly"
  },

  distributor: {
    label: "Distribuidor",
    description: "Distribuidor/mayorista",
    keywords: [
      /\b(distribuidor|distribuidores?|distribuir)\b/i,
      /\b(revender|reventa|revendedor)\b/i,
      /\b(precio\s+distribuidor|precio\s+mayoreo)\b/i,
      /\b(lista\s+de\s+precios?)\b/i,
      /\b(catálogo\s+mayorista|cat[aá]logo\s+completo)\b/i,
      /\b(quiero\s+mayoreo|compra\s+mayoreo)\b/i,
      /\b(volumen|grandes?\s+vol[uú]menes)\b/i
    ],
    productFamilyRoots: [], // All product families
    priority: 10,
    responseStyle: "business" // profesional y orientado a negocios
  }
};

/**
 * Identify customer type based on message content and conversation history
 * @param {string} msg - Current message from customer
 * @param {object} convo - Conversation object
 * @returns {object|null} - Customer type object or null
 */
function identifyCustomerType(msg, convo = {}) {
  // If already classified, check if new evidence suggests reclassification
  const currentType = convo.customerType;

  // Score each customer type
  const scores = {};

  for (const [key, type] of Object.entries(CUSTOMER_TYPES)) {
    let score = 0;

    // Count keyword matches
    const keywordMatches = type.keywords.filter(regex => regex.test(msg)).length;
    score += keywordMatches * type.priority;

    // Boost score if this is a new classification (no previous type)
    if (!currentType) {
      score += 2;
    }

    // Boost score if matches current type (consistency bonus)
    if (currentType === key) {
      score += 5;
    }

    scores[key] = score;
  }

  // Find highest scoring type
  const sortedTypes = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort(([_, a], [__, b]) => b - a);

  if (sortedTypes.length === 0) {
    // No clear type identified, return current or default to residential
    return currentType || 'residential';
  }

  const [topType, topScore] = sortedTypes[0];

  // Only change classification if score is significantly higher
  if (currentType && currentType !== topType) {
    const currentScore = scores[currentType] || 0;
    // Require at least 8 point difference to reclassify
    if (topScore - currentScore < 8) {
      return currentType;
    }
  }

  return topType;
}

/**
 * Get customer type details
 * @param {string} customerType - Customer type key
 * @returns {object} - Customer type object
 */
function getCustomerTypeDetails(customerType) {
  return CUSTOMER_TYPES[customerType] || CUSTOMER_TYPES.residential;
}

/**
 * Get appropriate product family roots for customer type
 * @param {string} customerType - Customer type key
 * @returns {array} - Array of product family root names
 */
function getProductFamiliesForCustomer(customerType) {
  const typeDetails = CUSTOMER_TYPES[customerType];

  if (!typeDetails) {
    return ["Malla Sombra Confeccionada 90%"]; // Default to residential
  }

  // Distributors can see all product families
  if (customerType === 'distributor') {
    return Object.values(CUSTOMER_TYPES)
      .flatMap(t => t.productFamilyRoots)
      .filter((v, i, a) => a.indexOf(v) === i); // Unique values
  }

  return typeDetails.productFamilyRoots;
}

/**
 * Generate personalized greeting based on customer type
 * @param {string} customerType - Customer type key
 * @returns {string} - Personalized greeting
 */
function getPersonalizedGreeting(customerType) {
  const greetings = {
    residential: "¡Hola! ¿Buscas malla sombra para tu casa o terraza?",
    fabricator: "¡Hola! ¿Necesitas rollos para confeccionar?",
    agricultural: "¡Hola! ¿Buscas malla agrícola para tu cultivo?",
    groundCover: "¡Hola! ¿Necesitas controlar la maleza en tu terreno?",
    edgeSeparator: "¡Hola! ¿Buscas bordes para delimitar tu jardín?",
    distributor: "¡Hola! ¿Te interesa distribuir nuestros productos?"
  };

  return greetings[customerType] || greetings.residential;
}

/**
 * Check if a message contains customer type indicators
 * @param {string} msg - Message to analyze
 * @returns {boolean} - True if message has type indicators
 */
function hasCustomerTypeIndicators(msg) {
  for (const type of Object.values(CUSTOMER_TYPES)) {
    const hasMatch = type.keywords.some(regex => regex.test(msg));
    if (hasMatch) return true;
  }
  return false;
}

/**
 * Get response style recommendations based on customer type
 * @param {string} customerType - Customer type key
 * @returns {object} - Style recommendations
 */
function getResponseStyle(customerType) {
  const typeDetails = getCustomerTypeDetails(customerType);

  const styles = {
    friendly: {
      tone: "casual y amigable",
      details: "explicaciones detalladas",
      emojis: true,
      technicalLevel: "bajo"
    },
    professional: {
      tone: "profesional y directo",
      details: "información concisa",
      emojis: false,
      technicalLevel: "medio"
    },
    technical: {
      tone: "técnico y especializado",
      details: "especificaciones técnicas",
      emojis: false,
      technicalLevel: "alto"
    },
    "solution-focused": {
      tone: "orientado a soluciones",
      details: "beneficios y aplicaciones",
      emojis: true,
      technicalLevel: "medio"
    },
    business: {
      tone: "profesional y comercial",
      details: "términos de negocio",
      emojis: false,
      technicalLevel: "medio-alto"
    }
  };

  return styles[typeDetails.responseStyle] || styles.friendly;
}

module.exports = {
  identifyCustomerType,
  getCustomerTypeDetails,
  getProductFamiliesForCustomer,
  getPersonalizedGreeting,
  hasCustomerTypeIndicators,
  getResponseStyle,
  CUSTOMER_TYPES
};
