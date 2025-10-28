// test-ml-links.js - Test that ML links are shown when user asks for details
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_mllinks_" + Date.now();

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

  return response;
}

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing ML Links Display\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // SCENARIO 1: User asks for exact size - should show ML link immediately
    console.log('\n\n🎬 SCENARIO 1: Ask for 3x4 size (should show ML link immediately)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    const response1 = await testMessage(
      '3x4',
      'User asks for 3x4 size'
    );

    if (response1?.text?.includes('mercadolibre.com')) {
      console.log('✅ ML link shown immediately!');
    } else {
      console.log('❌ ML link NOT shown');
    }

    // SCENARIO 2: User expresses buying intent after size
    console.log('\n\n🎬 SCENARIO 2: Buying intent after mentioning size');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '4x6',
      'User mentions 4x6'
    );

    const response2 = await testMessage(
      'quiero comprar',
      'User wants to buy'
    );

    if (response2?.text?.includes('mercadolibre.com')) {
      console.log('✅ ML link shown in buying intent!');
    } else {
      console.log('❌ ML link NOT shown in buying intent');
    }

    // SCENARIO 3: User flow from size → shipping → city
    console.log('\n\n🎬 SCENARIO 3: Size → Shipping → City flow');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage('3x4', 'User asks for 3x4');
    await testMessage('envian a domicilio?', 'User asks about shipping');

    const response3 = await testMessage(
      'monterrey',
      'User provides city'
    );

    if (response3?.text?.includes('mercadolibre.com')) {
      console.log('✅ ML link shown in city response!');
    } else {
      console.log('❌ ML link NOT shown in city response');
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ All ML link tests completed!');
    console.log('\n🔍 Summary:');
    console.log('   - ML links should appear immediately when showing exact size match');
    console.log('   - ML links should appear when user expresses buying intent');
    console.log('   - ML links should appear when user provides city for shipping');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
