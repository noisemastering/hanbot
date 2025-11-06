require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

async function testRollRequest() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('🧪 Testing Roll Request Handling\n');

  // Test 1: Explicit roll request with dimensions - should hand off to human
  const psid1 = 'test_roll_explicit_' + Date.now();
  await resetConversation(psid1);
  console.log('Test 1: Explicit roll request with dimensions');
  console.log('User: "Precio el rollo de 4 x 100 80% sombra"');
  const resp1 = await generateReply('Precio el rollo de 4 x 100 80% sombra', psid1);
  console.log('Bot:', resp1.text.substring(0, 100) + '...');
  const handsOffToHuman = resp1.text.includes('comunícate directamente') || resp1.text.includes('asesores');
  const asksQuestion = resp1.text.includes('¿Qué te interesa');
  console.log(handsOffToHuman && !asksQuestion
    ? '✅ Handed off to human without asking (correct)\n'
    : '❌ Either asked question or did not hand off (incorrect)\n');

  // Test 2: Another explicit roll request pattern
  const psid2 = 'test_roll_explicit2_' + Date.now();
  await resetConversation(psid2);
  console.log('Test 2: Another explicit roll request pattern');
  console.log('User: "quiero un rollo de 4.20 x 100"');
  const resp2 = await generateReply('quiero un rollo de 4.20 x 100', psid2);
  console.log('Bot:', resp2.text.substring(0, 100) + '...');
  const handsOff2 = resp2.text.includes('comunícate directamente') || resp2.text.includes('asesores');
  const asksQuestion2 = resp2.text.includes('¿Qué te interesa');
  console.log(handsOff2 && !asksQuestion2
    ? '✅ Handed off to human without asking (correct)\n'
    : '❌ Either asked question or did not hand off (incorrect)\n');

  // Test 3: General roll inquiry - should show options and ask
  const psid3 = 'test_roll_general_' + Date.now();
  await resetConversation(psid3);
  console.log('Test 3: General roll inquiry without specific dimensions');
  console.log('User: "venden rollos?"');
  const resp3 = await generateReply('venden rollos?', psid3);
  console.log('Bot:', resp3.text.substring(0, 100) + '...');
  const showsOptions = resp3.text.includes('4.20m x 100m') && resp3.text.includes('2.10m x 100m');
  const asksQuestion3 = resp3.text.includes('¿Qué te interesa');
  console.log(showsOptions && asksQuestion3
    ? '✅ Showed options and asked clarifying question (correct)\n'
    : '❌ Did not show options or ask question (incorrect)\n');

  // Test 4: "cuanto vale el metro" - should show options and ask
  const psid4 = 'test_meter_inquiry_' + Date.now();
  await resetConversation(psid4);
  console.log('Test 4: General meter price inquiry');
  console.log('User: "cuanto vale el metro?"');
  const resp4 = await generateReply('cuanto vale el metro?', psid4);
  console.log('Bot:', resp4.text.substring(0, 100) + '...');
  const showsOptions4 = resp4.text.includes('4.20m x 100m') && resp4.text.includes('2.10m x 100m');
  const asksQuestion4 = resp4.text.includes('¿Qué te interesa');
  console.log(showsOptions4 && asksQuestion4
    ? '✅ Showed options and asked clarifying question (correct)\n'
    : '❌ Did not show options or ask question (incorrect)\n');

  await mongoose.disconnect();
  console.log('✅ All tests completed!');
  process.exit(0);
}

testRollRequest().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
