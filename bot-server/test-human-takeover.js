require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation, updateConversation } = require('./conversationManager');

const TEST_PSID = 'test_human_takeover_' + Date.now();

async function testHumanTakeover() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('🧪 Testing Bot Silence During Human Takeover\n');

  // Step 1: Normal conversation starts
  await resetConversation(TEST_PSID);
  console.log('Step 1: User starts conversation');
  console.log('User: "hola"');
  const resp1 = await generateReply('hola', TEST_PSID);
  console.log('Bot:', resp1.text.substring(0, 60) + '...');
  console.log(resp1.text.includes('Camila') ? '✅ Bot responded normally\n' : '❌ No bot response\n');

  // Step 2: Human agent takes over
  console.log('Step 2: Human agent (Graciela Perez Cruz) takes over');
  await updateConversation(TEST_PSID, {
    state: 'human_active',
    agentTookOverAt: new Date(),
    agentName: 'Graciela Perez Cruz'
  });
  console.log('✅ Human agent is now active\n');

  // Step 3: User sends acknowledgment (like "Perfecto")
  console.log('Step 3: User sends acknowledgment');
  console.log('User: "Perfecto"');
  const resp2 = await generateReply('Perfecto', TEST_PSID);
  if (resp2 === null || resp2.type === 'no_response') {
    console.log('✅ Bot correctly stayed silent (no response)\n');
  } else {
    console.log('❌ PROBLEM: Bot responded when it should not have:');
    console.log('Bot:', resp2.text);
    console.log('');
  }

  // Step 4: User sends a simple "No"
  console.log('Step 4: User sends "No"');
  console.log('User: "No"');
  const resp3 = await generateReply('No', TEST_PSID);
  if (resp3 === null || resp3.type === 'no_response') {
    console.log('✅ Bot correctly stayed silent (no response)\n');
  } else {
    console.log('❌ PROBLEM: Bot responded when it should not have:');
    console.log('Bot:', resp3.text);
    console.log('');
  }

  // Step 5: User sends greeting
  console.log('Step 5: User sends greeting');
  console.log('User: "hola"');
  const resp4 = await generateReply('hola', TEST_PSID);
  if (resp4 === null || resp4.type === 'no_response') {
    console.log('✅ Bot correctly stayed silent (no response)\n');
  } else {
    console.log('❌ PROBLEM: Bot responded when it should not have:');
    console.log('Bot:', resp4.text);
    console.log('');
  }

  // Step 6: User sends thanks
  console.log('Step 6: User sends thanks');
  console.log('User: "gracias"');
  const resp5 = await generateReply('gracias', TEST_PSID);
  if (resp5 === null || resp5.type === 'no_response') {
    console.log('✅ Bot correctly stayed silent (no response)\n');
  } else {
    console.log('❌ PROBLEM: Bot responded when it should not have:');
    console.log('Bot:', resp5.text);
    console.log('');
  }

  // Step 7: User sends product request
  console.log('Step 7: User sends product request');
  console.log('User: "tienes de 4x6?"');
  const resp6 = await generateReply('tienes de 4x6?', TEST_PSID);
  if (resp6 === null || resp6.type === 'no_response') {
    console.log('✅ Bot correctly stayed silent (no response)\n');
  } else {
    console.log('❌ PROBLEM: Bot responded when it should not have:');
    console.log('Bot:', resp6.text);
    console.log('');
  }

  await mongoose.disconnect();
  console.log('✅ Test completed!');
  process.exit(0);
}

testHumanTakeover().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
