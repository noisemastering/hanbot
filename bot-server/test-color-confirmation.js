require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

async function testColorConfirmation() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('🧪 Testing Color Confirmation vs Color Inquiry\n');

  // Test 1: Color inquiry - should ask if they want to see sizes
  const psid1 = 'test_color_inquiry_' + Date.now();
  await resetConversation(psid1);
  console.log('Test 1: Color inquiry');
  console.log('User: "¿qué colores tienen?"');
  const resp1 = await generateReply('¿qué colores tienen?', psid1);
  console.log('Bot:', resp1.text.substring(0, 80) + '...');
  console.log(resp1.text.includes('¿Te gustaría') || resp1.text.includes('¿Quieres que') || resp1.text.includes('¿Te interesa')
    ? '✅ Asked if they want to see sizes (correct for inquiry)\n'
    : '❌ Did not ask (should have asked)\n');

  // Test 2: Color confirmation with "esta bien" - should show products directly
  const psid2 = 'test_color_confirm1_' + Date.now();
  await resetConversation(psid2);
  console.log('Test 2: Color confirmation with "esta bien"');
  console.log('User: "Esta bien color bex"');
  const resp2 = await generateReply('Esta bien color bex', psid2);
  console.log('Bot:', resp2.text.substring(0, 80) + '...');
  const hasProducts = /\d+x\d+\s*→\s*\$\d+/.test(resp2.text);
  const askQuestion = resp2.text.includes('¿Te gustaría') || resp2.text.includes('¿Quieres que');
  console.log(hasProducts && !askQuestion
    ? '✅ Showed products directly without asking (correct)\n'
    : '❌ Did not show products or asked a question (should show directly)\n');

  // Test 3: Color confirmation with "si" - should show products directly
  const psid3 = 'test_color_confirm2_' + Date.now();
  await resetConversation(psid3);
  console.log('Test 3: Color confirmation with "si beige"');
  console.log('User: "si beige"');
  const resp3 = await generateReply('si beige', psid3);
  console.log('Bot:', resp3.text.substring(0, 80) + '...');
  const hasProducts3 = /\d+x\d+\s*→\s*\$\d+/.test(resp3.text);
  const askQuestion3 = resp3.text.includes('¿Te gustaría') || resp3.text.includes('¿Quieres que');
  console.log(hasProducts3 && !askQuestion3
    ? '✅ Showed products directly without asking (correct)\n'
    : '❌ Did not show products or asked a question (should show directly)\n');

  // Test 4: Color confirmation with "ok" - should show products directly
  const psid4 = 'test_color_confirm3_' + Date.now();
  await resetConversation(psid4);
  console.log('Test 4: Color confirmation with "ok color beige"');
  console.log('User: "ok color beige"');
  const resp4 = await generateReply('ok color beige', psid4);
  console.log('Bot:', resp4.text.substring(0, 80) + '...');
  const hasProducts4 = /\d+x\d+\s*→\s*\$\d+/.test(resp4.text);
  const askQuestion4 = resp4.text.includes('¿Te gustaría') || resp4.text.includes('¿Quieres que');
  console.log(hasProducts4 && !askQuestion4
    ? '✅ Showed products directly without asking (correct)\n'
    : '❌ Did not show products or asked a question (should show directly)\n');

  await mongoose.disconnect();
  console.log('✅ All tests completed!');
  process.exit(0);
}

testColorConfirmation().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
