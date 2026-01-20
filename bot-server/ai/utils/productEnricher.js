// ai/utils/productEnricher.js
// Enriches product information with parent context and descriptions

const ProductFamily = require("../../models/ProductFamily");

/**
 * Get full product context including parent descriptions
 * @param {object|string} product - Product object or ID
 * @returns {object} - Enriched product with parent context
 */
async function enrichProductWithContext(product) {
  try {
    let productDoc = product;

    // If product is an ID, fetch it
    if (typeof product === 'string') {
      productDoc = await ProductFamily.findById(product).populate('parentId');
    } else if (product._id && !product.parentId) {
      // Re-fetch with parent populated
      productDoc = await ProductFamily.findById(product._id).populate('parentId');
    }

    if (!productDoc) {
      console.error("Product not found for enrichment");
      return null;
    }

    // Build context object
    const enrichedProduct = {
      ...productDoc.toObject(),
      contextDescription: buildContextDescription(productDoc),
      fullDescription: buildFullDescription(productDoc),
      parentContext: productDoc.parentId ? {
        name: productDoc.parentId.name,
        description: productDoc.parentId.description,
        generation: productDoc.parentId.generation
      } : null
    };

    return enrichedProduct;
  } catch (error) {
    console.error("Error enriching product:", error);
    return product; // Return original if enrichment fails
  }
}

/**
 * Build a contextual description combining parent and product info
 * @param {object} product - Product document with parentId populated
 * @returns {string} - Context description
 */
function buildContextDescription(product) {
  const parts = [];

  // Add parent context if available
  if (product.parentId && product.parentId.description) {
    parts.push(product.parentId.description);
  }

  // Add product's own generic description
  if (product.genericDescription) {
    parts.push(product.genericDescription);
  }

  // Add product's full description if it's sellable and has one
  if (product.sellable && product.description && !parts.includes(product.description)) {
    parts.push(product.description);
  }

  return parts.join(" - ");
}

/**
 * Build a full description with all available information
 * @param {object} product - Product document
 * @returns {string} - Full description
 */
function buildFullDescription(product) {
  const parts = [];

  // Product name
  parts.push(`${product.name}`);

  // Add generation context
  if (product.generation > 1 && product.parentId) {
    parts.push(`(${product.parentId.name} > Gen ${product.generation})`);
  }

  // Add main description
  if (product.description) {
    parts.push(`\n${product.description}`);
  }

  // Add generic description if different from main
  if (product.genericDescription && product.genericDescription !== product.description) {
    parts.push(`\n${product.genericDescription}`);
  }

  // Add attributes if available
  if (product.attributes && product.attributes.size > 0) {
    const attrs = [];
    for (const [key, value] of product.attributes) {
      attrs.push(`${key}: ${value}`);
    }
    if (attrs.length > 0) {
      parts.push(`\n\n_Características:_ ${attrs.join(", ")}`);
    }
  }

  // Add price if sellable
  if (product.sellable && product.price) {
    parts.push(`\n\n💰 Precio: $${product.price}`);
  }

  return parts.join(" ");
}

/**
 * Get product's entire lineage (all parents up to root)
 * @param {object} product - Product document
 * @returns {array} - Array of parent products from root to current
 */
async function getProductLineage(product) {
  const lineage = [];
  let current = product;

  while (current) {
    lineage.unshift({
      name: current.name,
      description: current.description,
      genericDescription: current.genericDescription,
      generation: current.generation
    });

    if (current.parentId) {
      // Fetch parent if not already populated
      if (typeof current.parentId === 'string') {
        current = await ProductFamily.findById(current.parentId);
      } else {
        current = current.parentId;
      }
    } else {
      current = null;
    }
  }

  return lineage;
}

/**
 * Format product for bot response with full context
 * @param {object} product - Product document
 * @param {object} options - Formatting options
 * @returns {string} - Formatted product description for bot
 */
async function formatProductForBot(product, options = {}) {
  const {
    includePrice = true,
    includeParentContext = true,
    includeAttributes = true,
    style = 'default' // 'default', 'brief', 'detailed'
  } = options;

  const enriched = await enrichProductWithContext(product);
  if (!enriched) return product.name;

  let response = "";

  // Brief style - just name and quick description
  if (style === 'brief') {
    response = enriched.name;
    if (enriched.genericDescription) {
      response += ` - ${enriched.genericDescription}`;
    }
    return response;
  }

  // Detailed style - full information
  if (style === 'detailed') {
    return enriched.fullDescription;
  }

  // Default style - balanced
  response = `${enriched.name}`;

  // Add parent context
  if (includeParentContext && enriched.parentContext) {
    response += `\n_Categoría: ${enriched.parentContext.name}_`;
  }

  // Add description (prefer genericDescription, fallback to description)
  const desc = enriched.genericDescription || enriched.description;
  if (desc) {
    response += `\n${desc}`;
  }

  // Add key attributes
  if (includeAttributes && enriched.attributes) {
    const keyAttrs = [];
    for (const [key, value] of enriched.attributes) {
      // Only show most relevant attributes
      if (['tamaño', 'size', 'color', 'tipo', 'acabado'].includes(key.toLowerCase())) {
        keyAttrs.push(`${key}: ${value}`);
      }
    }
    if (keyAttrs.length > 0) {
      response += `\n${keyAttrs.join(" | ")}`;
    }
  }

  // Add price
  if (includePrice && enriched.sellable && enriched.price) {
    response += `\n💰 $${enriched.price}`;
  }

  return response;
}

