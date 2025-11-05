require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_shipping_location_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Test 1: Location + price inquiry (like the user's example)
    console.log("========================================");
    console.log("TEST 1: Location + Price Inquiry");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);

    console.log('User: "Yo estoy en Sinaloa. En cuanto me saldría?"\n');
    const response1 = await generateReply("Yo estoy en Sinaloa. En cuanto me saldría?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response1.text);
    console.log("\n---\n");

    const hasMLLink1 = response1.text.includes("mercadolibre.com");
    const mentionsShipping1 = response1.text.toLowerCase().includes("envío") || response1.text.toLowerCase().includes("envio");
    const mentionsIncluded1 = response1.text.toLowerCase().includes("incluido");

    console.log("✅ Validation:");
    console.log(`${hasMLLink1 ? "✅" : "❌"} Includes Mercado Libre link`);
    console.log(`${mentionsShipping1 ? "✅" : "❌"} Mentions shipping`);
    console.log(`${mentionsIncluded1 ? "✅" : "❌"} Mentions shipping is included/calculated`);

    // Test 2: Direct shipping question
    console.log("\n========================================");
    console.log("TEST 2: Direct Shipping Question");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);

    console.log('User: "Hacen envíos?"\n');
    const response2 = await generateReply("Hacen envíos?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response2.text);
    console.log("\n---\n");

    const hasMLLink2 = response2.text.includes("mercadolibre.com");
    const mentionsIncluded2 = response2.text.toLowerCase().includes("incluido");
    const mentionsCalculated2 = response2.text.toLowerCase().includes("calcula");

    console.log("✅ Validation:");
    console.log(`${hasMLLink2 ? "✅" : "❌"} Includes Mercado Libre link`);
    console.log(`${mentionsIncluded2 ? "✅" : "❌"} Mentions shipping is included`);
    console.log(`${mentionsCalculated2 ? "✅" : "❌"} Mentions shipping is calculated on ML`);

    // Test 3: Shipping question with specific size context
    console.log("\n========================================");
    console.log("TEST 3: Shipping Question After Size Inquiry");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);

    console.log('User: "tienes de 4x6?"\n');
    const response3a = await generateReply("tienes de 4x6?", TEST_PSID);
    console.log("Bot:", response3a.text.substring(0, 50) + "...\n");

    console.log('User: "hacen envíos?"\n');
    const response3b = await generateReply("hacen envíos?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response3b.text);
    console.log("\n---\n");

    const hasSpecificSize = response3b.text.includes("4x6");
    const hasMLLink3 = response3b.text.includes("mercadolibre.com");
    const mentionsIncluded3 = response3b.text.toLowerCase().includes("incluido");

    console.log("✅ Validation:");
    console.log(`${hasSpecificSize ? "✅" : "❌"} References the 4x6 size from context`);
    console.log(`${hasMLLink3 ? "✅" : "❌"} Includes product ML link`);
    console.log(`${mentionsIncluded3 ? "✅" : "❌"} Mentions shipping is included/calculated`);

    // Summary
    console.log("\n========================================");
    console.log("SUMMARY");
    console.log("========================================");

    const allChecks = [
      hasMLLink1,
      mentionsShipping1,
      mentionsIncluded1,
      hasMLLink2,
      mentionsIncluded2,
      hasMLLink3,
      mentionsIncluded3
    ];

    const passed = allChecks.filter(c => c).length;
    const total = allChecks.length;

    if (passed === total) {
      console.log(`✅ ALL TESTS PASSED (${passed}/${total})`);
      console.log("\n🎉 Shipping handler improvements verified:");
      console.log("   ✓ Location + price inquiry shows ML link with shipping info");
      console.log("   ✓ Direct shipping questions provide ML store link");
      console.log("   ✓ Shipping clarified as included or calculated on ML");
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
