require('dotenv').config();
const mongoose = require('mongoose');
const { updateConversation, isHumanActive, resetConversation } = require('./conversationManager');
const Message = require('./models/Message');

const TEST_PSID = 'test_handoff_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing Human Handoff Detection\n');
    console.log('---\n');

    // Test 1: Normal bot conversation (no human)
    console.log('Test 1: Normal conversation without human agent');
    const isHuman1 = await isHumanActive(TEST_PSID);
    console.log(`Result: ${isHuman1 ? '❌ FAILED - Bot thinks human is active' : '✅ PASSED - Bot is active'}\n`);

    // Test 2: Human agent takes over
    console.log('Test 2: Human agent takes over conversation');
    await updateConversation(TEST_PSID, {
      state: 'human_active',
      lastIntent: 'human_takeover',
      agentTookOverAt: new Date()
    });
    // Simulate human message in DB
    await Message.create({
      psid: TEST_PSID,
      text: 'Me permite numero de teléfono por favor',
      senderType: 'human',
      createdAt: new Date()
    });
    const isHuman2 = await isHumanActive(TEST_PSID);
    console.log(`Result: ${isHuman2 ? '✅ PASSED - Human is active' : '❌ FAILED - Bot thinks it should respond'}\n`);

    // Test 3: User responds while human is active (bot should NOT respond)
    console.log('Test 3: User responds while human is handling');
    const isHuman3 = await isHumanActive(TEST_PSID);
    console.log(`Result: ${isHuman3 ? '✅ PASSED - Bot stays silent' : '❌ FAILED - Bot would interrupt human'}\n`);

    // Test 4: Auto-resume after 2+ hours (simulate by setting old timestamp)
    console.log('Test 4: Auto-resume after 2+ hours of inactivity');
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await updateConversation(TEST_PSID, {
      state: 'human_active',
      agentTookOverAt: threeHoursAgo
    });
    const isHuman4 = await isHumanActive(TEST_PSID);
    console.log(`Result: ${isHuman4 ? '❌ FAILED - Bot should auto-resume' : '✅ PASSED - Bot auto-resumed after 2+ hours'}\n`);

    // Test 5: Recent human message (within 2 hours) - bot should stay silent
    console.log('Test 5: Recent human message (30 minutes ago)');
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await updateConversation(TEST_PSID, {
      state: 'human_active',
      agentTookOverAt: thirtyMinutesAgo
    });
    await Message.deleteMany({ psid: TEST_PSID });
    await Message.create({
      psid: TEST_PSID,
      text: 'Gracias por la información',
      senderType: 'human',
      createdAt: thirtyMinutesAgo
    });
    const isHuman5 = await isHumanActive(TEST_PSID);
    console.log(`Result: ${isHuman5 ? '✅ PASSED - Human still active' : '❌ FAILED - Bot should wait'}\n`);

    console.log('---');
    const allPassed = !isHuman1 && isHuman2 && isHuman3 && !isHuman4 && isHuman5;
    console.log(allPassed ? '🎉 ALL TESTS PASSED!' : '⚠️  SOME TESTS FAILED');

    // Cleanup
    await resetConversation(TEST_PSID);
    await Message.deleteMany({ psid: TEST_PSID });
    await mongoose.disconnect();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
