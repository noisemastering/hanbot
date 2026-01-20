// ai/utils/productMatcher.js
// Utility for matching products by name or aliases
// Supports alias inheritance from ancestors (root → children → grandchildren)

const ProductFamily = require("../../models/ProductFamily");

// Cache for ancestor lookups (cleared on server restart)
const ancestorCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Normalize text for matching (lowercase, remove accents, trim)
 * @param {string} text
 * @returns {string}
 */
function normalizeForMatch(text) {
  if (!text) return '';
  return text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .trim();
}

/**
 * Get all ancestors of a product (parent, grandparent, etc. up to root)
 * Results are cached for performance
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} - Array of ancestor documents from immediate parent to root
 */
async function getAncestors(productId) {
  if (!productId) return [];

  const cacheKey = productId.toString();
  const cached = ancestorCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.ancestors;
  }

  const ancestors = [];
  let currentId = productId;
  const maxDepth = 10; // Prevent infinite loops

  for (let i = 0; i < maxDepth; i++) {
    const product = await ProductFamily.findById(currentId).lean();
    if (!product || !product.parentId) break;

    const parent = await ProductFamily.findById(product.parentId).lean();
    if (!parent) break;

    ancestors.push(parent);
    currentId = parent._id;
  }

  ancestorCache.set(cacheKey, { ancestors, timestamp: Date.now() });
  return ancestors;
}

/**
 * Get all aliases for a product, including inherited from ancestors
 * @param {object} product - ProductFamily document
 * @returns {Promise<Array<string>>} - Combined array of all aliases
 */
async function getAllAliases(product) {
  const allAliases = new Set();

  // Add own aliases
  if (product.aliases && product.aliases.length > 0) {
    product.aliases.forEach(a => allAliases.add(normalizeForMatch(a)));
  }

  // Add ancestor aliases (inherited)
  const ancestors = await getAncestors(product._id);
  for (const ancestor of ancestors) {
    if (ancestor.aliases && ancestor.aliases.length > 0) {
      ancestor.aliases.forEach(a => allAliases.add(normalizeForMatch(a)));
    }
  }

  return Array.from(allAliases);
}

/**
 * Get the root family for a product
 * @param {object|string} product - ProductFamily document or ID
 * @returns {Promise<object|null>} - Root ProductFamily document
 */
async function getRootFamily(product) {
  const productDoc = typeof product === 'string'
    ? await ProductFamily.findById(product).lean()
    : product;

  if (!productDoc) return null;
  if (!productDoc.parentId) return productDoc; // Already root

  const ancestors = await getAncestors(productDoc._id);
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : productDoc;
}

/**
 * Check if a message mentions a product by name or alias (including inherited aliases)
 * @param {string} message - User's message
 * @param {object} product - ProductFamily document with name and aliases
 * @param {boolean} includeInherited - Whether to check inherited aliases from ancestors
 * @returns {Promise<boolean>}
 */
async function messageMatchesProduct(message, product, includeInherited = true) {
  const normalizedMsg = normalizeForMatch(message);

  // Check product name
  const normalizedName = normalizeForMatch(product.name);
  if (normalizedMsg.includes(normalizedName) || normalizedName.includes(normalizedMsg)) {
    return true;
  }

  // Get aliases (own + inherited if requested)
  const aliases = includeInherited
    ? await getAllAliases(product)
    : (product.aliases || []).map(normalizeForMatch);

  // Check aliases
  for (const alias of aliases) {
    // Use word boundary-like matching for aliases
    const aliasRegex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (aliasRegex.test(normalizedMsg)) {
      return true;
    }
  }

  return false;
}

/**
 * Find a product family by name or alias
 * @param {string} searchTerm - Name or alias to search for
 * @param {object} options - { rootOnly: boolean, activeOnly: boolean }
 * @returns {Promise<object|null>} - ProductFamily document or null
 */
async function findProductByNameOrAlias(searchTerm, options = {}) {
  const { rootOnly = false, activeOnly = true } = options;
  const normalizedSearch = normalizeForMatch(searchTerm);

  const query = {};
  if (rootOnly) query.parentId = null;
  if (activeOnly) query.active = true;

  // Try exact name match first
  let product = await ProductFamily.findOne({
    ...query,
    name: { $regex: new RegExp(searchTerm, 'i') }
  });

  if (product) return product;

  // Try alias match
  product = await ProductFamily.findOne({
    ...query,
    aliases: { $regex: new RegExp(`^${normalizedSearch}$`, 'i') }
  });

  if (product) return product;

  // Try partial alias match
  product = await ProductFamily.findOne({
    ...query,
    aliases: { $regex: new RegExp(normalizedSearch, 'i') }
  });

  return product;
}

/**
 * Detect which product family a message is asking about
 * Checks root families and their aliases
 * @param {string} message - User's message
 * @returns {Promise<object|null>} - { product: ProductFamily, matchedOn: 'name'|'alias', matchedTerm: string }
 */
