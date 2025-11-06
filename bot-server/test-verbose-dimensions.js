require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');
const { parseDimensions } = require('./measureHandler');

const TEST_PSID = 'test_verbose_' + Date.now();

(async () => {
  try {
    console.log('🧪 Testing Verbose Dimension Parsing Fix\n');
    console.log('---\n');

    // Direct parsing test
    console.log('Test 1: Direct parsing test');
    const testCases = [
      "8 metros de largo x 5 de ancho",
      "8 metros de largo x 5 metros de ancho",
      "5 metros de ancho x 8 metros de largo",
      "precio para 8 metros de largo x 5 de ancho"
    ];

    for (const testCase of testCases) {
      const parsed = parseDimensions(testCase);
      console.log(`Input: "${testCase}"`);
      if (parsed) {
        console.log(`✅ Parsed: ${parsed.width}x${parsed.height} (${parsed.area}m²)`);
      } else {
        console.log(`❌ Failed to parse`);
      }
      console.log('');
    }

    console.log('---\n');

    // Full bot response test with user's exact example
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('Test 2: Full bot conversation with exact user example');
    console.log('User: "Precio para una maya medidas 8 metros de largo x 5 de ancho informes gracias"\n');

    const response = await generateReply(
      "Precio para una maya medidas 8 metros de largo x 5 de ancho informes gracias",
      TEST_PSID
    );

    console.log(`Bot: ${response.text}\n`);
    console.log('Checking:');
    console.log(response.text.includes('8x5') || response.text.includes('8 x 5') || response.text.includes('8×5') ?
      '✅ Bot recognized 8x5 dimensions' : '❌ Bot did NOT recognize dimensions');
    console.log(response.text.includes('especial') || response.text.includes('medidas personalizadas') || response.text.includes('a la medida') ?
      '✅ Bot offers custom fabrication' : '⚠️  No custom option mentioned');
    console.log(response.text.includes('4x6') || response.text.includes('3x4') ?
      '✅ Bot suggests alternative sizes' : '⚠️  No alternatives suggested');
    console.log(response.text.includes('dimensiones estás buscando') ?
      '❌ Bot is asking what dimensions (FAIL - should recognize 8x5)' : '✅ Bot did not ask for dimensions');

    console.log('\n🎉 Verbose dimension parsing tests completed!');

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
