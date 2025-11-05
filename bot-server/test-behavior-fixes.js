// test-behavior-fixes.js
// Test the behavior improvements based on real conversation examples

require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

async function testBehaviorFixes() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log("🧪 TESTING BEHAVIOR FIXES");
  console.log("=".repeat(70));
  console.log();

  // Test 1: Generic price inquiry (with misspelling)
  console.log("TEST 1: Generic price inquiry with misspelling");
  console.log("User: 'Precio de la maya sombra'");
  const psid1 = "test_price_" + Date.now();
  await resetConversation(psid1);
  const response1 = await generateReply("Precio de la maya sombra", psid1);
  console.log("Bot:", response1.text);
  console.log();
  console.log(response1.text.includes("3x4m") && response1.text.includes("$450") ? "✅ Shows sizes with prices" : "❌ FAILED");
  console.log("=".repeat(70));
  console.log();

  // Test 2: Custom size question
  console.log("TEST 2: Custom size question");
  console.log("User: 'la venden por medidas o pueden crear alguna medida especial?'");
  const psid2 = "test_custom_" + Date.now();
  await resetConversation(psid2);
  const response2 = await generateReply("la venden por medidas o pueden crear alguna medida especial?", psid2);
  console.log("Bot:", response2.text);
  console.log();
  console.log(response2.text.includes("estándar") && response2.text.includes("fabricamos") ? "✅ Explains standard + custom" : "❌ FAILED");
  console.log("=".repeat(70));
  console.log();

  // Test 3: Vague dimension request
  console.log("TEST 3: Vague dimension request");
  console.log("User: 'ocupo como tipo casa tipo A'");
  const psid3 = "test_vague_" + Date.now();
  await resetConversation(psid3);
  const response3 = await generateReply("ocupo como tipo casa tipo A", psid3);
  console.log("Bot:", response3.text);
  console.log();
  console.log(response3.text.includes("medidas específicas") && response3.text.includes("largo y el ancho") ? "✅ Asks for specific dimensions" : "❌ FAILED");
  console.log("=".repeat(70));
  console.log();

  // Test 4: Buying intent should show link concisely
  console.log("TEST 4: Buying intent with size");
  console.log("User: 'tienes de 4x6?' -> 'quiero comprar'");
  const psid4 = "test_buying_" + Date.now();
  await resetConversation(psid4);
  await generateReply("tienes de 4x6?", psid4);
  const response4 = await generateReply("quiero comprar", psid4);
  console.log("Bot:", response4.text);
  console.log();
  console.log(response4.text.includes("Perfecto") && !response4.text.includes("🎉") && !response4.text.includes("Opción 1") ? "✅ Concise, no emojis, no bullet points" : "❌ FAILED");
  console.log("=".repeat(70));
  console.log();

  // Test 5: Details request should be concise
  console.log("TEST 5: Details request");
  console.log("User: 'tienes de 3x4?' -> 'déjame ver la de 3x4'");
  const psid5 = "test_details_" + Date.now();
  await resetConversation(psid5);
  await generateReply("tienes de 3x4?", psid5);
  const response5 = await generateReply("déjame ver la de 3x4", psid5);
  console.log("Bot:", response5.text);
  console.log();
  console.log(response5.text.includes("enlace seguro") && !response5.text.includes("📱") && response5.text.includes("disponibles para cualquier información") ? "✅ Concise with availability message" : "❌ FAILED");
  console.log("=".repeat(70));

  await mongoose.disconnect();
  console.log();
  console.log("✅ All behavior tests completed!");
}

testBehaviorFixes().catch(console.error);
