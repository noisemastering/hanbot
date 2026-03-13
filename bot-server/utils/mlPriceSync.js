// utils/mlPriceSync.js
// Utility for syncing prices from Mercado Libre to ProductFamily

const axios = require("axios");
const ProductFamily = require("../models/ProductFamily");
const { getValidMLToken } = require("../mlTokenManager");

/**
 * Extract ML item ID from a URL
 * @param {string} url - ML product URL
 * @returns {string|null} - ML item ID (e.g., "MLM1234567890") or null
 */
function extractMLItemId(url) {
  if (!url) return null;

  // Priority 1: Check for wid= parameter (actual item ID in catalog URLs)
  // Example: /p/MLM28444978?...&wid=MLM2705920684
  const widMatch = url.match(/wid=MLM[-]?(\d+)/);
  if (widMatch) {
    return `MLM${widMatch[1]}`;
  }

  // Priority 2: Check for articulo.mercadolibre URL with MLM-XXXXX format
  // Example: https://articulo.mercadolibre.com.mx/MLM-1234567890
  const articuloMatch = url.match(/articulo\.mercadolibre[^/]*\/MLM[-]?(\d+)/);
  if (articuloMatch) {
    return `MLM${articuloMatch[1]}`;
  }

  // Priority 3: Standard MLM followed by digits (may catch catalog IDs as fallback)
  // Only use if it looks like a proper item ID (10+ digits)
  const standardMatch = url.match(/MLM[-]?(\d{9,})/);
  if (standardMatch) {
    return `MLM${standardMatch[1]}`;
  }

  return null;
}

/**
 * Extract ML catalog product ID from a URL (MLMU format)
 * These require the /products/{id}/items endpoint to resolve to an item ID
 * @param {string} url - ML product URL
 * @returns {string|null} - Catalog product ID (e.g., "MLMU724578403") or null
 */
function extractMLCatalogId(url) {
  if (!url) return null;
  const match = url.match(/MLMU(\d+)/);
  return match ? `MLMU${match[1]}` : null;
}

/**
 * Resolve a catalog product ID (MLMU) to an item ID (MLM) via the ML API
 * @param {string} catalogId - Catalog product ID (e.g., "MLMU724578403")
 * @param {string} token - ML API token
 * @returns {string|null} - Item ID (e.g., "MLM923085679") or null
 */
