// test-simple-4x5.js - Quick test for 4x5 custom mention
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_4x5_" + Date.now();

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    await resetConversation(TEST_PSID);

    console.log('User: "tienes de 4x5?"\n');
    const response = await generateReply('tienes de 4x5?', TEST_PSID);

    console.log('Bot response:');
    console.log(response.text);
    console.log('\n---');

    if (response.text.includes('medidas personalizadas')) {
      console.log('✅ Custom sizes mentioned!');
    } else {
      console.log('❌ Custom sizes NOT mentioned');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

runTest();
