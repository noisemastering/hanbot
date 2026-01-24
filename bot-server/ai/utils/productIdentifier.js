// ai/utils/productIdentifier.js
// Identifies products from customer messages and maps to correct hierarchy

const { updateConversation } = require("../../conversationManager");

/**
 * Product definitions with keywords and patterns
 * Order matters - more specific products should come first
 */
const PRODUCTS = [
  {
    key: "borde_separador",
    familyId: "68f6c372bfaca6a28884afd9",
    name: "Borde Separador",
    displayName: "Borde Separador",
    // Keywords that identify this product
    keywords: ["borde", "separador", "jardin", "jardín", "jardinería", "jardineria", "orilla", "delimitar"],
    // Patterns for more complex matching
    patterns: [
      /borde\s*(para\s*)?(el\s*)?(jard[ií]n|pasto|c[eé]sped)/i,
      /separador\s*(de\s*)?(jard[ií]n|pasto|pl[aá]stico)/i,
      /para\s*(delimitar|separar)\s*(el\s*)?(jard[ií]n|pasto|[aá]reas?)/i
    ]
  },
  {
    key: "cinta_rigida",
    familyId: "694054f8f1a5f22bbbfd56e1",
    name: "Cinta Rígida",
    displayName: "Cinta Rígida",
    keywords: ["cinta rigida", "cinta rígida", "rigida", "rígida"],
    patterns: [
      /cinta\s*r[ií]gida/i
    ]
  },
  {
    key: "malla_antiafido",
    familyId: "6939c5efb7f2dfa6d9161f9e",
    name: "Malla Antiáfido",
    displayName: "Malla Antiáfido",
    keywords: ["antiafido", "antiáfido", "anti afido", "anti áfido", "afido", "áfido", "pulgon", "pulgón"],
    patterns: [
      /malla\s*(anti\s*)?[aá]fidos?/i,
      /anti\s*[aá]fidos?/i,
      /(contra|para)\s*(los\s*)?([aá]fidos?|pulg[oó]n)/i
    ]
  },
  {
    key: "malla_antigranizo",
    familyId: "6939c6a6b7f2dfa6d91620c5",
    name: "Malla Anti Granizo",
    displayName: "Malla Antigranizo",
    keywords: ["antigranizo", "anti granizo", "granizo"],
    patterns: [
      /malla\s*(anti\s*)?granizo/i,
      /anti\s*granizo/i,
      /(contra|para)\s*(el\s*)?granizo/i,
      /protecci[oó]n\s*(contra\s*)?(el\s*)?granizo/i
    ]
  },
  {
    key: "malla_sombra",
    familyId: "68f6c372bfaca6a28884afd7",
    name: "Malla Sombra Raschel",
    displayName: "Malla Sombra",
    // More general - should be checked after more specific products
    keywords: ["malla sombra", "malla", "sombra", "sombreo", "raschel", "confeccionada", "media sombra"],
    patterns: [
      /malla\s*(de\s*)?(sombra|sombreo)/i,
      /malla\s*confeccionada/i,
      /media\s*sombra/i,
      /para\s*(dar\s*)?sombra/i,
      /\d+\s*%\s*(de\s*)?sombra/i,  // "80% sombra"
      /sombra\s*(de\s*)?\d+\s*%/i   // "sombra 80%"
    ]
  },
  {
    key: "cinta_plastica",
    familyId: "69405453f1a5f22bbbfd55f1",
    name: "Cinta Plástica",
    displayName: "Cinta Plástica",
    // Most general in this category - checked last
    keywords: ["cinta plastica", "cinta plástica"],
    patterns: [
      /cinta\s*pl[aá]stica/i
    ]
  }
];

/**
 * Identify product from customer message
 * @param {string} message - Customer message
 * @returns {object|null} - Product info or null if not identified
 */
function identifyProduct(message) {
  if (!message) return null;

  const msg = message.toLowerCase().trim();

  // Check each product in order (specific to general)
  for (const product of PRODUCTS) {
    // Check patterns first (more specific)
    for (const pattern of product.patterns || []) {
      if (pattern.test(msg)) {
        console.log(`🎯 Product identified by pattern: ${product.key}`);
        return {
          key: product.key,
          familyId: product.familyId,
          name: product.name,
          displayName: product.displayName
        };
      }
    }

    // Check keywords
    for (const keyword of product.keywords || []) {
      if (msg.includes(keyword)) {
        console.log(`🎯 Product identified by keyword "${keyword}": ${product.key}`);
        return {
          key: product.key,
          familyId: product.familyId,
          name: product.name,
          displayName: product.displayName
        };
      }
    }
  }

  return null;
}

/**
 * Identify product and update conversation if found
 * @param {string} message - Customer message
 * @param {string} psid - User PSID
 * @param {object} convo - Current conversation
 * @returns {object|null} - Product info or null
 */
async function identifyAndSetProduct(message, psid, convo) {
  // Don't override existing productInterest unless message explicitly mentions different product
  const existingInterest = convo?.productInterest;

  const identified = identifyProduct(message);

  if (identified) {
    // Only update if no existing interest OR they're explicitly asking about different product
    if (!existingInterest || identified.key !== existingInterest) {
      await updateConversation(psid, {
        productInterest: identified.key,
        productFamilyId: identified.familyId
      });
      console.log(`✅ productInterest set to: ${identified.key}`);
    }
    return identified;
  }

  // Return existing interest as identified product if we have one
  if (existingInterest) {
    const existing = PRODUCTS.find(p => p.key === existingInterest);
    if (existing) {
      return {
        key: existing.key,
        familyId: existing.familyId,
        name: existing.name,
        displayName: existing.displayName
      };
    }
  }

  return null;
}

/**
 * Get product by key
 * @param {string} key - Product key (e.g., "malla_sombra")
 * @returns {object|null}
 */
function getProductByKey(key) {
  return PRODUCTS.find(p => p.key === key) || null;
}

/**
 * Get all product display names for cold start
 * @returns {string[]}
 */
function getProductDisplayNames() {
  // Return unique display names (skip cinta_plastica as it's covered by children)
  return PRODUCTS
    .filter(p => p.key !== 'cinta_plastica')
    .map(p => p.displayName);
}

/**
 * Get formatted product list for cold start message
 * @returns {string}
 */
function getColdStartProductList() {
  const names = getProductDisplayNames();
  return names.map(n => `• ${n}`).join('\n');
}

module.exports = {
  identifyProduct,
  identifyAndSetProduct,
  getProductByKey,
  getProductDisplayNames,
  getColdStartProductList,
  PRODUCTS
};
