// scripts/importMLPrices.js
// One-time script to import prices from Mercado Libre to ProductFamily
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const axios = require("axios");
const ProductFamily = require("../models/ProductFamily");
const { getValidMLToken } = require("../mlTokenManager");

const MONGO_URI = process.env.MONGODB_URI;

async function fetchAllMLItems(token, userId) {
  const items = [];
  const limit = 50;
  let scrollId = null;
  let total = 0;

  console.log("📦 Fetching all items from ML seller account...");

  // First request to get total and initial scroll_id
  const firstResponse = await axios.get(
    `https://api.mercadolibre.com/users/${userId}/items/search`,
    {
      params: { limit, search_type: "scan" },
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  total = firstResponse.data.paging.total;
  scrollId = firstResponse.data.scroll_id;
  let results = firstResponse.data.results;

  console.log(`   Total items in ML: ${total}`);

  while (results && results.length > 0) {
    // Fetch details for each batch of item IDs (max 20 at a time for multiget)
    for (let i = 0; i < results.length; i += 20) {
      const batch = results.slice(i, i + 20);
      try {
        const multiget = await axios.get(
          `https://api.mercadolibre.com/items`,
          {
            params: { ids: batch.join(",") },
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        for (const item of multiget.data) {
          if (item.code === 200 && item.body) {
            items.push(item.body);
          }
        }
      } catch (err) {
        console.error(`❌ Error fetching batch:`, err.message);
        // Fallback to individual requests
        for (const itemId of batch) {
          try {
            const detail = await axios.get(
              `https://api.mercadolibre.com/items/${itemId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            items.push(detail.data);
          } catch (e) {
            console.error(`❌ Error fetching item ${itemId}:`, e.message);
          }
        }
      }
    }

    console.log(`   Fetched ${items.length}/${total} items...`);

    // Get next page using scroll_id
    if (!scrollId) break;

    try {
      const nextResponse = await axios.get(
        `https://api.mercadolibre.com/users/${userId}/items/search`,
        {
          params: { limit, search_type: "scan", scroll_id: scrollId },
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      results = nextResponse.data.results;
      scrollId = nextResponse.data.scroll_id;
    } catch (err) {
      console.error(`❌ Error fetching next page:`, err.message);
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  return items;
}

async function matchAndUpdatePrices(mlItems) {
  let matched = 0;
  let notMatched = 0;
  let updated = 0;
  let priceChanged = 0;
  const notMatchedItems = [];

  console.log("\n🔄 Matching ML items to ProductFamily...\n");

  for (const item of mlItems) {
    const permalink = item.permalink;
    const mlPrice = item.price;
    const mlTitle = item.title;
    const mlId = item.id; // e.g., "MLM795958154"

    // Try to find by exact URL first
    let product = await ProductFamily.findOne({
      "onlineStoreLinks.url": permalink
    });

    // If not found, try to find by ML item ID pattern in URL
    if (!product) {
      const idMatch = mlId.match(/(MLM\d+)/);
      if (idMatch) {
        product = await ProductFamily.findOne({
          "onlineStoreLinks.url": { $regex: idMatch[1], $options: "i" }
        });
      }
    }

    if (product) {
      matched++;
      const oldPrice = product.price || 0;

      if (oldPrice !== mlPrice) {
        priceChanged++;
        console.log(`💰 ${product.name}`);
        console.log(`   ML: ${mlTitle}`);
        console.log(`   Old price: $${oldPrice} → New price: $${mlPrice}`);

        // Update the price
        product.price = mlPrice;
        await product.save();
        updated++;
      }
    } else {
      notMatched++;
      notMatchedItems.push({ title: mlTitle, url: permalink, price: mlPrice });
    }
  }

  // Only show first 20 unmatched items
  if (notMatchedItems.length > 0) {
    console.log(`\n⚠️ Showing first 20 of ${notMatchedItems.length} unmatched items:\n`);
    notMatchedItems.slice(0, 20).forEach(item => {
      console.log(`   - ${item.title}`);
      console.log(`     $${item.price} | ${item.url}`);
    });
  }

  return { matched, notMatched, updated, priceChanged };
}

async function main() {
  try {
    console.log("🚀 ML Price Import Script\n");
    console.log("=".repeat(50));

    // Connect to MongoDB
    console.log("\n📊 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get valid ML token
    console.log("🔐 Getting ML token...");
    const token = await getValidMLToken();

    // Get user ID
    const me = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = me.data.id;
    console.log(`✅ Authenticated as: ${me.data.nickname} (ID: ${userId})\n`);

    // Fetch all items
    const mlItems = await fetchAllMLItems(token, userId);
    console.log(`\n✅ Fetched ${mlItems.length} items from ML\n`);

    // Match and update prices
    const stats = await matchAndUpdatePrices(mlItems);

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 IMPORT SUMMARY");
    console.log("=".repeat(50));
    console.log(`   Total ML items:     ${mlItems.length}`);
    console.log(`   Matched to DB:      ${stats.matched}`);
    console.log(`   Not matched:        ${stats.notMatched}`);
    console.log(`   Prices changed:     ${stats.priceChanged}`);
    console.log(`   Products updated:   ${stats.updated}`);
    console.log("=".repeat(50));

    if (stats.notMatched > 0) {
      console.log("\n⚠️ Some ML items were not matched to ProductFamily.");
      console.log("   You may need to add their links to onlineStoreLinks in Inventario.");
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.response?.data) {
      console.error("   ML API response:", err.response.data);
    }
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
  }
}

main();
