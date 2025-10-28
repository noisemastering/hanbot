// test-drift-fix.js - Test the specific "monterrey" drift issue
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_drift_" + Date.now();

async function testMessage(message, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📝 ${description}`);
  console.log(`👤 User: "${message}"`);
  console.log('-'.repeat(70));

  const response = await generateReply(message, TEST_PSID);

  if (response) {
    console.log(`🤖 Bot: ${response.text || '(image only)'}`);
    if (response.imageUrl) {
      console.log(`🖼️  Image: ${response.imageUrl}`);
    }
  } else {
    console.log('🤖 Bot: (no response)');
  }
}

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing Drift Fix: "monterrey" should NOT say "¡Hola!"\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    await resetConversation(TEST_PSID);

    await testMessage(
      'hola',
      'Step 1: Greeting'
    );

    await testMessage(
      '3x4 por favor',
      'Step 2: Ask for 3x4 size'
    );

    await testMessage(
      'envian a domicilio?',
      'Step 3: Ask about shipping'
    );

    await testMessage(
      'monterrey',
      'Step 4: Respond with city name (SHOULD NOT say ¡Hola! and SHOULD remember 3x4!)'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ Drift fix test completed!');
    console.log('\n🔍 Check the last response:');
    console.log('   ✅ Should NOT contain "¡Hola!"');
    console.log('   ✅ Should mention "3x4" or reference the size');
    console.log('   ✅ Should provide Monterrey shipping info');
    console.log('   ✅ Should maintain natural conversation flow');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTest();
