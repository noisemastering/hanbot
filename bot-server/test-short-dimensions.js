// Test short dimension patterns that were being marked as unintelligible
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_CASES = [
  {
    name: "Very short dimension - 7x 5",
    message: "7x 5",
    psid: "test_7x5_" + Date.now()
  },
  {
    name: "Short dimension - 3x4",
    message: "3x4",
    psid: "test_3x4_" + Date.now()
  },
  {
    name: "With 'por' - 5 por 3",
    message: "5 por 3",
    psid: "test_5por3_" + Date.now()
  },
  {
    name: "With spaces - 10 x 5",
    message: "10 x 5",
    psid: "test_10x5_" + Date.now()
  }
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('TESTING SHORT DIMENSION PATTERNS');
    console.log('='.repeat(80) + '\n');

    for (const testCase of TEST_CASES) {
      await resetConversation(testCase.psid);

      console.log(`📏 Test: ${testCase.name}`);
      console.log(`User: "${testCase.message}"\n`);

      const response = await generateReply(testCase.message, testCase.psid);

      console.log(`Bot Response:`);
      console.log(response.text);
      console.log('\n' + '-'.repeat(80));

      // Check if response is a proper dimension handler
      const isUnintelligible = response.text.includes('no logré entender') ||
                               response.text.includes('reformular tu pregunta');
      const isDimensionResponse = response.text.includes('tenemos') ||
                                  response.text.includes('medida') ||
                                  response.text.includes('precio') ||
                                  response.text.includes('$');

      if (isUnintelligible) {
        console.log('❌ FAILED: Still marked as unintelligible');
      } else if (isDimensionResponse) {
        console.log('✅ PASSED: Recognized as dimension query');
      } else {
        console.log('⚠️  UNKNOWN: Neither unintelligible nor dimension response');
      }

      console.log('\n' + '='.repeat(80) + '\n');

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('✅ All test scenarios completed!\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
