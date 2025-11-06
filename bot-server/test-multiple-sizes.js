require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_multi_size_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    const customerQuestion = "4x3 y 4x4. precios.";

    console.log('🧪 Testing multiple size request handling fix\n');
    console.log('Customer question:');
    console.log(`"${customerQuestion}"\n`);
    console.log('Expected answers:');
    console.log('1. ✅ Price of 4x3m shade cloth ($445)');
    console.log('2. ✅ Price of 4x4m shade cloth (should have this)');
    console.log('3. ✅ Links or comprehensive information for BOTH sizes\n');
    console.log('---\n');

    const response = await generateReply(customerQuestion, TEST_PSID);

    console.log('Bot Response:\n');
    console.log(response.text);
    console.log('\n---\n');
    console.log('Verification:');

    const has4x3 = /4[x\s]*3|3[x\s]*4/i.test(response.text);
    const has4x4 = /4[x\s]*4/i.test(response.text);
    const has4x3Price = /445|\$\s*445|4x3.*\$|4x3.*precio/i.test(response.text);
    const has4x4Info = /4x4.*\$|4x4.*precio|4x4.*cuest/i.test(response.text);

    console.log(has4x3 ? '✅ 4x3 size mentioned' : '❌ 4x3 size NOT mentioned');
    console.log(has4x4 ? '✅ 4x4 size mentioned' : '❌ 4x4 size NOT mentioned');
    console.log(has4x3Price ? '✅ 4x3 price mentioned ($445)' : '❌ 4x3 price NOT mentioned');
    console.log(has4x4Info ? '✅ 4x4 info mentioned' : '❌ 4x4 info NOT mentioned');

    const allAnswered = has4x3 && has4x4 && has4x3Price && has4x4Info;
    console.log('\n' + (allAnswered ? '🎉 SUCCESS: Both sizes mentioned!' : '⚠️  PARTIAL: Not all sizes covered'));

    await mongoose.disconnect();
    process.exit(allAnswered ? 0 : 1);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
