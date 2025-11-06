require('dotenv').config();
const mongoose = require('mongoose');
const { handleGlobalIntents } = require('./ai/global/intents');

const TEST_PSID = 'test_pricing_user';

async function testPriceByMeter() {
  console.log('🧪 Testing "Cuánto vale el metro" Handler\n');

  await mongoose.connect(process.env.MONGODB_URI);

  const testCases = [
    "Cuánto vale el metro?",
    "Y cuánto cuesta el metro",
    "Vendes por metro?",
    "Quiero comprar por metros",
    "Venden rollos completos?",
    "Tienen rollo completo?"
  ];

  console.log('Testing various user queries:\n');

  for (const testMsg of testCases) {
    console.log(`📝 User: "${testMsg}"`);
    const result = await handleGlobalIntents(testMsg, TEST_PSID);

    if (result) {
      console.log('✅ Bot Response:');
      console.log(result.text);
      console.log('---\n');
    } else {
      console.log('❌ No response detected (handler may not have matched)\n');
    }
  }

  await mongoose.disconnect();
  console.log('✅ All test cases completed!');
  process.exit(0);
}

testPriceByMeter().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
