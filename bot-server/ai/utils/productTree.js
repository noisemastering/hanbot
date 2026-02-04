// ai/utils/productTree.js
// Manages Product of Interest (POI) with tree hierarchy awareness
// Ensures variants are only siblings, allows navigation UP the tree

const ProductFamily = require("../../models/ProductFamily");
const { updateConversation } = require("../../conversationManager");
const User = require("../../models/User");

/**
 * Sync POI to User model for sales correlation
 * @param {string} psid - User's PSID
 * @param {object} poiData - POI data to sync
 */
async function syncPOIToUser(psid, poiData) {
  try {
    const user = await User.findOne({
      $or: [
        { psid: psid },
        { unifiedId: psid },
        { unifiedId: `fb:${psid}` }
      ]
    });

    if (!user) return;

    const poiUpdate = { 'poi.updatedAt': new Date() };
    if (poiData.productInterest) poiUpdate['poi.productInterest'] = poiData.productInterest;
    if (poiData.familyId) poiUpdate['poi.familyId'] = poiData.familyId;
    if (poiData.familyName) poiUpdate['poi.familyName'] = poiData.familyName;
    if (poiData.rootId) poiUpdate['poi.rootId'] = poiData.rootId;
    if (poiData.rootName) poiUpdate['poi.rootName'] = poiData.rootName;

    await User.updateOne({ _id: user._id }, { $set: poiUpdate });
    console.log(`📊 Synced POI to User: ${poiData.rootName || poiData.productInterest}`);
  } catch (error) {
    console.error("Error syncing POI to User:", error.message);
  }
}

/**
 * Get a product node with its full ancestry chain
 * @param {string} productId - ProductFamily _id
 * @returns {object|null} Product with ancestors array
 */
async function getProductWithAncestry(productId) {
  if (!productId) return null;

  try {
    const product = await ProductFamily.findById(productId).lean();
    if (!product) return null;

    // Build ancestry chain (from root to current)
    const ancestors = [];
    let current = product;

    while (current.parentId) {
      const parent = await ProductFamily.findById(current.parentId).lean();
      if (!parent) break;
      ancestors.unshift(parent); // Add to front (root first)
      current = parent;
    }

    return {
      ...product,
      ancestors,
      rootId: ancestors.length > 0 ? ancestors[0]._id : product._id,
      rootName: ancestors.length > 0 ? ancestors[0].name : product.name,
      depth: ancestors.length + 1
    };
  } catch (error) {
    console.error("❌ Error getting product ancestry:", error);
    return null;
  }
}

/**
 * Get siblings of a product (same parent, excluding self)
 * @param {string} productId - ProductFamily _id
 * @returns {array} Sibling products
 */
async function getSiblings(productId) {
  if (!productId) return [];

  try {
    const product = await ProductFamily.findById(productId).lean();
    if (!product) return [];

    // Get all products with same parent (excluding self)
    const siblings = await ProductFamily.find({
      parentId: product.parentId,
      _id: { $ne: productId },
      active: true
    }).lean();

    return siblings;
  } catch (error) {
    console.error("❌ Error getting siblings:", error);
    return [];
  }
}

/**
 * Get children of a product
 * @param {string} productId - ProductFamily _id
 * @returns {array} Child products
 */
async function getChildren(productId) {
  if (!productId) return [];

  try {
    const children = await ProductFamily.find({
      parentId: productId,
      active: true
    }).lean();

    return children;
  } catch (error) {
    console.error("❌ Error getting children:", error);
    return [];
  }
}

/**
 * Navigate UP the tree to find a different branch
 * Used when user asks for a different attribute (e.g., different shade %)
 * @param {string} currentProductId - Current POI
 * @param {string} attributeType - What they're asking about (e.g., "percentage", "type")
 * @param {string} attributeValue - What they want (e.g., "80%", "rollo")
 * @returns {object|null} New product node or null if not available
 */
