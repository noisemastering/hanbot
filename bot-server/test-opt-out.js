// Test opt-out detection after farewell
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_optout_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('TESTING OPT-OUT DETECTION');
    console.log('='.repeat(80) + '\n');

    // Reset conversation
    await resetConversation(TEST_PSID);

    // Step 1: User says "Gracias"
    console.log('Step 1: User says "Gracias"');
    console.log('User: "Gracias"\n');
    const farewellResponse = await generateReply('Gracias', TEST_PSID);
    console.log('Bot Response:');
    console.log(farewellResponse.text);
    console.log('\n' + '-'.repeat(80) + '\n');

    // Small delay to ensure conversation state is updated
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 2: User confirms opt-out with "No"
    console.log('Step 2: User confirms opt-out with "No"');
    console.log('User: "No"\n');
    const optOutResponse = await generateReply('No', TEST_PSID);

    console.log('Bot Response:');
    if (!optOutResponse || optOutResponse === null) {
      console.log('✅ PASSED: Bot correctly did not respond (null returned)');
    } else if (optOutResponse.type === 'no_response') {
      console.log('✅ PASSED: Bot correctly detected opt-out (no_response returned)');
    } else {
      console.log('❌ FAILED: Bot sent a response when it should not have');
      console.log('Response:', optOutResponse);
    }

    console.log('\n' + '-'.repeat(80) + '\n');

    // Step 3: Test other opt-out variations
    console.log('Step 3: Testing other opt-out phrases\n');

    const optOutPhrases = ['nop', 'no gracias', 'ok', 'vale'];

    for (const phrase of optOutPhrases) {
      await resetConversation(TEST_PSID);
      await generateReply('Gracias', TEST_PSID); // Close conversation
      await new Promise(resolve => setTimeout(resolve, 200));

      const response = await generateReply(phrase, TEST_PSID);

      console.log(`  Phrase: "${phrase}"`);
      if (!response || response === null || response.type === 'no_response') {
        console.log('  ✅ Correctly detected as opt-out\n');
      } else {
        console.log('  ❌ Failed - bot responded\n');
      }
    }

    console.log('='.repeat(80));
    console.log('✅ All test scenarios completed!\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
