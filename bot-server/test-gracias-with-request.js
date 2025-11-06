require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_gracias_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing "Gracias" at end of request\n');
    console.log('User: "6x4 y 8x5 Gracias"\n');

    const response = await generateReply('6x4 y 8x5 Gracias', TEST_PSID);

    console.log('Bot Response:');
    console.log('---');
    console.log(response.text);
    console.log('---\n');

    // Check if bot is saying goodbye or offering sizes
    const isGoodbye = /gracias a ti|vuelvas|comuniques|necesites algo|estamos para servirte/i.test(response.text);
    const hasOffer = /4x6|6x4|5x8|8x5/i.test(response.text);
    const hasPrice = /\$\d+/i.test(response.text);

    console.log('✅ Analysis:');
    console.log(isGoodbye ? '❌ Bot is saying GOODBYE (wrong!)' : '✅ Bot is NOT saying goodbye');
    console.log(hasOffer ? '✅ Bot mentions sizes (4x6 or 5x8)' : '❌ Bot does NOT mention sizes');
    console.log(hasPrice ? '✅ Bot shows prices' : '❌ Bot does NOT show prices');

    if (isGoodbye) {
      console.log('\n❌ PROBLEM: Bot thinks user is saying goodbye when they want sizes!');
    } else if (hasOffer && hasPrice) {
      console.log('\n✅ SUCCESS: Bot correctly offers sizes with prices!');
    } else {
      console.log('\n⚠️  Bot behavior unclear');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
