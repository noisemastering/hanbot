// test-buying-flow.js - Test the complete buying journey
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");

const TEST_PSID = "test_buying_" + Date.now();

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

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing Complete Buying Flow\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // SCENARIO 1: User asks for size, then wants to buy
    console.log('\n\n🎬 SCENARIO 1: Ask about size → Buy');
    console.log('=' .repeat(70));

    await testMessage(
      'necesito una de 3x4',
      'Step 1: Ask about 3x4 size'
    );

    await testMessage(
      'quiero comprar',
      'Step 2: Express buying intent (should remember 3x4!)'
    );

    // SCENARIO 2: User says a size, then wants to buy
    console.log('\n\n🎬 SCENARIO 2: Just mention size → Buy');
    console.log('=' .repeat(70));

    await testMessage(
      '4x6',
      'Step 1: Just say "4x6"'
    );

    await testMessage(
      'lo quiero',
      'Step 2: "lo quiero" (should remember 4x6!)'
    );

    // SCENARIO 3: Typos in buying intent
    console.log('\n\n🎬 SCENARIO 3: Messy buying intent');
    console.log('=' .repeat(70));

    await testMessage(
      'qiero comprar una de 3x4',
      'Misspelling + buying intent + size'
    );

    // SCENARIO 4: Just want to buy (no context)
    console.log('\n\n🎬 SCENARIO 4: Buy without mentioning size first');
    console.log('=' .repeat(70));

    // Reset conversation for clean test
    const { resetConversation } = require("./conversationManager");
    await resetConversation(TEST_PSID);

    await testMessage(
      'quiero comprar',
      'No context - should ask what size'
    );

    // SCENARIO 5: Full conversation flow
    console.log('\n\n🎬 SCENARIO 5: Natural conversation flow');
    console.log('=' .repeat(70));

    await resetConversation(TEST_PSID);

    await testMessage(
      'hola',
      'Step 1: Greeting'
    );

    await testMessage(
      'que medidas tienes',
      'Step 2: Ask about sizes'
    );

    await testMessage(
      'la de 4x6',
      'Step 3: Choose 4x6'
    );

    await testMessage(
      'cuanto cuesta',
      'Step 4: Ask price (should remember 4x6)'
    );

    await testMessage(
      'quiero comprar',
      'Step 5: Buy (should remember 4x6 and show purchase options!)'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ All buying flow tests completed!');
    console.log('\n🔍 Check the responses above to ensure:');
    console.log('   1. Bot remembers the size when user says "quiero comprar"');
    console.log('   2. Bot shows 3 purchase options (ML, bodega, phone)');
    console.log('   3. No "¡Hola!" in the middle of conversations');
    console.log('   4. Context is maintained throughout the flow');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
