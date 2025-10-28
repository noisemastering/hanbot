// test-measures.js - Quick test for measure handler
require("dotenv").config();
const mongoose = require("mongoose");
const {
  parseDimensions,
  getAvailableSizes,
  findClosestSizes,
  isInstallationQuery,
  isColorQuery,
  isApproximateMeasure,
  generateSizeResponse,
  generateGenericSizeResponse
} = require("./measureHandler");

async function testMeasureHandler() {
  try {
    console.log("🧪 Testing Measure Handler\n");

    // Connect to DB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Test 1: Parse dimensions
    console.log("📏 Test 1: Parse Dimensions");
    const test1 = parseDimensions("15 x 25");
    const test2 = parseDimensions("De. 8 8");
    const test3 = parseDimensions("2.80 x 3.80");
    console.log("  '15 x 25' →", test1);
    console.log("  'De. 8 8' →", test2);
    console.log("  '2.80 x 3.80' →", test3);
    console.log("");

    // Test 2: Installation detection
    console.log("🔧 Test 2: Installation Query Detection");
    console.log("  'malla de 4 x 5 instalada' →", isInstallationQuery("malla de 4 x 5 instalada"));
    console.log("  'cuanto cuesta' →", isInstallationQuery("cuanto cuesta"));
    console.log("");

    // Test 3: Color detection
    console.log("🎨 Test 3: Color Query Detection");
    console.log("  'en qué colores manejan' →", isColorQuery("en qué colores manejan"));
    console.log("  'tienen verde' →", isColorQuery("tienen verde"));
    console.log("  'cuanto cuesta' →", isColorQuery("cuanto cuesta"));
    console.log("");

    // Test 4: Approximate measure detection
    console.log("📐 Test 4: Approximate Measure Detection");
    console.log("  'te di la medida aprox' →", isApproximateMeasure("te di la medida aprox"));
    console.log("  'necesito medir bien' →", isApproximateMeasure("necesito medir bien"));
    console.log("");

    // Test 5: Get available sizes from DB
    console.log("📦 Test 5: Get Available Sizes from DB");
    const sizes = await getAvailableSizes();
    console.log(`  Found ${sizes.length} sizes in database:`);
    sizes.forEach(s => {
      console.log(`    • ${s.sizeStr} - $${s.price} (${s.area}m²) [${s.source}]`);
    });
    console.log("");

    // Test 6: Find closest sizes
    if (sizes.length > 0) {
      console.log("🎯 Test 6: Find Closest Sizes");
      const requestedDim = { width: 4, height: 5, area: 20 };
      const closest = findClosestSizes(requestedDim, sizes);
      console.log(`  Requested: 4x5m (20m²)`);
      console.log(`  Exact match:`, closest.exact ? `${closest.exact.sizeStr} - $${closest.exact.price}` : "None");
      console.log(`  Smaller:`, closest.smaller ? `${closest.smaller.sizeStr} - $${closest.smaller.price}` : "None");
      console.log(`  Bigger:`, closest.bigger ? `${closest.bigger.sizeStr} - $${closest.bigger.price}` : "None");
      console.log("");

      // Test 7: Generate response
      console.log("💬 Test 7: Generate Size Response");
      const response = generateSizeResponse({
        smaller: closest.smaller,
        bigger: closest.bigger,
        exact: closest.exact,
        requestedDim: requestedDim,
        availableSizes: sizes
      });
      console.log(`  Response: ${response}`);
      console.log("");
    }

    // Test 8: Generic size response
    console.log("📋 Test 8: Generate Generic Size Response");
    const genericResponse = generateGenericSizeResponse(sizes);
    console.log(`  ${genericResponse}`);
    console.log("");

    console.log("✅ All tests completed!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
  }
}

testMeasureHandler();
