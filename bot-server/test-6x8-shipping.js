require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_6x8_shipping_" + Date.now();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  await resetConversation(TEST_PSID);

  console.log("========================================");
  console.log("TEST: 6x8 m cuanto y si envían a Domicilio?");
  console.log("========================================\n");

  console.log('User: "6x8 m cuanto y si envían a Domicilio?"\n');
  const response1 = await generateReply("6x8 m cuanto y si envían a Domicilio?", TEST_PSID);

  console.log("Bot Response 1:");
  console.log(response1.text);
  console.log("\n---\n");

  const has6x8 = response1.text.includes("6x8") || response1.text.includes("8x6");
  const hasPrice = response1.text.includes("$");
  const hasMLLink = response1.text.includes("mercadolibre.com");

  console.log("✅ Analysis:");
  console.log(has6x8 ? "✅ Mentions 6x8 or 8x6" : "❌ Missing dimension");
  console.log(hasPrice ? "✅ Shows price" : "❌ Missing price");
  console.log(hasMLLink ? "✅ Includes ML link" : "❌ Missing ML link");

  // Test city response
  console.log("\n========================================");
  console.log("TEST: City response - Texcoco");
  console.log("========================================\n");

  console.log('User: "Texcoco"\n');
  const response2 = await generateReply("Texcoco", TEST_PSID);

  console.log("Bot Response 2:");
  console.log(response2.text);
  console.log("\n---\n");

  const recognizesCity = !response2.text.includes("no logré entender");
  console.log(recognizesCity ? "✅ Recognizes city" : "❌ Confused by city name");

  // Summary
  console.log("\n========================================");
  console.log("SUMMARY");
  console.log("========================================");

  const allChecks = [has6x8, hasPrice, hasMLLink, recognizesCity];
  const passed = allChecks.filter(c => c).length;
  const total = allChecks.length;

  if (passed === total) {
    console.log(`✅ ALL TESTS PASSED (${passed}/${total})`);
  } else {
    console.log(`⚠️  PARTIAL PASS (${passed}/${total} checks passed)`);
  }

  await mongoose.disconnect();
  console.log("\n🔌 Disconnected from MongoDB");
})();
