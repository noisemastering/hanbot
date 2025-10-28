// test-conversation.js - Test bot conversations
const axios = require('axios');

const TEST_PSID = "test_user_measures_" + Date.now();
const WEBHOOK_URL = "http://localhost:3000/webhook";

async function sendMessage(text) {
  console.log(`\n👤 User: ${text}`);

  try {
    const response = await axios.post(WEBHOOK_URL, {
      object: "page",
      entry: [{
        messaging: [{
          sender: { id: TEST_PSID },
          message: { text }
        }]
      }]
    });

    // Wait a bit for the bot to process
    await new Promise(resolve => setTimeout(resolve, 1500));

    return response.data;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function runTests() {
  console.log('🧪 Testing Measures Intent\n');
  console.log(`Test User PSID: ${TEST_PSID}\n`);
  console.log('=' .repeat(60));

  // Test 1: Generic measure query
  console.log('\n📋 Test 1: Generic measure query');
  await sendMessage('A cuánto las malla sombra y medidas');

  // Test 2: Specific dimensions
  console.log('\n📐 Test 2: Specific dimensions (4x5)');
  await sendMessage('Necesito una de 4 x 5');

  // Test 3: Different dimension format
  console.log('\n📐 Test 3: Different format (De. 8 8)');
  await sendMessage('De. 8 8');

  // Test 4: Installation query
  console.log('\n🔧 Test 4: Installation query');
  await sendMessage('La malla sombra de 4 x 5 instalada');

  // Test 5: Color query
  console.log('\n🎨 Test 5: Color query');
  await sendMessage('De 7 x 6 y en qué colores manejan');

  // Test 6: Measurement guidance
  console.log('\n📏 Test 6: Measurement guidance');
  await sendMessage('Te di la medida aprox pero la verdad si necesito medir bien');

  // Test 7: Custom dimension with quote request
  console.log('\n💰 Test 7: Quote request with custom dimension');
  await sendMessage('Me gustaría cotizar una malla sombra para proteger plantas 2.80 x 3.80 por favor');

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ All test messages sent!');
  console.log('\nCheck the server logs above to see bot responses 🤖');
  console.log(`\nYou can also check conversation state at:`);
  console.log(`http://localhost:3000/conversations/${TEST_PSID}`);
}

runTests().catch(console.error);
