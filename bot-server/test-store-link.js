require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_store_link_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Reset conversation
    await resetConversation(TEST_PSID);

    console.log("========================================");
    console.log("TEST: Store Link Request");
    console.log("========================================\n");

    console.log('User: "Ver tienda en línea"\n');
    const response = await generateReply("Ver tienda en línea", TEST_PSID);

    console.log("Bot Response:");
    console.log(response.text);
    console.log("\n---");

    // Check if response has placeholder text
    const hasPlaceholder = response.text.includes("[Enlace") || response.text.includes("[link");
    const hasActualURL = response.text.includes("http") || response.text.includes("mercadolibre.com");

    console.log("\n✅ Validation:");
    console.log(`${!hasPlaceholder ? "✅" : "❌"} Does NOT have placeholder text like [Enlace a la tienda]`);
    console.log(`${hasActualURL ? "✅" : "❌"} Has actual URL`);

    if (!hasPlaceholder && hasActualURL) {
      console.log("\n🎉 TEST PASSED - Response includes actual URL");
    } else {
      console.log("\n❌ TEST FAILED - Response has placeholder or missing URL");
    }

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
