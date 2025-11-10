// test-bot-loop.js - Test bot loop detection and human handoff
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation, getConversation } = require('./conversationManager');

const TEST_PSID = 'test_loop_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing bot loop detection for repetitive oversized requests\n');
    console.log('Expected behavior:');
    console.log('  1st request: Parse dimensions and show alternatives (set lastUnavailableSize = 8x12)');
    console.log('  2nd request: User repeats same size → show same response (oversizedRepeatCount = 1)');
    console.log('  3rd request: User repeats again → show same response (oversizedRepeatCount = 2)');
    console.log('  4th request: User repeats 3rd time → Hand off to human\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    // 1st request
    console.log('👤 User (1st time): "cuanto sale una de 8 por 12"\n');
    const response1 = await generateReply('cuanto sale una de 8 por 12', TEST_PSID);

    console.log('🤖 Bot Response 1:');
    console.log(response1.text);
    console.log('\n─────────────────────────────────────────────────────────────\n');

    let convo = await getConversation(TEST_PSID);
    console.log(`📊 State after 1st request: oversizedRepeatCount = ${convo.oversizedRepeatCount}, lastUnavailableSize = ${convo.lastUnavailableSize}\n`);
    console.log('─────────────────────────────────────────────────────────────\n');

    // 2nd request - insisting on same size
    console.log('👤 User (2nd time): "Pero quiero una sola pieza de 8 por 12"\n');
    const response2 = await generateReply('Pero quiero una sola pieza de 8 por 12', TEST_PSID);

    console.log('🤖 Bot Response 2:');
    console.log(response2.text);
    console.log('\n─────────────────────────────────────────────────────────────\n');

    convo = await getConversation(TEST_PSID);
    console.log(`📊 State after 2nd request: oversizedRepeatCount = ${convo.oversizedRepeatCount}, lastUnavailableSize = ${convo.lastUnavailableSize}\n`);
    console.log('─────────────────────────────────────────────────────────────\n');

    // 3rd request - still showing alternatives
    console.log('👤 User (3rd time): "8 por 12mt"\n');
    const response3 = await generateReply('8 por 12mt', TEST_PSID);

    console.log('🤖 Bot Response 3:');
    console.log(response3.text);
    console.log('\n─────────────────────────────────────────────────────────────\n');

    convo = await getConversation(TEST_PSID);
    console.log(`📊 State after 3rd request: oversizedRepeatCount = ${convo.oversizedRepeatCount}, lastUnavailableSize = ${convo.lastUnavailableSize}\n`);
    console.log('─────────────────────────────────────────────────────────────\n');

    // 4th request - should trigger handoff
    console.log('👤 User (4th time): "necesito de 8x12"\n');
    const response4 = await generateReply('necesito de 8x12', TEST_PSID);

    console.log('🤖 Bot Response 4:');
    console.log(response4.text);
    console.log('\n─────────────────────────────────────────────────────────────\n');

    convo = await getConversation(TEST_PSID);
    console.log(`📊 State after 4th request: state = ${convo.state}, handoffReason = ${convo.handoffReason}, oversizedRepeatCount = ${convo.oversizedRepeatCount}\n`);

    // Validate
    console.log('✅ Validation:');
    const hasHandoff = convo.state === 'needs_human';
    const hasCorrectReason = convo.handoffReason === 'repeated_oversized_request';
    const mentionsTeam = response4.text.includes('equipo de ventas') || response4.text.includes('te paso con');
    const hasPhone = response4.text.includes('📞');
    const counterReset = convo.oversizedRepeatCount === 0;

    console.log(hasHandoff ? '  ✅ Conversation state set to "needs_human"' : '  ❌ State not updated');
    console.log(hasCorrectReason ? '  ✅ Handoff reason is "repeated_oversized_request"' : '  ❌ Wrong handoff reason');
    console.log(mentionsTeam ? '  ✅ Response mentions sales team' : '  ❌ No team mention');
    console.log(hasPhone ? '  ✅ Phone number provided' : '  ❌ No phone number');
    console.log(counterReset ? '  ✅ Counter reset to 0 after handoff' : '  ❌ Counter not reset');

    const allChecksPass = hasHandoff && hasCorrectReason && mentionsTeam && hasPhone && counterReset;
    console.log('\n' + (allChecksPass ? '🎉 ALL CHECKS PASSED!' : '⚠️  SOME CHECKS FAILED'));

    await mongoose.disconnect();
    process.exit(allChecksPass ? 0 : 1);
  } catch (err) {
    console.error('❌ Test Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
