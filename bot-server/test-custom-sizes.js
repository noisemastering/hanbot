// test-custom-sizes.js - Test that custom sizes are mentioned when user insists
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_custom_" + Date.now();

async function testMessage(message, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📝 ${description}`);
  console.log(`👤 User: "${message}"`);
  console.log('-'.repeat(70));

  const response = await generateReply(message, TEST_PSID);

  if (response) {
    console.log(`🤖 Bot: ${response.text || '(image only)'}`);

    // Check if custom sizes mentioned
    const mentionsCustom = response.text && (
      response.text.includes('medidas personalizadas') ||
      response.text.includes('cotizar') ||
      response.text.includes('cotización')
    );
    console.log(mentionsCustom ? '✅ Custom sizes mentioned' : '❌ No custom sizes mention');
  } else {
    console.log('🤖 Bot: (no response)');
  }

  return response;
}

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing Custom Sizes Mention on Insistence\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // SCENARIO 1: First request for unavailable size → NO custom sizes mention
    console.log('\n\n🎬 SCENARIO 1: First request for unavailable size (4x5)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      'tienes de 4x5?',
      'First request for 4x5 - SHOULD NOT mention custom'
    );

    // SCENARIO 2: Insist on same size → SHOULD mention custom sizes
    console.log('\n\n🎬 SCENARIO 2: Insist on 4x5 (second request)');
    console.log('=' .repeat(70));

    await testMessage(
      'no, realmente necesito que sea de 4x5',
      'Second request for 4x5 - SHOULD mention custom sizes!'
    );

    // SCENARIO 3: Different unavailable size → NO custom mention yet
    console.log('\n\n🎬 SCENARIO 3: Ask for different unavailable size (5x7)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '5x7',
      'First request for 5x7 - SHOULD NOT mention custom'
    );

    // SCENARIO 4: Available size → NO custom mention
    console.log('\n\n🎬 SCENARIO 4: Ask for available size (3x4)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '3x4',
      'Available size - NO custom mention'
    );

    await testMessage(
      'necesito 3x4',
      'Repeat available size - NO custom mention'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ Custom sizes tests completed!');
    console.log('\n🔍 Expected behavior:');
    console.log('   ❌ First unavailable request → NO custom mention');
    console.log('   ✅ Second unavailable request (same size) → Custom mention');
    console.log('   ❌ Available size → NO custom mention ever');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
