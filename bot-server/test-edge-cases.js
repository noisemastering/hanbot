// test-edge-cases.js
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation, getConversation } = require('./conversationManager');

const TEST_PSID = 'test_edge_' + Date.now();

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🧪 Testing Edge Case Handling\n');

  // ====================================
  // TEST 1: Unintelligible Message (First Attempt)
  // ====================================
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 1: Unintelligible Message - First Attempt');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  console.log('User: "asdfghjkl"\n');
  let response = await generateReply('asdfghjkl', TEST_PSID);
  console.log('Bot:', response.text);

  let convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- clarificationCount:', convo.clarificationCount);
  console.log('- lastIntent:', convo.lastIntent);
  console.log('✅' + (convo.clarificationCount === 1 ? ' PASS' : ' FAIL') + ': Should ask for clarification (count=1)');
  console.log('✅' + (response.text.includes('reformular') || response.text.includes('entender') ? ' PASS' : ' FAIL') + ': Should ask user to rephrase');

  // ====================================
  // TEST 2: Unintelligible Message (Second Attempt - Handoff)
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 2: Unintelligible Message - Second Attempt (Handoff)');
  console.log('═══════════════════════════════════════════════════════');

  console.log('User: "zzzzz ???!"\n');
  response = await generateReply('zzzzz ???!', TEST_PSID);
  console.log('Bot:', response.text);

  convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- clarificationCount:', convo.clarificationCount);
  console.log('- lastIntent:', convo.lastIntent);
  console.log('- state:', convo.state);
  console.log('✅' + (convo.state === 'needs_human' ? ' PASS' : ' FAIL') + ': Should hand off to human');
  console.log('✅' + (response.text.includes('equipo') || response.text.includes('📞') ? ' PASS' : ' FAIL') + ': Should provide contact info');

  // ====================================
  // TEST 3: Clarification Counter Reset on Valid Message
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 3: Clarification Counter Reset on Valid Message');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  // First send unintelligible
  console.log('User: "ksksksk"\n');
  await generateReply('ksksksk', TEST_PSID);
  convo = await getConversation(TEST_PSID);
  console.log('After unintelligible: clarificationCount =', convo.clarificationCount);

  // Then send valid message
  console.log('\nUser: "tienes malla sombra?"\n');
  response = await generateReply('tienes malla sombra?', TEST_PSID);
  console.log('Bot:', response.text.substring(0, 100) + '...');

  convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- clarificationCount:', convo.clarificationCount);
  console.log('✅' + (convo.clarificationCount === 0 ? ' PASS' : ' FAIL') + ': Should reset clarificationCount to 0');

  // ====================================
  // TEST 4: Complex Question (Immediate Handoff)
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 4: Complex Question - Immediate Handoff');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  const complexQuestion = 'necesito calcular cuánta malla necesito para cubrir un área irregular de 45m² con altura variable entre 2.5m y 4m, con sistema de tensores automáticos y certificación de resistencia UV para exportación a Estados Unidos';
  console.log('User:', complexQuestion, '\n');
  response = await generateReply(complexQuestion, TEST_PSID);
  console.log('Bot:', response.text);

  convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- lastIntent:', convo.lastIntent);
  console.log('- state:', convo.state);
  console.log('✅' + (convo.lastIntent === 'complex_query' ? ' PASS' : ' FAIL') + ': Should be flagged as complex query');
  console.log('✅' + (convo.state === 'needs_human' ? ' PASS' : ' FAIL') + ': Should hand off to human');
  console.log('✅' + (response.text.includes('especializada') || response.text.includes('asesor') ? ' PASS' : ' FAIL') + ': Should mention specialized help');

  // ====================================
  // TEST 5: Normal Question (Should Work Normally)
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST 5: Normal Question - Should Work Normally');
  console.log('═══════════════════════════════════════════════════════');
  await resetConversation(TEST_PSID);

  console.log('User: "cuánto cuesta la malla sombra?"\n');
  response = await generateReply('cuánto cuesta la malla sombra?', TEST_PSID);
  console.log('Bot:', response.text);

  convo = await getConversation(TEST_PSID);
  console.log('\nConversation State:');
  console.log('- clarificationCount:', convo.clarificationCount);
  console.log('- state:', convo.state);
  console.log('✅' + (convo.clarificationCount === 0 ? ' PASS' : ' FAIL') + ': Should have clarificationCount = 0');
  console.log('✅' + (convo.state !== 'needs_human' ? ' PASS' : ' FAIL') + ': Should NOT hand off to human');
  console.log('✅' + (response.text.length > 20 ? ' PASS' : ' FAIL') + ': Should provide a real answer');

  // ====================================
  // SUMMARY
  // ====================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅ All Edge Case Tests Completed!');
  console.log('═══════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
