// ai/utils/usoCaseMatcher.js
// Detects use case keywords and validates product fit

const Uso = require("../../models/Uso");

/**
 * Extract potential use case keywords from a message
 * Looks for patterns like "para mi X", "para un X", "lo necesito para X"
 */
function extractUseKeywords(message) {
  if (!message) return [];

  const msg = message.toLowerCase();
  const keywords = [];

  // Patterns that indicate use case
  const patterns = [
    /para\s+(?:mi|un|una|el|la|los|las)?\s*(\w+)/gi,
    /lo\s+(?:necesito|quiero|ocupo)\s+para\s+(?:mi|un|una|el|la)?\s*(\w+)/gi,
    /(?:es|será?)\s+para\s+(?:mi|un|una|el|la)?\s*(\w+)/gi,
    /(?:voy\s+a|quiero)\s+(?:cubrir|tapar|proteger)\s+(?:mi|un|una|el|la)?\s*(\w+)/gi,
    /(?:tengo|tiene)\s+(?:un|una)?\s*(\w+)\s+(?:que|y)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(msg)) !== null) {
      if (match[1] && match[1].length > 2) {
        keywords.push(match[1].toLowerCase());
      }
    }
  }

  // Also check for standalone keywords that are commonly use cases
  const standaloneKeywords = [
    'invernadero', 'vivero', 'cultivo', 'agricultura',
    'estacionamiento', 'cochera', 'garage', 'carro', 'coche', 'auto',
    'patio', 'terraza', 'jardin', 'jardín', 'alberca', 'piscina',
    'gallinas', 'gallinero', 'corral', 'ganado', 'vacas',
    'canchas', 'cancha', 'deportivo',
    'negocio', 'local', 'comercial', 'bodega',
    'construccion', 'construcción', 'obra'
  ];

  for (const kw of standaloneKeywords) {
    if (msg.includes(kw) && !keywords.includes(kw)) {
      keywords.push(kw);
    }
  }

  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Find Usos that match the given keywords
 */
async function findMatchingUsos(keywords) {
  if (!keywords || keywords.length === 0) return [];

  try {
    const usos = await Uso.find({
      keywords: { $in: keywords },
      available: true
    })
      .populate('products', 'name description sellable generation parentId')
      .sort({ priority: -1 })
      .lean();

    return usos;
  } catch (err) {
    console.error("Error finding matching usos:", err.message);
    return [];
  }
}

/**
 * Check if a product interest matches any of the given Usos
 * @param {string} productInterest - Current product interest (e.g., "malla_sombra", "rollo")
 * @param {Array} usos - Array of Uso documents with populated products
 * @returns {object} { fits: boolean, bestUso: Uso|null, suggestedProducts: Array }
 */
function checkProductFit(productInterest, usos) {
  if (!usos || usos.length === 0) {
    return { fits: true, bestUso: null, suggestedProducts: [] };
  }

  // Map product interest to possible product name patterns
  const interestPatterns = {
    'malla_sombra': /malla.*sombra.*confeccionada|confeccionada/i,
    'malla_sombra_confeccionada': /malla.*sombra.*confeccionada|confeccionada/i,
    'confeccionada': /malla.*sombra.*confeccionada|confeccionada/i,
    'rollo': /rollo|malla.*sombra.*rollo/i,
    'borde_separador': /borde.*separador|borde.*jardin/i,
    'groundcover': /ground\s*cover|antimaleza/i,
    'ground_cover': /ground\s*cover|antimaleza/i,
    'monofilamento': /monofilamento/i
  };

  const pattern = interestPatterns[productInterest?.toLowerCase()];

  for (const uso of usos) {
    if (!uso.products || uso.products.length === 0) continue;

    // Check if current product interest is in this Uso's products
    const currentFits = uso.products.some(p => {
      if (!pattern) return false;
      return pattern.test(p.name);
    });

    if (currentFits) {
      return { fits: true, bestUso: uso, suggestedProducts: [] };
    }
  }

  // Current product doesn't fit - return suggested alternatives
  const bestUso = usos[0]; // Highest priority matching uso
  const suggestedProducts = bestUso.products
    .filter(p => p.sellable)
    .slice(0, 3); // Top 3 suggestions

  return {
    fits: false,
    bestUso,
    suggestedProducts
  };
}

/**
 * Main function: Analyze message for use case and validate product fit
 * @param {string} message - User message
 * @param {string} productInterest - Current product interest
 * @returns {object} Analysis result
 */
async function analyzeUseCaseFit(message, productInterest) {
  // Step 1: Extract use case keywords from message
  const keywords = extractUseKeywords(message);

  if (keywords.length === 0) {
    return {
      detected: false,
      keywords: [],
      fits: true,
      bestUso: null,
      suggestedProducts: [],
      shouldSuggestChange: false
    };
  }

  console.log(`🎯 Use case keywords detected: ${keywords.join(', ')}`);

  // Step 2: Find matching Usos
  const matchingUsos = await findMatchingUsos(keywords);

  if (matchingUsos.length === 0) {
    console.log(`⚠️ No Usos found for keywords: ${keywords.join(', ')}`);
    return {
      detected: true,
      keywords,
      fits: true, // No data to contradict, assume it fits
      bestUso: null,
      suggestedProducts: [],
      shouldSuggestChange: false
    };
  }

  console.log(`✅ Found ${matchingUsos.length} matching Uso(s): ${matchingUsos.map(u => u.name).join(', ')}`);

  // Step 3: Check if current product fits
  const fitResult = checkProductFit(productInterest, matchingUsos);

  if (!fitResult.fits) {
    console.log(`⚠️ Product mismatch: "${productInterest}" doesn't fit uso "${fitResult.bestUso?.name}"`);
    console.log(`💡 Suggested products: ${fitResult.suggestedProducts.map(p => p.name).join(', ')}`);
  }

  return {
    detected: true,
    keywords,
    fits: fitResult.fits,
    bestUso: fitResult.bestUso,
    suggestedProducts: fitResult.suggestedProducts,
    shouldSuggestChange: !fitResult.fits && fitResult.suggestedProducts.length > 0
  };
}

/**
 * Generate a suggestion message when product doesn't fit use case
 */
function generateSuggestionMessage(analysis) {
  if (!analysis.shouldSuggestChange || !analysis.bestUso) {
    return null;
  }

  const usoName = analysis.bestUso.name;
  const products = analysis.suggestedProducts;

  if (products.length === 0) {
    return null;
  }

  // Build product suggestions
  const productNames = products.map(p => {
    // Extract key info from product name
    const name = p.name.toLowerCase();
    if (name.includes('rollo')) return 'rollo de malla sombra';
    if (name.includes('ground') || name.includes('antimaleza')) return 'ground cover antimaleza';
    if (name.includes('monofilamento')) return 'malla monofilamento';
    if (name.includes('borde')) return 'borde separador';
    return p.name;
  });

  const uniqueProducts = [...new Set(productNames)];

  if (uniqueProducts.length === 1) {
    return `Para ${analysis.keywords[0]} te recomendaría más el ${uniqueProducts[0]}. ¿Te interesa que te cotice esa opción?`;
  }

  const lastProduct = uniqueProducts.pop();
  return `Para ${analysis.keywords[0]} te recomendaría más ${uniqueProducts.join(', ')} o ${lastProduct}. ¿Cuál te interesa?`;
}

module.exports = {
  extractUseKeywords,
  findMatchingUsos,
  checkProductFit,
  analyzeUseCaseFit,
  generateSuggestionMessage
};
