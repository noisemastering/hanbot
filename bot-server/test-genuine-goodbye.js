require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

async function testGoodbye() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('🧪 Testing Genuine Goodbye Detection\n');

  // Test 1: Just "gracias" should trigger goodbye
  const psid1 = 'test_goodbye1_' + Date.now();
  await resetConversation(psid1);
  console.log('Test 1: User: "gracias"');
  const resp1 = await generateReply('gracias', psid1);
  console.log('Bot:', resp1.text.substring(0, 50) + '...');
  console.log(resp1.text.includes('Gracias a ti') ? '✅ Goodbye detected\n' : '❌ No goodbye\n');

  // Test 2: "6x4 y 8x5 gracias" should NOT trigger goodbye
  const psid2 = 'test_goodbye2_' + Date.now();
  await resetConversation(psid2);
  console.log('Test 2: User: "6x4 y 8x5 gracias"');
  const resp2 = await generateReply('6x4 y 8x5 gracias', psid2);
  console.log('Bot:', resp2.text.substring(0, 50) + '...');
  console.log(resp2.text.includes('Gracias a ti') ? '❌ WRONG: Said goodbye\n' : '✅ Product offer (no goodbye)\n');

  // Test 3: "Perfecto" should trigger goodbye
  const psid3 = 'test_goodbye3_' + Date.now();
  await resetConversation(psid3);
  console.log('Test 3: User: "Perfecto"');
  const resp3 = await generateReply('Perfecto', psid3);
  console.log('Bot:', resp3.text.substring(0, 50) + '...');
  console.log(resp3.text.includes('Gracias a ti') ? '✅ Goodbye detected\n' : '❌ No goodbye\n');

  await mongoose.disconnect();
  console.log('✅ All tests completed!');
  process.exit(0);
}

testGoodbye().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
