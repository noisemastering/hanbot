// ai/utils/listFormatter.js
// Utility to safely format lists without dumping too many items

/**
 * Format a list of options for display
 * - 1-3 items: list them all
 * - 4+ items: show range (smallest to largest)
 *
 * @param {Array} items - Array of items to format
 * @param {Function} getName - Function to extract display name from item
 * @param {Function} getValue - Function to extract numeric value for sorting (optional)
 * @returns {string} Formatted string
 */
function formatOptionsList(items, getName, getValue = null) {
  if (!items || items.length === 0) {
    return "No hay opciones disponibles";
  }

  if (items.length <= 3) {
    // List all items
    const names = items.map(getName);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  }

  // More than 3: show range
  if (getValue) {
    // Sort by numeric value
    const sorted = [...items].sort((a, b) => getValue(a) - getValue(b));
    const smallest = getName(sorted[0]);
    const largest = getName(sorted[sorted.length - 1]);
    return `desde ${smallest} hasta ${largest}`;
  } else {
    // No sorting, just show first and last
    const smallest = getName(items[0]);
    const largest = getName(items[items.length - 1]);
    return `desde ${smallest} hasta ${largest}`;
  }
}

/**
 * Format percentage options (e.g., "35%, 50%, 70%")
 * @param {Array<number|string>} percentages - Array of percentages
 * @returns {string} Formatted string
 */
function formatPercentages(percentages) {
  const nums = percentages.map(p => parseInt(String(p).replace('%', ''))).sort((a, b) => a - b);

  if (nums.length <= 3) {
    return nums.map(p => `${p}%`).join(", ");
  }

  return `desde ${nums[0]}% hasta ${nums[nums.length - 1]}%`;
}

/**
 * Format product options with prices
 * @param {Array} products - Array of product objects
 * @param {string} nameField - Field name for product name (default: 'name')
 * @param {string} priceField - Field name for price (default: 'price')
 * @returns {string} Formatted string
 */
function formatProductOptions(products, nameField = 'name', priceField = 'price') {
  if (!products || products.length === 0) {
    return "No hay opciones disponibles";
  }

  if (products.length <= 3) {
    return products.map(p => {
      const name = p[nameField];
      const price = p[priceField] ? `$${p[priceField]}` : "consultar precio";
      return `• ${name} - ${price}`;
    }).join("\n");
  }

  // More than 3: find smallest and largest by price or by numeric value in name
  const sorted = [...products].sort((a, b) => {
    // Try to sort by price first
    if (a[priceField] && b[priceField]) {
      return a[priceField] - b[priceField];
    }
    // Otherwise try to extract number from name
    const aNum = parseInt(String(a[nameField]).match(/\d+/)?.[0] || 0);
    const bNum = parseInt(String(b[nameField]).match(/\d+/)?.[0] || 0);
    return aNum - bNum;
  });

  const smallest = sorted[0];
  const largest = sorted[sorted.length - 1];
  const smallPrice = smallest[priceField] ? `$${smallest[priceField]}` : "consultar";
  const largePrice = largest[priceField] ? `$${largest[priceField]}` : "consultar";

  return `desde ${smallest[nameField]} (${smallPrice}) hasta ${largest[nameField]} (${largePrice})`;
}

module.exports = {
  formatOptionsList,
  formatPercentages,
  formatProductOptions
};
