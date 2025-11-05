require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_ack_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing acknowledgment emoji handling fix\n');
    console.log('Problem: Customer sent 👍 and bot responded with "unintelligible" message\n');
    console.log('Expected: Bot should recognize 👍 as acknowledgment and respond naturally\n');
    console.log('---\n');

    // Test case 1: Thumbs up emoji
    console.log('Test 1: Thumbs up emoji');
    console.log('User: "👍"\n');
    const response1 = await generateReply('👍', TEST_PSID);
    console.log('Bot:', response1.text);
    console.log('');

    const isAcknowledged1 = /Perfecto|algo más|ayudarte/i.test(response1.text);
    const isUnintelligible1 = /no logré entender|reformular/i.test(response1.text);
    console.log(isAcknowledged1 ? '✅ Thumbs up recognized as acknowledgment' : '❌ Thumbs up NOT recognized');
    console.log(isUnintelligible1 ? '❌ Still treating as unintelligible' : '✅ Not treated as unintelligible');

    // Test case 2: OK emoji
    console.log('\n---\n');
    console.log('Test 2: OK emoji');
    console.log('User: "👌"\n');
    const response2 = await generateReply('👌', TEST_PSID);
    console.log('Bot:', response2.text);
    console.log('');

    const isAcknowledged2 = /Perfecto|algo más|ayudarte/i.test(response2.text);
    console.log(isAcknowledged2 ? '✅ OK emoji recognized' : '❌ OK emoji NOT recognized');

    // Test case 3: Simple "ok" text
    console.log('\n---\n');
    console.log('Test 3: Simple "ok" text');
    console.log('User: "ok"\n');
    const response3 = await generateReply('ok', TEST_PSID);
    console.log('Bot:', response3.text);
    console.log('');

    const isAcknowledged3 = /Perfecto|algo más|ayudarte/i.test(response3.text);
    console.log(isAcknowledged3 ? '✅ "ok" recognized' : '❌ "ok" NOT recognized');

    // Final result
    const allPassed = isAcknowledged1 && !isUnintelligible1 && isAcknowledged2 && isAcknowledged3;
    console.log('\n' + (allPassed ? '🎉 SUCCESS: All acknowledgments handled correctly!' : '⚠️  FAILED: Some acknowledgments not recognized'));

    await mongoose.disconnect();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
