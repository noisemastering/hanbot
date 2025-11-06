require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_multiple_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing Multiple Size Request: "6x4 y 8x5"\n');
    console.log('User: "6x4 y 8x5"\n');

    const response = await generateReply('6x4 y 8x5', TEST_PSID);

    console.log('Bot Response:');
    console.log('---');
    console.log(response.text);
    console.log('---\n');

    // Check if both sizes are mentioned
    const has6x4 = /6x4|4x6/i.test(response.text);
    const has8x5 = /8x5|5x8/i.test(response.text);

    console.log('✅ Analysis:');
    console.log(has6x4 ? '✅ Mentions 6x4 (or 4x6)' : '❌ Does NOT mention 6x4');
    console.log(has8x5 ? '✅ Mentions 8x5 (or 5x8)' : '❌ Does NOT mention 8x5');

    if (has6x4 && has8x5) {
      console.log('\n✅ SUCCESS: Bot offers both sizes!');
    } else {
      console.log('\n⚠️  Bot may not be handling both sizes correctly');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
