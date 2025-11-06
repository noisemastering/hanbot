require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_abbrev_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing Abbreviation Parsing\n');
    console.log('---\n');

    // Test 1: "Ntp está bien" in context of a conversation
    console.log('Test 1: Bot offers something, user responds "Ntp está bien"');

    // First, establish some context - user asks about a size
    console.log('\nUser: "Tienes de 4x6?"');
    const response1 = await generateReply("Tienes de 4x6?", TEST_PSID);
    console.log(`Bot: ${response1.text}\n`);

    // Now user responds with abbreviation
    console.log('User: "Ntp está bien"');
    const response2 = await generateReply("Ntp está bien", TEST_PSID);
    console.log(`Bot: ${response2.text}\n`);

    // Test 2: Other common abbreviations
    await resetConversation(TEST_PSID);

    console.log('\nTest 2: Other abbreviations - "tmb" (también)');
    console.log('User: "tmb tienen de 3x4?"');
    const response3 = await generateReply("tmb tienen de 3x4?", TEST_PSID);
    console.log(`Bot: ${response3.text}\n`);

    console.log('\nTest 3: "q" (qué)');
    console.log('User: "q medidas tienen?"');
    const response4 = await generateReply("q medidas tienen?", TEST_PSID);
    console.log(`Bot: ${response4.text}\n`);

    console.log('\nTest 4: "xq" (porque)');
    console.log('User: "xq solo tienen beige?"');
    const response5 = await generateReply("xq solo tienen beige?", TEST_PSID);
    console.log(`Bot: ${response5.text}\n`);

    console.log('---');
    console.log('\n📊 Analysis:');
    console.log('- Check if "Ntp está bien" is understood as positive acknowledgment');
    console.log('- Check if abbreviations like "tmb", "q", "xq" are parsed correctly');
    console.log('- Bot should respond appropriately, not treat as unknown intent\n');

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
