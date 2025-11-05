require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_7x7_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Reset conversation
    await resetConversation(TEST_PSID);

    // Test the exact scenario from the user's conversation
    console.log("========================================");
    console.log("TEST: 7x7m Size Inquiry");
    console.log("========================================\n");

    console.log('User: "De 7 metros x 7 metros"\n');
    const response = await generateReply("De 7 metros x 7 metros", TEST_PSID);

    console.log("Bot Response:");
    console.log(response.text);
    console.log("\n---");

    // Validate response
    const hasPrice2700 = response.text.includes("2700");
    const mentions7x7 = response.text.includes("7x7");
    const isNotCustom = !response.text.includes("medida especial") &&
                        !response.text.includes("fabricar a la medida") &&
                        !response.text.includes("necesitaríamos fabricar");

    console.log("\n✅ Validation:");
    console.log(`${hasPrice2700 ? "✅" : "❌"} Mentions correct price ($2700)`);
    console.log(`${mentions7x7 ? "✅" : "❌"} Mentions 7x7m size`);
    console.log(`${isNotCustom ? "✅" : "❌"} Does NOT say it's a custom/special size`);

    if (hasPrice2700 && mentions7x7 && isNotCustom) {
      console.log("\n🎉 TEST PASSED - Bot correctly handles 7x7m as available product!");
    } else {
      console.log("\n❌ TEST FAILED - Bot still treats 7x7m incorrectly");
    }

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
