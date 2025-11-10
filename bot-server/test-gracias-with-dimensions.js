require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

async function testGraciasWithDimensions() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('🧪 Testing "Gracias" with Product Dimensions\n');

  // Test 1: "6x4 y 8x5 Gracias" - should show prices, NOT close conversation
  const psid1 = 'test_gracias_dims1_' + Date.now();
  await resetConversation(psid1);
  console.log('Test 1: Multiple dimensions with "Gracias"');
  console.log('User: "6x4 y 8x5\\nGracias"');
  const resp1 = await generateReply('6x4 y 8x5\nGracias', psid1);
  console.log('Bot:', resp1.text.substring(0, 100) + '...');

  const closedConversation = resp1.text.includes('fue un gusto ayudarte') || resp1.text.includes('excelente día');
  const showedPrices = /\$\d+/.test(resp1.text) || resp1.text.includes('6x4') || resp1.text.includes('8x5');

  console.log(!closedConversation && showedPrices
    ? '✅ Showed prices without closing (correct)\n'
    : '❌ Either closed conversation or did not show prices (incorrect)\n');

  // Test 2: Single dimension with "Gracias"
  const psid2 = 'test_gracias_dims2_' + Date.now();
  await resetConversation(psid2);
  console.log('Test 2: Single dimension with "Gracias"');
  console.log('User: "precio de 4x6 gracias"');
  const resp2 = await generateReply('precio de 4x6 gracias', psid2);
  console.log('Bot:', resp2.text.substring(0, 100) + '...');

  const closedConversation2 = resp2.text.includes('fue un gusto ayudarte') || resp2.text.includes('excelente día');
  const showedPrices2 = /\$\d+/.test(resp2.text) || resp2.text.includes('4x6');

  console.log(!closedConversation2 && showedPrices2
    ? '✅ Showed prices without closing (correct)\n'
    : '❌ Either closed conversation or did not show prices (incorrect)\n');

  // Test 3: Just "Gracias" - should close conversation
  const psid3 = 'test_gracias_dims3_' + Date.now();
  await resetConversation(psid3);
  console.log('Test 3: Just "Gracias" without dimensions');
  console.log('User: "Gracias"');
  const resp3 = await generateReply('Gracias', psid3);
  console.log('Bot:', resp3.text.substring(0, 100) + '...');

  const closedConversation3 = resp3.text.includes('fue un gusto ayudarte') || resp3.text.includes('excelente día');

  console.log(closedConversation3
    ? '✅ Closed conversation (correct)\n'
    : '❌ Did not close conversation (incorrect)\n');

  await mongoose.disconnect();
  console.log('✅ All tests completed!');
  process.exit(0);
}

testGraciasWithDimensions().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