async function resolveCatalogToItemId(catalogId, token) {
  try {
    // The catalog product ID maps to a ML product ID: MLM + digits from MLMU
    const productId = catalogId.replace("MLMU", "MLM");
    const response = await axios.get(
      `https://api.mercadolibre.com/products/${productId}/items`,
      {
        params: { status: "active" },
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const items = response.data?.results || response.data;
    if (Array.isArray(items) && items.length > 0) {
      const itemId = items[0].id || items[0];
      console.log(`🔗 Resolved catalog ${catalogId} → ${itemId}`);
      return typeof itemId === "string" ? itemId : null;
    }
    return null;
  } catch (err) {
    console.error(`⚠️ Error resolving catalog ${catalogId}:`, err.message);
    return null;
  }
}

/**
 * Fetch current prices for multiple ML items (including promotions)
 * @param {string[]} itemIds - Array of ML item IDs
 * @param {string} token - ML API token
 * @returns {Object} - Map of itemId -> { price, original_price }
 */
async function fetchMLPrices(itemIds, token) {
  const prices = {};

  // ML multiget supports max 20 items per request
  for (let i = 0; i < itemIds.length; i += 20) {
    const batch = itemIds.slice(i, i + 20);
    try {
      const response = await axios.get("https://api.mercadolibre.com/items", {
        params: { ids: batch.join(",") },
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      });

      for (const item of response.data) {
        if (item.code === 200 && item.body) {
          prices[item.body.id] = {
            price: item.body.price,
            original_price: item.body.original_price,
            status: item.body.status
          };
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching ML prices batch:`, err.message);
    }
  }

  // Now check for promotional prices via /prices endpoint
  for (const itemId of itemIds) {
    if (!prices[itemId]) continue;

    try {
      const pricesResponse = await axios.get(
        `https://api.mercadolibre.com/items/${itemId}/prices`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Cache-Control": "no-cache"
          }
        }
      );

      const pricesList = pricesResponse.data?.prices || [];
      const now = new Date();

      // Find active promotion price
      const activePromo = pricesList.find(p => {
        if (p.type !== "promotion") return false;
        const startTime = p.conditions?.start_time ? new Date(p.conditions.start_time) : null;
        const endTime = p.conditions?.end_time ? new Date(p.conditions.end_time) : null;

        // Check if promotion is currently active
        const isStarted = !startTime || now >= startTime;
        const isNotEnded = !endTime || now <= endTime;

        return isStarted && isNotEnded;
      });

      if (activePromo) {
        console.log(`💰 Found active promotion for ${itemId}: $${activePromo.amount} (was $${activePromo.regular_amount})`);
        prices[itemId].price = activePromo.amount;
        prices[itemId].original_price = activePromo.regular_amount;
      }
    } catch (err) {
      // Prices endpoint might not be available for all items, ignore errors
      if (err.response?.status !== 404) {
        console.error(`⚠️ Error fetching prices for ${itemId}:`, err.message);
      }
    }
  }

  return prices;
}

/**
 * Sync ML prices for all products with ML links
 * @param {Object} options - Options
 * @param {string[]} options.productIds - Optional: Only sync these product IDs
 * @returns {Object} - Sync results
 */
async function syncMLPrices({ productIds = null } = {}) {
  console.log("🔄 Starting ML price sync...");

  const token = await getValidMLToken();

  // Find products with ML links (sync all products, not just sellable)
  const query = {
    "onlineStoreLinks.url": { $regex: "mercadolibre" }
  };

  if (productIds && productIds.length > 0) {
    query._id = { $in: productIds };
  }

  const products = await ProductFamily.find(query).select("_id name price onlineStoreLinks");
  console.log(`📦 Found ${products.length} products with ML links`);

  if (products.length === 0) {
    return { synced: 0, errors: 0, products: [] };
  }

  // Extract ML item IDs (resolve catalog URLs if needed)
  const productMLMap = {}; // mlItemId -> productId
  const mlItemIds = [];
  const catalogToResolve = []; // { catalogId, productId }

  for (const product of products) {
    const mlLink = product.onlineStoreLinks?.find(l => l.url?.includes("mercadolibre"));
    const mlItemId = extractMLItemId(mlLink?.url);
    if (mlItemId) {
      productMLMap[mlItemId] = product._id;
      mlItemIds.push(mlItemId);
    } else {
      // Try catalog URL (MLMU format)
      const catalogId = extractMLCatalogId(mlLink?.url);
      if (catalogId) {
        catalogToResolve.push({ catalogId, productId: product._id });
      }
    }
  }

  // Resolve catalog IDs to item IDs
  if (catalogToResolve.length > 0) {
    console.log(`🔗 Resolving ${catalogToResolve.length} catalog URL(s)...`);
    for (const { catalogId, productId } of catalogToResolve) {
      const resolvedId = await resolveCatalogToItemId(catalogId, token);
      if (resolvedId) {
        productMLMap[resolvedId] = productId;
        mlItemIds.push(resolvedId);
      }
    }
  }

  console.log(`🔍 Fetching prices for ${mlItemIds.length} ML items...`);

  // Fetch ML prices
  const mlPrices = await fetchMLPrices(mlItemIds, token);

  // Update products
  const results = {
    synced: 0,
    errors: 0,
    skipped: 0,
    products: []
  };

  const now = new Date();

  for (const mlItemId of mlItemIds) {
    const productId = productMLMap[mlItemId];
    const mlData = mlPrices[mlItemId];

    if (!mlData) {
      results.skipped++;
      continue;
    }

    try {
      const updateData = {
        mlPrice: mlData.price,
        mlPriceUpdatedAt: now,
        price: mlData.price  // Always sync price from ML
      };

      await ProductFamily.findByIdAndUpdate(productId, updateData);

      results.synced++;
      results.products.push({
        productId,
        mlItemId,
        mlPrice: mlData.price,
        originalPrice: mlData.original_price
      });
    } catch (err) {
      console.error(`❌ Error updating product ${productId}:`, err.message);
      results.errors++;
    }
  }

  console.log(`✅ ML price sync complete: ${results.synced} synced, ${results.errors} errors, ${results.skipped} skipped`);

  return results;
}

/**
 * Sync ML price for a single product
 * @param {string} productId - Product ID to sync
 * @returns {Object|null} - Sync result or null if failed
 */
async function syncSingleProductMLPrice(productId) {
  const token = await getValidMLToken();

  const product = await ProductFamily.findById(productId).select("name price onlineStoreLinks");
  if (!product) {
    return null;
  }

  const mlLink = product.onlineStoreLinks?.find(l => l.url?.includes("mercadolibre"));
  let mlItemId = extractMLItemId(mlLink?.url);

  // Try catalog URL resolution if direct extraction fails
  if (!mlItemId) {
    const catalogId = extractMLCatalogId(mlLink?.url);
    if (catalogId) {
      mlItemId = await resolveCatalogToItemId(catalogId, token);
    }
  }

  if (!mlItemId) {
    return null;
  }

  const mlPrices = await fetchMLPrices([mlItemId], token);
  const mlData = mlPrices[mlItemId];

  if (!mlData) {
    return null;
  }

  const updateData = {
    mlPrice: mlData.price,
    mlPriceUpdatedAt: new Date(),
    price: mlData.price  // Always sync price from ML
  };

  await ProductFamily.findByIdAndUpdate(productId, updateData);

  return {
    productId,
    mlItemId,
    mlPrice: mlData.price,
    originalPrice: mlData.original_price,
    previousPrice: product.price
  };
}

module.exports = {
  extractMLItemId,
  extractMLCatalogId,
  resolveCatalogToItemId,
  fetchMLPrices,
  syncMLPrices,
  syncSingleProductMLPrice
};
