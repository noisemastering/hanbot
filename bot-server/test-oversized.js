// test-oversized.js - Test handling of oversized requests
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_10x27_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing oversized dimension handling (10m x 27m)\n');
    console.log('User: "Me podrían cotizar una malla de 10 metros de ancho por 27 de largo por favor"\n');

    const response = await generateReply('Me podrían cotizar una malla de 10 metros de ancho por 27 de largo por favor', TEST_PSID);

    console.log('Bot Response:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(response.text);
    console.log('─────────────────────────────────────────────────────────────\n');

    // Check if response is correct
    const mentionsRolls = response.text.toLowerCase().includes('rollo');
    const mentionsMultiplePieces = response.text.includes('piezas') || response.text.includes('medidas personalizadas') || response.text.includes('fabricar');
    const clarifiesTooLarge = response.text.includes('grande') || response.text.includes('excede') || response.text.includes('medida especial');

    console.log('✅ Expected behavior:');
    console.log('  - Clarify 10x27m is too large for single piece');
    console.log('  - Suggest multiple standard pieces (e.g., 6 pieces of 5x5m)');
    console.log('  - Offer custom fabrication option');
    console.log('  - Do NOT mention rolls\n');

    console.log('❌ Issues found:');
    if (mentionsRolls) console.log('  ❌ Mentions rolls (WRONG - should not suggest rolls unless user asks)');
    if (!mentionsMultiplePieces) console.log('  ❌ Does not mention multiple pieces or custom fabrication');
    if (!clarifiesTooLarge) console.log('  ❌ Does not clarify size is too large');

    if (!mentionsRolls && mentionsMultiplePieces && clarifiesTooLarge) {
      console.log('  ✅ All checks passed!');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
