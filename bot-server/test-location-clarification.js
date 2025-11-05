// Test location clarification handler
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_CASES = [
  {
    name: "Asking if located in Reynosa",
    message: "Trabajan aquí en Reynosa?",
    psid: "test_reynosa_" + Date.now()
  },
  {
    name: "Asking if located in Monterrey",
    message: "Están en Monterrey?",
    psid: "test_monterrey_" + Date.now()
  },
  {
    name: "Asking if located in Querétaro",
    message: "Son de Querétaro?",
    psid: "test_qro_" + Date.now()
  },
  {
    name: "Asking about store in Guadalajara",
    message: "Tienen tienda en Guadalajara?",
    psid: "test_gdl_" + Date.now()
  }
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('TESTING LOCATION CLARIFICATION HANDLER');
    console.log('='.repeat(80) + '\n');

    for (const testCase of TEST_CASES) {
      await resetConversation(testCase.psid);

      console.log(`📍 Test: ${testCase.name}`);
      console.log(`User: "${testCase.message}"\n`);

      const response = await generateReply(testCase.message, testCase.psid);

      console.log(`Bot Response:`);
      console.log(response.text);
      console.log('\n' + '-'.repeat(80) + '\n');

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('✅ All test scenarios completed!\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
