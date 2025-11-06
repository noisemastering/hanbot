require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_payment_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing Payment Flow Improvements\n');
    console.log('---\n');

    // Test 1: General payment inquiry
    console.log('Test 1: General payment inquiry - "Como se paga?"');
    const response1 = await generateReply("Como se paga?", TEST_PSID);
    console.log(`Bot: ${response1.text}\n`);
    console.log('Checking:');
    console.log(response1.text.includes('POR ADELANTADO') || response1.text.includes('por adelantado') ?
      '✅ Clarifies payment is upfront' : '❌ Missing upfront clarification');
    console.log(response1.text.includes('no se paga al recibir') || response1.text.includes('NO se paga al recibir') ?
      '✅ Clarifies NOT cash on delivery' : '❌ Missing COD clarification');
    console.log('\n---\n');

    // Test 2: Asking about alternative payment methods
    await resetConversation(TEST_PSID);
    console.log('Test 2: Alternative payment inquiry - "Otra forma de pago?"');
    const response2 = await generateReply("Otra forma de pago?", TEST_PSID);
    console.log(`Bot: ${response2.text}\n`);
    console.log('Checking:');
    console.log(response2.text.includes('Querétaro') || response2.text.includes('oficinas') ?
      '✅ Mentions in-person option in Querétaro' : '❌ Missing Querétaro reference');
    console.log(response2.text.includes('efectivo') && response2.text.includes('tarjeta') ?
      '✅ Mentions cash and card options' : '❌ Missing payment method details');
    console.log('\n---\n');

    // Test 3: Asking about cash on delivery
    await resetConversation(TEST_PSID);
    console.log('Test 3: Cash on delivery inquiry - "Se paga al recibir?"');
    const response3 = await generateReply("Se paga al recibir?", TEST_PSID);
    console.log(`Bot: ${response3.text}\n`);
    console.log('Checking:');
    console.log(response3.text.includes('POR ADELANTADO') || response3.text.includes('por adelantado') ?
      '✅ Clarifies payment is upfront' : '❌ Missing upfront clarification');
    console.log(response3.text.includes('no se paga al recibir') || response3.text.includes('NO se paga al recibir') ?
      '✅ Clarifies NOT cash on delivery' : '❌ Missing COD clarification');
    console.log('\n---\n');

    // Test 4: Otro método de pago
    await resetConversation(TEST_PSID);
    console.log('Test 4: Alternative method inquiry - "Otro método de pago?"');
    const response4 = await generateReply("Otro método de pago?", TEST_PSID);
    console.log(`Bot: ${response4.text}\n`);
    console.log('Checking:');
    console.log(response4.text.includes('Querétaro') ?
      '✅ Mentions Querétaro location' : '❌ Missing location');
    console.log('\n---\n');

    console.log('🎉 Payment flow tests completed!');

    // Cleanup
    await resetConversation(TEST_PSID);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
