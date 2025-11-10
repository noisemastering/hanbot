// test-fractional-meters.js
require('dotenv').config();
const mongoose = require('mongoose');
const { generateReply } = require('./ai/index');
const { resetConversation } = require('./conversationManager');

const TEST_PSID = 'test_fractional_' + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🧪 Testing fractional meter detection and immediate ML link provision\n');

    await resetConversation(TEST_PSID);

    // Test case: User's exact message from the issue
    console.log('📝 TEST SCENARIO: User asks "Buen día, precio de 6.5 m x 3.17 m por favor"\n');
    console.log('Expected behavior:');
    console.log('  1. Parse dimensions: 6.5m x 3.17m ✓');
    console.log('  2. Detect fractional meters (6.5 and 3.17) ✓');
    console.log('  3. Warn user we only sell full meters ✓');
    console.log('  4. Provide closest options with ML links immediately ✓');
    console.log('  5. NOT ask "¿Qué medida necesitas?" ✓\n');

    console.log('User: "Buen día, precio de 6.5 m x 3.17 m por favor"\n');
    const response = await generateReply('Buen día, precio de 6.5 m x 3.17 m por favor', TEST_PSID);

    console.log('Bot Response:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(response.text);
    console.log('─────────────────────────────────────────────────────────────\n');

    // Validate response
    console.log('✅ Validation:');
    const hasFullMeterWarning = response.text.includes('metros completos') || response.text.includes('Nota:');
    const hasMLLink = response.text.includes('mercadolibre.com.mx');
    const doesNotAskForSize = !response.text.includes('¿Qué medida necesitas?');
    const showsOptions = response.text.includes('opciones más cercanas') || response.text.includes('•');

    console.log(hasFullMeterWarning ? '  ✅ Warns about full meters only' : '  ❌ Missing full meter warning');
    console.log(hasMLLink ? '  ✅ Provides ML link immediately' : '  ❌ No ML link provided');
    console.log(doesNotAskForSize ? '  ✅ Does NOT ask "¿Qué medida necesitas?"' : '  ❌ Still asks for size (WRONG)');
    console.log(showsOptions ? '  ✅ Shows closest options' : '  ❌ No options shown');

    const allChecksPass = hasFullMeterWarning && hasMLLink && doesNotAskForSize && showsOptions;
    console.log('\n' + (allChecksPass ? '🎉 ALL CHECKS PASSED!' : '⚠️  SOME CHECKS FAILED'));

    await mongoose.disconnect();
    process.exit(allChecksPass ? 0 : 1);
  } catch (err) {
    console.error('❌ Test Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
