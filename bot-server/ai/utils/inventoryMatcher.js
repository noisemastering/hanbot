// ai/utils/inventoryMatcher.js
// Pre-loads all sellable product sizes and maps them to flows.
// When a user mentions dimensions, we check which flow owns that size
// instead of guessing with hardcoded regex.

const ProductFamily = require("../../models/ProductFamily");

let sizeIndex = null;
let sizeIndexExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Determine which flow a product belongs to by walking its ancestor chain.
 */
function classifyProduct(product, byId) {
  let current = product;
  const names = [product.name.toLowerCase()];
  let depth = 0;

  while (current.parentId && depth < 10) {
    const parent = byId[current.parentId.toString()];
    if (!parent) break;
    names.push(parent.name.toLowerCase());
    current = parent;
    depth++;
  }

  const fullPath = names.join(" ");

  // Order matters — check specific names before generic patterns
  if (/ground\s*cover|antimaleza/.test(fullPath)) return "groundcover";
  if (/monofilamento/.test(fullPath)) return "monofilamento";
  if (/borde|separador|cinta\s*pl[aá]stica/.test(fullPath)) return "borde_separador";
  if (/confeccionada|rectangular|triangular/.test(fullPath)) return "malla_sombra";

  // Fall back to size pattern
  const size = product.size || "";
  if (/\d+\s*x\s*100/i.test(size)) return "rollo";
  if (/\d+\s*x\s*\d+/i.test(size)) return "malla_sombra";

  if (/rollo|raschel/.test(fullPath)) return "rollo";

  return null;
}

/**
 * Parse a product's size string into normalized dimensions.
 */
function parseProductSize(sizeStr) {
  if (!sizeStr) return null;

  // Triangular: "5x5x5m"
  const triMatch = sizeStr.match(
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i
  );
  if (triMatch) {
    const s = parseFloat(triMatch[1]);
    return { type: "triangle", side: s };
  }

  // Rectangular: "6x4m", "4x100m"
  const rectMatch = sizeStr.match(
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i
  );
  if (rectMatch) {
    const d1 = parseFloat(rectMatch[1]);
    const d2 = parseFloat(rectMatch[2]);
    return { type: "rect", w: Math.min(d1, d2), h: Math.max(d1, d2) };
  }

  return null;
}

/**
 * Build the size index from all sellable products.
 * Returns { byDimension: { "4x6": [{ flow, name, price }], ... } }
 */
async function buildSizeIndex() {
  if (sizeIndex && Date.now() < sizeIndexExpiry) return sizeIndex;

  try {
    const products = await ProductFamily.find({ sellable: true, active: true })
      .select("name size price parentId")
      .lean();

    const allNodes = await ProductFamily.find({ active: true })
      .select("name parentId")
      .lean();

    const byId = {};
    allNodes.forEach((p) => (byId[p._id.toString()] = p));

    const index = {};

    for (const p of products) {
      const flow = classifyProduct(p, byId);
      if (!flow) continue;

      const parsed = parseProductSize(p.size);
      if (!parsed) continue;

      let key;
      if (parsed.type === "rect") {
        key = `${parsed.w}x${parsed.h}`;
      } else if (parsed.type === "triangle") {
        key = `${parsed.side}x${parsed.side}`;
      } else {
        continue;
      }

      if (!index[key]) index[key] = [];

      // Avoid duplicating the same flow for the same key
      if (!index[key].some((e) => e.flow === flow)) {
        index[key].push({
          flow,
          name: p.name,
          price: p.price,
          productId: p._id,
        });
      }
    }

    sizeIndex = index;
    sizeIndexExpiry = Date.now() + CACHE_TTL;

    const keyCount = Object.keys(index).length;
    console.log(`📦 Inventory size index built: ${keyCount} unique dimensions`);

    return index;
  } catch (err) {
    console.error("❌ Error building size index:", err.message);
    return sizeIndex || {};
  }
}

/**
 * Given user-provided dimensions, find which flow owns that size.
 * Returns the flow name or null if no match.
 *
 * @param {number} d1 - First dimension
 * @param {number} d2 - Second dimension
 * @returns {Promise<string|null>} Flow name
 */
async function matchDimensionToFlow(d1, d2) {
  const index = await buildSizeIndex();

  const w = Math.min(d1, d2);
  const h = Math.max(d1, d2);
  const key = `${w}x${h}`;

  const matches = index[key];
  if (matches && matches.length > 0) {
    // If only one flow claims this size, return it
    if (matches.length === 1) return matches[0].flow;

    // Multiple flows claim it — pick the most specific (prefer product flows over rollo)
    const priority = ["malla_sombra", "borde_separador", "groundcover", "monofilamento", "rollo"];
    for (const f of priority) {
      if (matches.some((m) => m.flow === f)) return f;
    }
    return matches[0].flow;
  }

  return null;
}

/**
 * Check if dimensions belong to the current flow.
 *
 * @param {number} d1 - First dimension
 * @param {number} d2 - Second dimension
 * @param {string} currentFlow - The flow the conversation is in
 * @returns {Promise<{belongsToCurrent: boolean, matchedFlow: string|null}>}
 */
async function checkDimensionOwnership(d1, d2, currentFlow) {
  const matchedFlow = await matchDimensionToFlow(d1, d2);

  return {
    belongsToCurrent: matchedFlow === currentFlow,
    matchedFlow,
  };
}

/**
 * Force cache refresh (call after product data changes).
 */
function invalidateCache() {
  sizeIndex = null;
  sizeIndexExpiry = 0;
}

module.exports = {
  matchDimensionToFlow,
  checkDimensionOwnership,
  buildSizeIndex,
  invalidateCache,
  classifyProduct,
};
