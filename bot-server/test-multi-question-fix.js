require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_multi_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    const customerQuestion = "Cuál es el costo de malla sombra de 4x6 mts. Y si funciona repeliendo el agua, tiempo de entrega y forma de pago?";

    console.log('🧪 Testing multi-question handling fix\n');
    console.log('Customer question:');
    console.log(`"${customerQuestion}"\n`);
    console.log('Expected answers:');
    console.log('1. ✅ Price of 4x6m shade cloth ($650)');
    console.log('2. ✅ Water repellency (PERMEABLE, not waterproof)');
    console.log('3. ✅ Delivery time (1-2 days CDMX, 3-5 days nationwide)');
    console.log('4. ✅ Payment method (Mercado Libre)\n');
    console.log('---\n');

    const response = await generateReply(customerQuestion, TEST_PSID);

    console.log('Bot Response:\n');
    console.log(response.text);
    console.log('\n---\n');
    console.log('Verification:');

    const hasPrice = /\$?650|\$?450|precio.*4x6|costo.*4x6/i.test(response.text);
    const hasWaterInfo = /permeable|agua|repel|impermeable/i.test(response.text);
    const hasDeliveryTime = /1-2.*d[ií]as|3-5.*d[ií]as|tiempo.*entrega|CDMX/i.test(response.text);
    const hasPaymentInfo = /mercado libre|pago|forma.*pago/i.test(response.text);

    console.log(hasPrice ? '✅ Price mentioned' : '❌ Price NOT mentioned');
    console.log(hasWaterInfo ? '✅ Water info mentioned' : '❌ Water info NOT mentioned');
    console.log(hasDeliveryTime ? '✅ Delivery time mentioned' : '❌ Delivery time NOT mentioned');
    console.log(hasPaymentInfo ? '✅ Payment method mentioned' : '❌ Payment method NOT mentioned');

    const allAnswered = hasPrice && hasWaterInfo && hasDeliveryTime && hasPaymentInfo;
    console.log('\n' + (allAnswered ? '🎉 SUCCESS: All questions answered!' : '⚠️  FAILED: Some questions missing'));

    await mongoose.disconnect();
    process.exit(allAnswered ? 0 : 1);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
