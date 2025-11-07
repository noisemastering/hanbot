require('dotenv').config();
const mongoose = require('mongoose');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_handoff_' + Date.now();
const BASE_URL = 'http://localhost:3000';

async function testHandoffSystem() {
  await mongoose.connect(process.env.MONGODB_URI);
  await resetConversation(TEST_PSID);

  console.log('🧪 Testing Human Handoff System\n');
  console.log(`Test PSID: ${TEST_PSID}\n`);

  // Test 1: Check initial status
  console.log('📋 Test 1: Check initial conversation status');
  let response = await fetch(`${BASE_URL}/api/conversation/${TEST_PSID}/status`);
  let data = await response.json();
  console.log('Status:', JSON.stringify(data, null, 2));
  console.log(data.state === 'active' && !data.humanActive
    ? '✅ Initial state correct (bot active)\n'
    : '❌ Initial state incorrect\n');

  // Test 2: Manual takeover
  console.log('👨‍💼 Test 2: Manual human takeover');
  response = await fetch(`${BASE_URL}/api/conversation/${TEST_PSID}/takeover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: 'Test Agent', reason: 'Testing' })
  });
  data = await response.json();
  console.log('Takeover response:', JSON.stringify(data, null, 2));
  console.log(data.success
    ? '✅ Takeover successful\n'
    : '❌ Takeover failed\n');

  // Test 3: Check status after takeover
  console.log('📋 Test 3: Check status after takeover');
  response = await fetch(`${BASE_URL}/api/conversation/${TEST_PSID}/status`);
  data = await response.json();
  console.log('Status:', JSON.stringify(data, null, 2));
  console.log(data.state === 'human_active' && data.humanActive
    ? '✅ Human takeover detected\n'
    : '❌ Human takeover not detected\n');

  // Test 4: Try to generate bot reply while human is active (should return null)
  console.log('🤖 Test 4: Try bot reply while human is active');
  const { generateReply } = require('./ai/index');
  const botReply = await generateReply('Hola, necesito ayuda', TEST_PSID);
  console.log('Bot reply:', botReply);
  console.log(botReply === null
    ? '✅ Bot correctly stayed silent\n'
    : '❌ Bot incorrectly responded\n');

  // Test 5: Release back to bot
  console.log('🤖 Test 5: Release conversation back to bot');
  response = await fetch(`${BASE_URL}/api/conversation/${TEST_PSID}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  data = await response.json();
  console.log('Release response:', JSON.stringify(data, null, 2));
  console.log(data.success
    ? '✅ Release successful\n'
    : '❌ Release failed\n');

  // Test 6: Check status after release
  console.log('📋 Test 6: Check status after release');
  response = await fetch(`${BASE_URL}/api/conversation/${TEST_PSID}/status`);
  data = await response.json();
  console.log('Status:', JSON.stringify(data, null, 2));
  console.log(data.state === 'active' && !data.humanActive
    ? '✅ Bot control restored\n'
    : '❌ Bot control not restored\n');

  // Test 7: Bot should respond now
  console.log('🤖 Test 7: Bot should respond after release');
  const botReply2 = await generateReply('Hola de nuevo', TEST_PSID);
  console.log('Bot reply:', botReply2?.text?.substring(0, 50) + '...');
  console.log(botReply2 && botReply2.text
    ? '✅ Bot responded correctly\n'
    : '❌ Bot did not respond\n');

  await mongoose.disconnect();
  console.log('✅ All tests completed!');
  process.exit(0);
}

testHandoffSystem().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
