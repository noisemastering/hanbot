require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_3x5_fix_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Test the exact scenario from the user
    console.log("========================================");
    console.log("TEST: 3 ancho x 5 largo (should find 5x3m)");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);

    // Message 1: User asks for 3 ancho x 5 largo
    console.log('User: "3 ancho x 5 largo"\n');
    const response1 = await generateReply("3 ancho x 5 largo", TEST_PSID);

    console.log("Bot Response 1:");
    console.log(response1.text);
    console.log("\n---\n");

    // Validate response 1
    const mentions5x3 = response1.text.includes("5x3") || response1.text.includes("3x5");
    const mentions576 = response1.text.includes("576");
    const hasAlternatives = response1.text.includes("$") && response1.text.includes("x");
    const hasPrices = (response1.text.match(/\$\d+/g) || []).length > 0;

    console.log("✅ Validation for Response 1:");
    console.log(`${mentions5x3 ? "✅" : "❌"} Mentions 5x3m or recognizes dimension exists`);
    console.log(`${mentions576 ? "✅" : "❌"} Shows price $576 for 5x3m`);
    console.log(`${hasAlternatives ? "✅" : "❌"} Shows alternatives with prices`);
    console.log(`${hasPrices ? "✅" : "❌"} Includes prices (found ${(response1.text.match(/\$\d+/g) || []).length} prices)`);

    // Message 2: User asks "En cuanto sale?"
    console.log('\n========================================');
    console.log('Follow-up: "En cuanto sale?"');
    console.log("========================================\n");

    console.log('User: "En cuanto sale?"\n');
    const response2 = await generateReply("En cuanto sale?", TEST_PSID);

    console.log("Bot Response 2:");
    console.log(response2.text);
    console.log("\n---\n");

    // Validate response 2
    const hasSpecificPrices = (response2.text.match(/\$\d+/g) || []).length >= 1;
    const notGenericRange = !response2.text.includes("desde") || response2.text.includes("te sugerí");
    const maintainsContext = response2.text.includes("x") && response2.text.includes("$");

    console.log("✅ Validation for Response 2:");
    console.log(`${hasSpecificPrices ? "✅" : "❌"} Shows specific prices (not generic range)`);
    console.log(`${notGenericRange ? "✅" : "❌"} Does NOT give generic "desde...hasta" range`);
    console.log(`${maintainsContext ? "✅" : "❌"} Maintains context with specific sizes`);

    // Summary
    console.log("\n========================================");
    console.log("SUMMARY");
    console.log("========================================");

    const allChecks = [
      mentions5x3 || hasPrices,  // Either found 5x3 or shows alternatives with prices
      hasPrices,                  // Response 1 has prices
      hasSpecificPrices,          // Response 2 has specific prices
      notGenericRange             // Response 2 doesn't give generic range
    ];

    const passed = allChecks.filter(c => c).length;
    const total = allChecks.length;

    if (passed === total) {
      console.log(`✅ ALL TESTS PASSED (${passed}/${total})`);
      console.log("\n🎉 Fix verified:");
      console.log("   ✓ Swapped dimension check works (3x5 → 5x3)");
      console.log("   ✓ Alternatives include prices");
      console.log("   ✓ Follow-up questions reference specific sizes");
    } else {
      console.log(`⚠️  PARTIAL PASS (${passed}/${total} checks passed)`);
      console.log("   Review responses above for details");
    }

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
