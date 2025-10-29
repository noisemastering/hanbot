// test-link-improvements.js
// Test the two improvements:
// 1. Specific size request -> immediate ML link
// 2. "sí" response after size shown -> ML link (not greeting)

require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

async function testLinkImprovements() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log("🧪 TESTING LINK IMPROVEMENTS");
  console.log("=".repeat(70));
  console.log();

  // Test 1: Specific size request should show ML link immediately
  console.log("TEST 1: Specific size request -> immediate ML link");
  console.log("-".repeat(70));
  const psid1 = "test_6x5_" + Date.now();
  await resetConversation(psid1);

  console.log('User: "6x5"');
  const response1 = await generateReply("6x5", psid1);
  console.log("Bot:", response1.text);
  console.log();

  const hasPrice = response1.text.includes("$");
  const hasLink = response1.text.includes("mercadolibre.com.mx");
  const hasNoQuestion = !response1.text.includes("¿Te gustaría ver más detalles?");

  console.log(hasPrice ? "✅ Shows price" : "❌ No price");
  console.log(hasLink ? "✅ Shows ML link immediately" : "❌ No ML link");
  console.log(hasNoQuestion ? "✅ No 'ver más detalles' question" : "❌ Still asking for details");
  console.log("=".repeat(70));
  console.log();

  // Test 2: "sí" response after size shown
  console.log("TEST 2: 'sí' after size shown -> ML link (not greeting)");
  console.log("-".repeat(70));
  const psid2 = "test_si_response_" + Date.now();
  await resetConversation(psid2);

  console.log('User: "tienes de 4x6?"');
  await generateReply("tienes de 4x6?", psid2);

  console.log('User: "sí"');
  const response2 = await generateReply("sí", psid2);
  console.log("Bot:", response2.text);
  console.log();

  const hasLink2 = response2.text.includes("mercadolibre.com.mx");
  const notGreeting = !response2.text.includes("¡Hola!") && !response2.text.includes("¿En qué puedo ayudarte");

  console.log(hasLink2 ? "✅ Shows ML link" : "❌ No ML link");
  console.log(notGreeting ? "✅ Not a greeting" : "❌ Still showing greeting");
  console.log("=".repeat(70));
  console.log();

  // Test 3: Dimension swapping still works (4x6 = 6x4)
  console.log("TEST 3: Dimension swapping (4x6 when DB has 6x4m)");
  console.log("-".repeat(70));
  const psid3 = "test_swap_" + Date.now();
  await resetConversation(psid3);

  console.log('User: "4x6"');
  const response3 = await generateReply("4x6", psid3);
  console.log("Bot:", response3.text);
  console.log();

  const hasLink3 = response3.text.includes("mercadolibre.com.mx");
  console.log(hasLink3 ? "✅ Found with dimension swapping" : "❌ Dimension swap failed");
  console.log("=".repeat(70));
  console.log();

  await mongoose.disconnect();

  console.log();
  console.log(hasLink && hasNoQuestion && hasLink2 && notGreeting && hasLink3
    ? "✅ ALL TESTS PASSED!"
    : "❌ SOME TESTS FAILED");
}

testLinkImprovements().catch(console.error);