/**
 * Get children products with their descriptions
 * @param {string} parentId - Parent product ID
 * @returns {array} - Array of children products
 */
async function getChildrenWithContext(parentId) {
  try {
    const children = await ProductFamily.find({ parentId }).populate('parentId');
    return Promise.all(children.map(child => enrichProductWithContext(child)));
  } catch (error) {
    console.error("Error getting children with context:", error);
    return [];
  }
}

/**
 * Determine productInterest by climbing up the product hierarchy
 * - For most families: use root (generation 1) name
 * - For "Cinta Plástica": use generation 2 name (Borde Separador, Cinta Rígida, Cinta Rompevientos)
 * @param {object|string} product - Product document or ID
 * @returns {string|null} - productInterest value (snake_case)
 */
async function getProductInterest(product) {
  try {
    let productDoc = product;

    // If product is an ID, fetch it
    if (typeof product === 'string') {
      productDoc = await ProductFamily.findById(product).lean();
    } else if (product.toObject) {
      productDoc = product.toObject();
    }

    if (!productDoc) return null;

    // Climb up the hierarchy to find root and generation 2
    let current = productDoc;
    let gen2Ancestor = null;
    let root = null;

    while (current) {
      if (current.generation === 1) {
        root = current;
        break;
      }
      if (current.generation === 2) {
        gen2Ancestor = current;
      }

      if (current.parentId) {
        const parentId = typeof current.parentId === 'object' ? current.parentId._id || current.parentId : current.parentId;
        current = await ProductFamily.findById(parentId).lean();
      } else {
        break;
      }
    }

    if (!root) return null;

    // Determine which ancestor to use for productInterest
    let interestSource;
    if (root.name === 'Cinta Plástica' && gen2Ancestor) {
      // For Cinta Plástica family, use generation 2 (Borde Separador, Cinta Rígida, Cinta Rompevientos)
      interestSource = gen2Ancestor.name;
    } else {
      // For all other families, use root name
      interestSource = root.name;
    }

    // Convert to snake_case
    const productInterest = interestSource
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    return productInterest;
  } catch (error) {
    console.error("Error getting productInterest:", error);
    return null;
  }
}

/**
 * Naming templates per product family
 * Defines which generations to include at each verbosity level
 * Format: { full: [gen numbers], short: [gen numbers], mini: [gen numbers] }
 */
const NAMING_TEMPLATES = {
  // Malla Sombra Raschel: gen1=Malla Sombra Raschel, gen2=90%, gen3=Confeccionada/Rollo, gen4=Triangular/Rectangular/Medida, gen5=size/color
  'malla_sombra_raschel': {
    full: [1, 2, 3, 4, 5],   // Malla Sombra Raschel 90% Confeccionada con Refuerzo Triangular 5x5x5m
    short: [1, 4, 5],        // Malla Sombra Triangular 5x5x5m
    mini: [4, 5]             // Triangular 5x5x5m
  },
  // Malla Sombra Raschel Agrícola: similar structure
  'malla_sombra_raschel_agricola': {
    full: [1, 2, 3, 4],
    short: [1, 3, 4],
    mini: [3, 4]
  },
  // Borde Separador: gen1=Cinta Plástica, gen2=Borde Separador (13cm width), gen3=Rollo de Xm
  // Custom format: combines width from gen2 + length from gen3
  'borde_separador': {
    full: 'custom',          // Borde Separador de 13 cm x 54 m (uses custom formatter)
    short: [2, 3],           // Borde Separador Rollo de 54 m
    mini: [3]                // Rollo de 54 m
  },
  // Cinta Rompevientos
  'cinta_rompevientos': {
    full: [2, 3],
    short: [2, 3],
    mini: [3]
  },
  // Cinta Rígida
  'cinta_rigida': {
    full: [2, 3],
    short: [2, 3],
    mini: [3]
  },
  // Ground Cover: gen1=Ground Cover, gen2=Rollo size
  'ground_cover': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  },
  // Monofilamento
  'monofilamento': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  },
  // Antigranizo
  'antigranizo': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  },
  // Malla Antiáfido
  'antiafido': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  },
  // Herrajes
  'herrajes': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  },
  // Sujetadores
  'sujetadores': {
    full: [1, 2],
    short: [1, 2],
    mini: [2]
  }
};

