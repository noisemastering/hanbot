// ai/utils/productMatcher.js
// Utility for matching products by name or aliases

const ProductFamily = require("../../models/ProductFamily");

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
 * Check if a message mentions a product by name or alias
 * @param {string} message - User's message
 * @param {object} product - ProductFamily document with name and aliases
 * @returns {boolean}
 */
function messageMatchesProduct(message, product) {
  const normalizedMsg = normalizeForMatch(message);

  // Check product name
  const normalizedName = normalizeForMatch(product.name);
  if (normalizedMsg.includes(normalizedName) || normalizedName.includes(normalizedMsg)) {
    return true;
  }

  // Check aliases
  if (product.aliases && product.aliases.length > 0) {
    for (const alias of product.aliases) {
      const normalizedAlias = normalizeForMatch(alias);
      // Use word boundary-like matching for aliases
      const aliasRegex = new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (aliasRegex.test(normalizedMsg)) {
        return true;
      }
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

module.exports = {
  normalizeForMatch,
  messageMatchesProduct,
  findProductByNameOrAlias,
  detectProductFromMessage,
  isExplicitProductRequest,
  isContextualMention
};
