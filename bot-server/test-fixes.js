// test-fixes.js - Verify bug fixes
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");

const TEST_PSID = "test_fixes_" + Date.now();

async function testMessage(message, expectedBehavior) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`👤 User: "${message}"`);
  console.log(`✅ Expected: ${expectedBehavior}`);
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

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing Bug Fixes\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // Test 1: Installation - Should say NO
    console.log('\n📍 TEST 1: INSTALLATION QUERIES (Should say NO)');
    await testMessage(
      'ustedes la arman?',
      'Should say NO, we do NOT offer installation'
    );

    await testMessage(
      'viene con montaje',
      'Should say NO, we do NOT offer installation'
    );

    await testMessage(
      'la ponen ustds',
      'Should say NO, we do NOT offer installation'
    );

    // Test 2: Business Info - Should show real phone numbers
    console.log('\n\n📍 TEST 2: BUSINESS INFO (Should show real contact)');
    await testMessage(
      'cual es su telefono',
      'Should show real phone numbers (442...)'
    );

    await testMessage(
      'donde estan ubicados',
      'Should show Querétaro address'
    );

    // Test 3: Generic questions - Should be helpful
    console.log('\n\n📍 TEST 3: HELPFUL RESPONSES (Should be specific)');
    await testMessage(
      'de cuanto',
      'Should ask what product or show available sizes'
    );

    await testMessage(
      'me interesa',
      'Should ask for more details or show products'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ All fix verification tests completed!');
    console.log('\n🔍 Review the responses above to ensure:');
    console.log('   1. Installation queries say NO clearly');
    console.log('   2. Real business info is shown (442 numbers, Querétaro address)');
    console.log('   3. Generic questions get helpful, specific responses');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
