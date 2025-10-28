// test-two-tier-approach.js - Test that ML links only show on buying intent or details request
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_twotier_" + Date.now();

async function testMessage(message, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📝 ${description}`);
  console.log(`👤 User: "${message}"`);
  console.log('-'.repeat(70));

  const response = await generateReply(message, TEST_PSID);

  if (response) {
    console.log(`🤖 Bot: ${response.text || '(image only)'}`);

    // Check if ML link is present
    const hasMLLink = response.text && response.text.includes('mercadolibre.com');
    console.log(hasMLLink ? '✅ ML link present' : '❌ No ML link');

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

    console.log('🧪 Testing Two-Tier Approach\n');
    console.log('Generic = No ML link | Details/Buying = ML link\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // SCENARIO 1: Generic size inquiry → Should NOT show ML link
    console.log('\n\n🎬 SCENARIO 1: Generic size inquiry (should NOT show ML link)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '3x4',
      'User asks for 3x4 size - SHOULD NOT show ML link'
    );

    // SCENARIO 2: User asks for details → Should show ML link
    console.log('\n\n🎬 SCENARIO 2: User asks for details (SHOULD show ML link)');
    console.log('=' .repeat(70));

    await testMessage(
      'dame más detalles',
      'User asks for more details - SHOULD show ML link'
    );

    // SCENARIO 3: New conversation → Size → Buying intent
    console.log('\n\n🎬 SCENARIO 3: Size → Buying intent (SHOULD show ML link)');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '4x6',
      'User asks for 4x6 - SHOULD NOT show ML link'
    );

    await testMessage(
      'quiero comprar',
      'User wants to buy - SHOULD show ML link'
    );

    // SCENARIO 4: Size → "si" response (common follow-up)
    console.log('\n\n🎬 SCENARIO 4: Size → "si" response');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      '3x4',
      'User asks for 3x4'
    );

    await testMessage(
      'si',
      '"si" response - might trigger details if bot asked'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ Two-tier approach tests completed!');
    console.log('\n🔍 Expected behavior:');
    console.log('   ❌ Generic size inquiry → NO ML link');
    console.log('   ✅ "dame más detalles" → ML link shown');
    console.log('   ✅ "quiero comprar" → ML link shown');
    console.log('   ❓ "si" response → depends on context');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