async function detectProductFromMessage(message) {
  const normalizedMsg = normalizeForMatch(message);

  // Get all active root families with their aliases
  const rootFamilies = await ProductFamily.find({
    parentId: null,
    active: true
  }).lean();

  for (const family of rootFamilies) {
    // Check name
    const normalizedName = normalizeForMatch(family.name);
    if (normalizedMsg.includes(normalizedName)) {
      return { product: family, matchedOn: 'name', matchedTerm: family.name };
    }

    // Check aliases
    if (family.aliases && family.aliases.length > 0) {
      for (const alias of family.aliases) {
        const normalizedAlias = normalizeForMatch(alias);
        const aliasRegex = new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (aliasRegex.test(normalizedMsg)) {
          return { product: family, matchedOn: 'alias', matchedTerm: alias };
        }
      }
    }
  }

  return null;
}

/**
 * Check if message is explicitly asking for a specific product (not just mentioning it contextually)
 * Uses patterns like "quiero", "necesito", "busco", "precio de", etc.
 * @param {string} message - User's message
 * @param {string} productNameOrAlias - Product name or alias to check for
 * @returns {boolean}
 */
function isExplicitProductRequest(message, productNameOrAlias) {
  const normalized = normalizeForMatch(message);
  const normalizedProduct = normalizeForMatch(productNameOrAlias);

  // Patterns that indicate explicit product request
  const requestPatterns = [
    new RegExp(`\\b(quiero|necesito|busco|ocupo|me\\s+interesa)\\s+.*${normalizedProduct}`, 'i'),
    new RegExp(`\\b(precio|costo|cuanto)\\s+(de|del|cuesta)\\s+.*${normalizedProduct}`, 'i'),
    new RegExp(`\\b${normalizedProduct}\\s+(precio|costo|cuanto)`, 'i'),
    new RegExp(`\\b(tienen|manejan|venden)\\s+.*${normalizedProduct}`, 'i'),
    new RegExp(`^\\s*${normalizedProduct}\\s*$`, 'i'), // Just the product name alone
  ];

  return requestPatterns.some(pattern => pattern.test(normalized));
}

/**
 * Check if a keyword mention is contextual (explaining why) vs a product request
 * @param {string} message - User's message
 * @param {string} keyword - The keyword that was detected (e.g., "maleza")
 * @returns {boolean} - true if contextual, false if product request
 */
function isContextualMention(message, keyword) {
  const normalized = normalizeForMatch(message);
  const normalizedKeyword = normalizeForMatch(keyword);

  // Patterns that indicate contextual mention (explaining WHY, not WHAT)
  const contextualPatterns = [
    new RegExp(`para\\s+(que\\s+)?(no\\s+)?(salga|crezca|haya|tenga)\\s+.*${normalizedKeyword}`, 'i'),
    new RegExp(`(evitar|prevenir|controlar|bloquear)\\s+.*${normalizedKeyword}`, 'i'),
    new RegExp(`(contra|por)\\s+(la\\s+)?${normalizedKeyword}`, 'i'),
    new RegExp(`${normalizedKeyword}\\s+(no\\s+)?(salga|crezca|pase)`, 'i'),
  ];

  return contextualPatterns.some(pattern => pattern.test(normalized));
}

/**
 * Clear the ancestor cache (useful after product updates)
 */
function clearCache() {
  ancestorCache.clear();
  console.log("🗑️ Product matcher cache cleared");
}

/**
 * Find all products (including children) that match a message via inherited aliases
 * Useful for finding specific variants when user mentions a product family alias
 * @param {string} message - User's message
 * @param {object} options - { sellableOnly: boolean, activeOnly: boolean }
 * @returns {Promise<Array>} - Array of matching ProductFamily documents
 */
async function findAllMatchingProducts(message, options = {}) {
  const { sellableOnly = false, activeOnly = true } = options;

  // First, detect which root family the message refers to
  const detected = await detectProductFromMessage(message);
  if (!detected) return [];

  // Build query for descendants of that family
  const query = { active: activeOnly };
  if (sellableOnly) query.sellable = true;

  // Get all products and filter to those in this family tree
  const allProducts = await ProductFamily.find(query).lean();

  const matchingProducts = [];
  for (const product of allProducts) {
    // Check if this product belongs to the detected family
    const root = await getRootFamily(product);
    if (root && root._id.toString() === detected.product._id.toString()) {
      matchingProducts.push(product);
    }
  }

  return matchingProducts;
}

module.exports = {
  normalizeForMatch,
  getAncestors,
  getAllAliases,
  getRootFamily,
  messageMatchesProduct,
  findProductByNameOrAlias,
  detectProductFromMessage,
  findAllMatchingProducts,
  isExplicitProductRequest,
  isContextualMention,
  clearCache
};
