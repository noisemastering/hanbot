require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_delivery_payment_" + Date.now();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  await resetConversation(TEST_PSID);

  console.log("========================================");
  console.log("TEST: Delivery time and payment questions");
  console.log("========================================\n");

  // Test 1: Original question from user
  console.log('User: "Cuánto tiempo tarda y se tiene q dar algun anticipo o es pago contra entrega?"\n');
  const response1 = await generateReply("Cuánto tiempo tarda y se tiene q dar algun anticipo o es pago contra entrega?", TEST_PSID);

  console.log("Bot Response 1:");
  console.log(response1.text);
  console.log("\n---\n");

  const hasStandardTime = response1.text.includes("3 días hábiles");
  const hasCustomMention = response1.text.includes("medidas especiales");

  console.log("✅ Analysis:");
  console.log(hasStandardTime ? "✅ Mentions 3 días hábiles for standard sizes" : "❌ Missing standard delivery time");
  console.log(hasCustomMention ? "✅ Mentions custom sizes have different timeline" : "❌ Missing custom size mention");

  // Test 2: Just delivery time
  await resetConversation(TEST_PSID);
  console.log('\nUser: "cuanto tiempo tarda?"\n');
  const response2 = await generateReply("cuanto tiempo tarda?", TEST_PSID);

  console.log("Bot Response 2:");
  console.log(response2.text);
  console.log("\n---\n");

  // Test 3: Just payment method
  await resetConversation(TEST_PSID);
  console.log('\nUser: "como es el pago?"\n');
  const response3 = await generateReply("como es el pago?", TEST_PSID);

  console.log("Bot Response 3:");
  console.log(response3.text);
  console.log("\n---\n");

  // Test 4: "Cuando llega?"
  await resetConversation(TEST_PSID);
  console.log('\nUser: "cuando llega?"\n');
  const response4 = await generateReply("cuando llega?", TEST_PSID);

  console.log("Bot Response 4:");
  console.log(response4.text);
  console.log("\n---\n");

  // Summary
  console.log("========================================");
  console.log("SUMMARY");
  console.log("========================================");

  const allChecks = [hasStandardTime, hasCustomMention];
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
