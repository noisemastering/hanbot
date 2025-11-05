// Test confident response tone for exact matches
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_CASES = [
  {
    name: "3x5 exact match (como el usuario)",
    message: "Cuánto sale una de 3 × 5",
    psid: "test_confident_3x5_" + Date.now()
  },
  {
    name: "4x4 exact match",
    message: "tienes de 4x4?",
    psid: "test_confident_4x4_" + Date.now()
  },
  {
    name: "5x5 exact match",
    message: "precio de 5x5",
    psid: "test_confident_5x5_" + Date.now()
  }
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('TESTING CONFIDENT RESPONSE TONE');
    console.log('='.repeat(80) + '\n');

    for (const testCase of TEST_CASES) {
      await resetConversation(testCase.psid);

      console.log(`📏 Test: ${testCase.name}`);
      console.log(`User: "${testCase.message}"\n`);

      const response = await generateReply(testCase.message, testCase.psid);

      console.log(`Bot Response:`);
      console.log(response.text);
      console.log('\n' + '-'.repeat(80));

      // Check if response uses confident tone
      const usesConfidentTone =
        response.text.includes('Por supuesto') ||
        response.text.includes('Claro') ||
        response.text.includes('la tenemos en');

      const usesOldTone = response.text.includes('Sí, contamos con');

      if (usesConfidentTone) {
        console.log('✅ Uses confident tone ("Por supuesto" / "Claro" / "la tenemos en")');
      } else if (usesOldTone) {
        console.log('❌ Still using old tone ("Sí, contamos con")');
      } else {
        console.log('⚠️  Neither old nor new tone detected');
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
