require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_bulk_discount_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Reset conversation
    await resetConversation(TEST_PSID);

    console.log("========================================");
    console.log("TEST: Bulk Discount Inquiry");
    console.log("========================================\n");

    // Test 1: Exact user scenario
    console.log('User: "Si encargará 9 de la misma medida.no me hacen un descuento?"\n');
    const response1 = await generateReply("Si encargará 9 de la misma medida.no me hacen un descuento?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response1.text);
    console.log("\n---");

    // Validate response
    const mentions20K = response1.text.includes("20,000") || response1.text.includes("20K");
    const hasContactInfo = response1.text.includes("📞") || response1.text.includes("Teléfono");
    const mentionsHuman = response1.text.toLowerCase().includes("asesor") ||
                          response1.text.toLowerCase().includes("comunico") ||
                          response1.text.toLowerCase().includes("contacto");

    console.log("\n✅ Validation:");
    console.log(`${mentions20K ? "✅" : "❌"} Mentions $20,000 MXN threshold`);
    console.log(`${hasContactInfo ? "✅" : "❌"} Provides contact information`);
    console.log(`${mentionsHuman ? "✅" : "❌"} Defers to human salesman`);

    if (mentions20K && hasContactInfo && mentionsHuman) {
      console.log("\n🎉 TEST PASSED - Bulk discount handler working correctly!");
    } else {
      console.log("\n❌ TEST FAILED - Response missing required elements");
    }

    // Test 2: Alternative phrasing
    console.log("\n========================================");
    console.log("TEST 2: Volume Discount Variation");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);

    console.log('User: "Qué descuento me hacen por 15 mallas?"\n');
    const response2 = await generateReply("Qué descuento me hacen por 15 mallas?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response2.text);
    console.log("\n---");

    const mentions20K_2 = response2.text.includes("20,000") || response2.text.includes("20K");
    console.log(`\n${mentions20K_2 ? "✅" : "❌"} Also handles volume discount variations`);

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
