// test-confirmation-flow.js
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation, getConversation } = require('./conversationManager');

const TEST_PSID = 'test_confirmation_' + Date.now();

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🧪 Testing Dimension Confirmation Flow\n');

  // ====================================
  // TEST 1: User mentions uncommon size
  // ====================================
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 1: User mentions uncommon size (9.5x1.30)');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  console.log('User: "nueve metros y medio por uno treinta cuánto cuesta"\n');
  let response = await generateReply('nueve metros y medio por uno treinta cuánto cuesta', TEST_PSID);
  console.log('Bot:', response.text);
  console.log('\n---');

  let convo = await getConversation(TEST_PSID);
  console.log('Conversation State:');
  console.log('- requestedSize:', convo.requestedSize);
  console.log('- lastIntent:', convo.lastIntent);
  console.log('✅' + (convo.requestedSize === '9.5x1.3' || convo.requestedSize === '9.5x1.30' ? ' PASS' : ' FAIL') + ': Should store requested size');

  // ====================================
  // TEST 2: User confirms with additional text
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 2: User confirms with additional text');
  console.log('═══════════════════════════════════════════════════════');

  console.log('User: "si de esa medida con argollas cada cincuenta centímetros"\n');
  response = await generateReply('si de esa medida con argollas cada cincuenta centímetros', TEST_PSID);
  console.log('Bot:', response.text);

  convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- lastIntent:', convo.lastIntent);
  console.log('✅' + (!response.text.includes('reformular') ? ' PASS' : ' FAIL') + ': Should NOT ask for clarification');
  console.log('✅' + (response.text.includes('medida especial') || response.text.includes('mLink') || response.text.includes('Mercado Libre') ? ' PASS' : ' FAIL') + ': Should provide product info or alternatives');

  // ====================================
  // TEST 3: User references size again
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 3: User references "esa medida" again');
  console.log('═══════════════════════════════════════════════════════');

  console.log('User: "deesa medida que les envié la medida"\n');
  response = await generateReply('deesa medida que les envié la medida', TEST_PSID);
  console.log('Bot:', response.text);

  console.log('\n✅' + (!response.text.includes('reformular') ? ' PASS' : ' FAIL') + ': Should NOT ask for clarification');
  console.log('✅' + (response.text.includes('medida') || response.text.includes('Mercado Libre') ? ' PASS' : ' FAIL') + ': Should acknowledge the size reference');

  // ====================================
  // TEST 4: Different scenario - exact match
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 4: User mentions common size (3x4) then confirms');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  console.log('User: "tienes de 3 por 4 metros?"\n');
  response = await generateReply('tienes de 3 por 4 metros?', TEST_PSID);
  console.log('Bot:', response.text.substring(0, 150) + '...');

  convo = await getConversation(TEST_PSID);
  console.log('\n- requestedSize:', convo.requestedSize);

  console.log('\nUser: "si esa"\n');
  response = await generateReply('si esa', TEST_PSID);
  console.log('Bot:', response.text.substring(0, 150) + '...');

  console.log('\n✅' + (response.text.includes('Mercado Libre') || response.text.includes('mLink') ? ' PASS' : ' FAIL') + ': Should provide ML link');

  // ====================================
  // SUMMARY
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅ All Confirmation Flow Tests Completed!');
  console.log('═══════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
