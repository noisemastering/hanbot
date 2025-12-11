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
  parts.push(`**${product.name}**`);

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
  response = `**${enriched.name}**`;

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

module.exports = {
  enrichProductWithContext,
  buildContextDescription,
  buildFullDescription,
  getProductLineage,
  formatProductForBot,
  getChildrenWithContext
};
