require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_goodbye_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log('🧪 Testing Goodbye Detection Fix\n');
    console.log('---\n');

    // Test 1: "Ok, mañana me comunico"
    await resetConversation(TEST_PSID);
    console.log('Test 1: "Ok, mañana me comunico"');
    const response1 = await generateReply("Ok, mañana me comunico", TEST_PSID);
    console.log(`Bot: ${response1.text}\n`);
    console.log('Checking:');
    console.log(response1.text.includes('Gracias a ti') || response1.text.includes('gusto ayudarte') ?
      '✅ Bot responded with goodbye' : '❌ Bot did NOT respond with goodbye');
    console.log(response1.text.includes('Lo siento') || response1.text.includes('no tengo información') ?
      '❌ Bot gave fallback response (FAIL)' : '✅ Bot did not give fallback');
    console.log('\n---\n');

    // Test 2: "Luego te hablo"
    await resetConversation(TEST_PSID);
    console.log('Test 2: "Luego te hablo"');
    const response2 = await generateReply("Luego te hablo", TEST_PSID);
    console.log(`Bot: ${response2.text}\n`);
    console.log('Checking:');
    console.log(response2.text.includes('Gracias a ti') || response2.text.includes('gusto ayudarte') ?
      '✅ Bot responded with goodbye' : '❌ Bot did NOT respond with goodbye');
    console.log('\n---\n');

    // Test 3: "Después te contacto"
    await resetConversation(TEST_PSID);
    console.log('Test 3: "Después te contacto"');
    const response3 = await generateReply("Después te contacto", TEST_PSID);
    console.log(`Bot: ${response3.text}\n`);
    console.log('Checking:');
    console.log(response3.text.includes('Gracias a ti') || response3.text.includes('gusto ayudarte') ?
      '✅ Bot responded with goodbye' : '❌ Bot did NOT respond with goodbye');
    console.log('\n---\n');

    // Test 4: "Hasta luego"
    await resetConversation(TEST_PSID);
    console.log('Test 4: "Hasta luego"');
    const response4 = await generateReply("Hasta luego", TEST_PSID);
    console.log(`Bot: ${response4.text}\n`);
    console.log('Checking:');
    console.log(response4.text.includes('Gracias a ti') || response4.text.includes('gusto ayudarte') ?
      '✅ Bot responded with goodbye' : '❌ Bot did NOT respond with goodbye');
    console.log('\n---\n');

    // Test 5: "Nos hablamos"
    await resetConversation(TEST_PSID);
    console.log('Test 5: "Nos hablamos"');
    const response5 = await generateReply("Nos hablamos", TEST_PSID);
    console.log(`Bot: ${response5.text}\n`);
    console.log('Checking:');
    console.log(response5.text.includes('Gracias a ti') || response5.text.includes('gusto ayudarte') ?
      '✅ Bot responded with goodbye' : '❌ Bot did NOT respond with goodbye');
    console.log('\n---\n');

    console.log('🎉 Goodbye flow tests completed!');

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