/**
 * Build custom product name for families that need special formatting
 * @param {string} interest - productInterest value
 * @param {array} lineage - Full lineage array from root to leaf
 * @param {object} productDoc - Product document
 * @returns {string|null} - Custom formatted name or null if not applicable
 */
async function buildCustomProductName(interest, lineage, productDoc) {
  try {
    if (interest === 'borde_separador') {
      // Format: "Borde Separador de 13 cm x 54 m"
      // Get width from gen 2 (Borde Separador) and length from gen 3 (Rollo de Xm)
      const gen2 = lineage.find(l => l.generation === 2);

      // Get width from parent's attributes
      const parent = await ProductFamily.findOne({ name: gen2?.name }).lean();
      const width = parent?.attributes?.get ? parent.attributes.get('width') : parent?.attributes?.width;

      // Get length from product's attributes or parse from name
      const length = productDoc.attributes?.get ? productDoc.attributes.get('length') : productDoc.attributes?.length;

      if (width && length) {
        return `Borde Separador de ${width} cm x ${length} m`;
      }

      // Fallback: try to parse length from product name (e.g., "Rollo de 54 m" -> 54)
      if (width && productDoc.name) {
        const lengthMatch = productDoc.name.match(/(\d+)\s*m/i);
        if (lengthMatch) {
          return `Borde Separador de ${width} cm x ${lengthMatch[1]} m`;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error building custom product name:", error);
    return null;
  }
}

/**
 * Get product display name based on verbosity level
 * @param {object|string} product - Product document or ID
 * @param {string} verbosity - 'full', 'short', or 'mini'
 * @returns {string} - Display name at requested verbosity
 */
async function getProductDisplayName(product, verbosity = 'full') {
  try {
    let productDoc = product;

    // If product is an ID, fetch it
    if (typeof product === 'string') {
      productDoc = await ProductFamily.findById(product).lean();
    } else if (product.toObject) {
      productDoc = product.toObject();
    }

    if (!productDoc) return '';

    // Get full lineage (from root to leaf)
    const lineage = [];
    let current = productDoc;

    while (current) {
      lineage.unshift({
        name: current.name,
        generation: current.generation
      });

      if (current.parentId) {
        const parentId = typeof current.parentId === 'object' ? current.parentId._id || current.parentId : current.parentId;
        current = await ProductFamily.findById(parentId).lean();
      } else {
        break;
      }
    }

    // Get productInterest to find the right template
    const interest = await getProductInterest(productDoc);
    const template = NAMING_TEMPLATES[interest];

    if (!template) {
      // Fallback: just return the product name
      return productDoc.name;
    }

    // Get generations to include based on verbosity
    const gensToInclude = template[verbosity] || template.full;

    // Handle custom formatters
    if (gensToInclude === 'custom') {
      const customName = await buildCustomProductName(interest, lineage, productDoc);
      if (customName) return customName;
      // Fallback to short if custom fails
      const fallbackGens = template.short || template.full;
      if (Array.isArray(fallbackGens)) {
        return lineage.filter(item => fallbackGens.includes(item.generation)).map(item => item.name).join(' ');
      }
      return productDoc.name;
    }

    // Build name from lineage using only specified generations
    const nameParts = lineage
      .filter(item => gensToInclude.includes(item.generation))
      .map(item => item.name);

    return nameParts.join(' ');
  } catch (error) {
    console.error("Error getting product display name:", error);
    return product.name || '';
  }
}

/**
 * Determine appropriate verbosity based on conversation context and user message
 * @param {string} userMessage - The user's message
 * @param {object} convo - Conversation object
 * @param {object} options - Additional options
 * @returns {string} - 'full', 'short', or 'mini'
 */
function determineVerbosity(userMessage, convo, options = {}) {
  const { isListing = false } = options;
  const msg = (userMessage || '').toLowerCase();

  // Mini: when listing multiple products
  if (isListing) {
    return 'mini';
  }

  // Check if user already mentioned product details in their message
  const userMentionedDetails =
    // Mentioned shape
    /\b(triangular|rectangular|cuadrad[oa])\b/i.test(msg) ||
    // Mentioned dimensions (e.g., 5x5, 6x4, 3x3x3)
    /\d+\s*[xX×]\s*\d+/.test(msg) ||
    // Mentioned percentage
    /\d{2,3}\s*%/.test(msg) ||
    // Mentioned specific product type
    /\b(malla\s*sombra|borde|separador|confeccionada|rollo|ground\s*cover|gran\s*cover)\b/i.test(msg);

  if (userMentionedDetails) {
    // User set the context, use mini
    return 'mini';
  }

  // Check if same product family already discussed
  if (convo && convo.productInterest) {
    // Context already established in conversation, use short
    return 'short';
  }

  // First mention, no context - use full
  return 'full';
}

module.exports = {
  enrichProductWithContext,
  buildContextDescription,
  buildFullDescription,
  getProductLineage,
  formatProductForBot,
  getChildrenWithContext,
  getProductInterest,
  getProductDisplayName,
  determineVerbosity,
  NAMING_TEMPLATES
};