async function navigateForAttribute(currentProductId, attributeType, attributeValue) {
  if (!currentProductId) return null;

  try {
    const productWithAncestry = await getProductWithAncestry(currentProductId);
    if (!productWithAncestry) return null;

    // For percentage changes, look at siblings of the percentage level ancestor
    if (attributeType === "percentage") {
      // Find the ancestor that represents percentage (usually generation 2)
      const percentageAncestor = productWithAncestry.ancestors.find(a =>
        /\d+\s*%/.test(a.name)
      );

      if (percentageAncestor) {
        // Get siblings of percentage ancestor
        const percentageSiblings = await getSiblings(percentageAncestor._id);

        // Find the one matching requested percentage
        const target = percentageSiblings.find(s =>
          s.name.toLowerCase().includes(attributeValue.toLowerCase())
        );

        if (target) {
          console.log(`🔄 Navigated UP to different percentage: ${target.name}`);
          return target;
        }
      }
    }

    // For type changes (rollo vs confeccionada), navigate similarly
    if (attributeType === "type") {
      // Find current type ancestor
      const typePatterns = ["rollo", "confeccionada", "triangular", "rectangular"];
      const typeAncestor = productWithAncestry.ancestors.find(a =>
        typePatterns.some(p => a.name.toLowerCase().includes(p))
      );

      if (typeAncestor) {
        const typeSiblings = await getSiblings(typeAncestor._id);
        const target = typeSiblings.find(s =>
          s.name.toLowerCase().includes(attributeValue.toLowerCase())
        );

        if (target) {
          console.log(`🔄 Navigated UP to different type: ${target.name}`);
          return target;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("❌ Error navigating for attribute:", error);
    return null;
  }
}

/**
 * Parse dimensions from a query string (e.g., "4x5", "5x4m", "4 x 5", "seis por cuatro")
 * Returns normalized { w, h } with smaller dimension first
 */
function parseDimensionsFromQuery(query) {
  if (!query) return null;

  // Convert Spanish numbers first
  const { convertSpanishNumbers } = require('./spanishNumbers');
  const converted = convertSpanishNumbers(query);

  // Try various patterns
  let match = converted.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    match = converted.match(/(\d+(?:\.\d+)?)\s*por\s*(\d+(?:\.\d+)?)/);
  }
  if (!match) return null;

  const d1 = parseFloat(match[1]);
  const d2 = parseFloat(match[2]);
  return {
    w: Math.min(d1, d2),
    h: Math.max(d1, d2)
  };
}

/**
 * Check if two dimension strings match (regardless of order)
 * "4x5" matches "5x4m", "5 x 4", etc.
 */
function dimensionsMatch(query, sizeStr) {
  const queryDims = parseDimensionsFromQuery(query);
  const sizeDims = parseDimensionsFromQuery(sizeStr);

  if (!queryDims || !sizeDims) return false;

  return queryDims.w === sizeDims.w && queryDims.h === sizeDims.h;
}

/**
 * Check if a variant exists within the current POI tree
 * @param {string} poiId - Current Product of Interest
 * @param {string} variantQuery - What the user is asking for
 * @returns {object} { exists: boolean, product: object|null, reason: string }
 */
async function checkVariantExists(poiId, variantQuery) {
  if (!poiId) {
    return { exists: false, product: null, reason: "no_poi" };
  }

  try {
    const poi = await getProductWithAncestry(poiId);
    if (!poi) {
      return { exists: false, product: null, reason: "poi_not_found" };
    }

    // Get all descendants of root
    const descendants = await getAllDescendants(poi.rootId);

    // Search for matching variant
    const queryLower = variantQuery.toLowerCase();

    // First try dimension matching (handles 4x5 vs 5x4m)
    let match = descendants.find(d =>
      d.size && dimensionsMatch(variantQuery, d.size)
    );

    // If no dimension match, try text matching
    if (!match) {
      match = descendants.find(d =>
        d.name.toLowerCase().includes(queryLower) ||
        (d.aliases && d.aliases.some(a => a.includes(queryLower))) ||
        (d.size && d.size.toLowerCase().includes(queryLower))
      );
    }

    if (match) {
      return {
        exists: true,
        product: match,
        reason: "found"
      };
    }

    return {
      exists: false,
      product: null,
      reason: "not_in_tree",
      rootName: poi.rootName
    };
  } catch (error) {
    console.error("❌ Error checking variant:", error);
    return { exists: false, product: null, reason: "error" };
  }
}

/**
 * Get all descendants of a product (recursive)
 * @param {string} productId - Root to start from
 * @returns {array} All descendants
 */
async function getAllDescendants(productId) {
  if (!productId) return [];

  try {
    const descendants = [];
    const toProcess = [productId];

    while (toProcess.length > 0) {
      const currentId = toProcess.pop();
      // Use $ne: false to include active: true AND active: undefined
      const children = await ProductFamily.find({
        parentId: currentId,
        active: { $ne: false }
      }).lean();

      for (const child of children) {
        descendants.push(child);
        toProcess.push(child._id);
      }
    }

    return descendants;
  } catch (error) {
    console.error("❌ Error getting descendants:", error);
    return [];
  }
}

/**
 * Lock POI to conversation and return context info
 * @param {string} psid - User PSID
 * @param {string} productId - ProductFamily _id to lock
 * @returns {object} POI context with hierarchy info
 */
async function lockPOI(psid, productId) {
  if (!productId) return null;

  try {
    const product = await getProductWithAncestry(productId);
    if (!product) return null;

    // Update conversation with POI locked
    await updateConversation(psid, {
      productInterest: product._id.toString(),
      productFamilyId: product._id.toString(),
      poiLocked: true,
      poiRootId: product.rootId.toString(),
      poiRootName: product.rootName
    });

    console.log(`🔒 POI locked for ${psid}: ${product.name} (root: ${product.rootName})`);

    // Sync POI to User model for sales correlation (non-blocking)
    syncPOIToUser(psid, {
      productInterest: product.rootName?.toLowerCase().replace(/\s+/g, '_'),
      familyId: product._id,
      familyName: product.name,
      rootId: product.rootId,
      rootName: product.rootName
    }).catch(err => console.error("POI sync error:", err.message));

    return {
      id: product._id,
      name: product.name,
      rootId: product.rootId,
      rootName: product.rootName,
      depth: product.depth,
      sellable: product.sellable,
      ancestors: product.ancestors
    };
  } catch (error) {
    console.error("❌ Error locking POI:", error);
    return null;
  }
}

/**
 * Get available options at the current level (siblings + children)
 * Used when user needs to choose between variants
 * @param {string} productId - Current position in tree
 * @returns {object} { siblings: [], children: [], current: {} }
 */
async function getAvailableOptions(productId) {
  if (!productId) return { siblings: [], children: [], current: null };

  try {
    const current = await ProductFamily.findById(productId).lean();
    if (!current) return { siblings: [], children: [], current: null };

    const [siblings, children] = await Promise.all([
      getSiblings(productId),
      getChildren(productId)
    ]);

    return {
      current,
      siblings: siblings.filter(s => s.available !== false),
      children: children.filter(c => c.available !== false)
    };
  } catch (error) {
    console.error("❌ Error getting available options:", error);
    return { siblings: [], children: [], current: null };
  }
}

/**
 * Find product by name/alias within a specific tree
 * @param {string} rootId - Root of tree to search
 * @param {string} query - Name or alias to find
 * @returns {object|null} Matching product or null
 */
async function findInTree(rootId, query) {
  if (!rootId || !query) return null;

  try {
    const queryLower = query.toLowerCase().trim();
    const descendants = await getAllDescendants(rootId);

    // Include root itself
    const root = await ProductFamily.findById(rootId).lean();
    if (root) descendants.unshift(root);

    // Search by exact name match first
    let match = descendants.find(d =>
      d.name.toLowerCase() === queryLower
    );

    // Then by partial name match
    if (!match) {
      match = descendants.find(d =>
        d.name.toLowerCase().includes(queryLower)
      );
    }

    // Then by aliases
    if (!match) {
      match = descendants.find(d =>
        d.aliases && d.aliases.some(a => a.includes(queryLower))
      );
    }

    // Then by size
    if (!match) {
      match = descendants.find(d =>
        d.size && d.size.toLowerCase().includes(queryLower)
      );
    }

    return match || null;
  } catch (error) {
    console.error("❌ Error finding in tree:", error);
    return null;
  }
}

/**
 * Generate "not available" response with helpful context
 * @param {string} variantQuery - What user asked for
 * @param {string} rootName - Name of the product tree
 * @returns {string} Friendly response
 */
function getNotAvailableResponse(variantQuery, rootName) {
  const responses = [
    `Lo siento, no tenemos "${variantQuery}" disponible en ${rootName}. ¿Te gustaría ver las opciones que sí tenemos?`,
    `Esa opción no está disponible en nuestra línea de ${rootName}. ¿Quieres que te muestre lo que sí manejamos?`,
    `No manejamos "${variantQuery}" en ${rootName}. ¿Te muestro las alternativas disponibles?`
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

module.exports = {
  getProductWithAncestry,
  getSiblings,
  getChildren,
  navigateForAttribute,
  checkVariantExists,
  getAllDescendants,
  lockPOI,
  getAvailableOptions,
  findInTree,
  getNotAvailableResponse
};
