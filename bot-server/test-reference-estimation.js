// test-reference-estimation.js - Test reference-based dimension estimation
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_car_size_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await resetConversation(TEST_PSID);

    console.log('🧪 Testing reference-based dimension estimation\n');
    console.log('Expected behavior: When user says "tamaño de un carro", bot should estimate ~2m x 5m and suggest appropriate sizes\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    console.log('👤 User: "La quiero para sombra de patio grande más o menos lo grandor y ancho de un carro"\n');
    const response = await generateReply('La quiero para sombra de patio grande más o menos lo grandor y ancho de un carro', TEST_PSID);

    console.log('🤖 Bot Response:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(response.text);
    console.log('─────────────────────────────────────────────────────────────\n');

    console.log('✅ Expected behavior:');
    console.log('  - Recognize "grandor y ancho de un carro" as car size reference');
    console.log('  - Estimate dimensions (~2m x 5m = 10m²)');
    console.log('  - Suggest appropriate sizes (e.g., 3x4m, 4x6m)');
    console.log('  - NOT ask user to measure manually\n');

    console.log('📊 Validation:');
    const suggestionsSizes = response.text.includes('3x4') || response.text.includes('4x6') || response.text.includes('5x5');
    const asksToMeasure = response.text.includes('medir') && response.text.includes('tengas la medida');
    const providesOptions = response.text.includes('•') || response.text.includes('$');
    const acknowledgesReference = response.text.toLowerCase().includes('carro') || response.text.includes('espacio');

    console.log(suggestionsSizes ? '  ✅ Suggests appropriate sizes' : '  ❌ No size suggestions');
    console.log(!asksToMeasure ? '  ✅ Does NOT ask user to measure' : '  ❌ Still asks for manual measurement (BAD)');
    console.log(providesOptions ? '  ✅ Provides concrete options with prices' : '  ❌ No concrete options');
    console.log(acknowledgesReference ? '  ✅ Acknowledges the reference context' : '  ⚠️  No acknowledgment of reference');

    const allChecksPass = suggestionsSizes && !asksToMeasure && providesOptions;
    console.log('\n' + (allChecksPass ? '🎉 ALL CRITICAL CHECKS PASSED!' : '⚠️  SOME CHECKS FAILED'));

    await mongoose.disconnect();
    process.exit(allChecksPass ? 0 : 1);
  } catch (err) {
    console.error('❌ Test Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
