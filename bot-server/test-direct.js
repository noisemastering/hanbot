// test-direct.js - Test bot responses directly without Facebook API
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");

const TEST_PSID = "test_direct_" + Date.now();

async function testMessage(message) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`👤 User: ${message}`);
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

    console.log('🧪 Testing Measures Intent - Direct Responses\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // Test 1: Generic measure query
    await testMessage('A cuánto las malla sombra y medidas');

    // Test 2: Specific dimensions
    await testMessage('Necesito una de 4 x 5');

    // Test 3: Different dimension format
    await testMessage('De. 8 8');

    // Test 4: Installation query
    await testMessage('La malla sombra de 4 x 5 instalada');

    // Test 5: Color query
    await testMessage('De 7 x 6 y en qué colores manejan');

    // Test 6: Measurement guidance
    await testMessage('Te di la medida aprox pero la verdad si necesito medir bien');

    // Test 7: Custom dimension with quote request
    await testMessage('Me gustaría cotizar una malla sombra para proteger plantas 2.80 x 3.80 por favor');

    // Test 8: Price for specific size
    await testMessage('4 x 3 precio. Que precio tiene');

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
