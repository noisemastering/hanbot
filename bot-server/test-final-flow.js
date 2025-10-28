// test-final-flow.js - Test the complete flow with both fixes
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_final_" + Date.now();

async function testMessage(message, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📝 ${description}`);
  console.log(`👤 User: "${message}"`);
  console.log('-'.repeat(70));

  const response = await generateReply(message, TEST_PSID);

  if (response) {
    console.log(`🤖 Bot:\n${response.text || '(image only)'}`);

    // Check key indicators
    const hasMLLink = response.text && response.text.includes('mercadolibre.com');
    const hasCustom = response.text && response.text.includes('medidas personalizadas');

    if (hasMLLink) console.log('✅ ML link present');
    if (hasCustom) console.log('💡 Custom sizes mentioned');
  } else {
    console.log('🤖 Bot: (no response)');
  }

  return response;
}

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing Final Flow\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    await resetConversation(TEST_PSID);

    // Test 1: Ask for unavailable size
    await testMessage(
      'Hola tienes de 4x5?',
      'Test 1: Unavailable size - should be brief with custom mention'
    );

    // Test 2: Ask to see a specific size
    await testMessage(
      'dejame ver la de 4x6',
      'Test 2: "dejame ver" - should show ML link'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ Final flow tests completed!');
    console.log('\n🔍 Expected:');
    console.log('   1. First response: Brief, custom mentioned, NO ML link');
    console.log('   2. Second response: "dejame ver" triggers ML link');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
