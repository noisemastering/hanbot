// test-ai-classifier.js - Test AI classifier with messy real-world messages
require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");

const TEST_PSID = "test_ai_classifier_" + Date.now();

async function testMessage(message, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📝 ${description}`);
  console.log(`👤 User: "${message}"`);
  console.log('-'.repeat(70));

  const response = await generateReply(message, TEST_PSID);

  if (response) {
    console.log(`🤖 Bot: ${response.text || '(image only)'}`);
    if (response.imageUrl) {
      console.log(`🖼️  Image: ${response.imageUrl}`);
    }
  } else {
    console.log('🤖 Bot: (no response)');
  }
}

async function runTests() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧪 Testing AI Classifier with Real-World Messy Messages\n');
    console.log(`Test PSID: ${TEST_PSID}`);

    // Test 1: MISSPELLINGS
    console.log('\n📍 GROUP 1: MISSPELLINGS & TYPOS');
    await testMessage(
      'necsito una malla de 4x5',
      'Misspelling: "necsito" instead of "necesito"'
    );

    await testMessage(
      'qe precio tien',
      'Multiple typos: "qe" and "tien"'
    );

    await testMessage(
      'ola qiero cotizar una malla',
      'Misspelling: "ola" and "qiero"'
    );

    // Test 2: INCOMPLETE MESSAGES
    console.log('\n\n📍 GROUP 2: INCOMPLETE MESSAGES');
    await testMessage(
      'de cuanto',
      'Incomplete: just "de cuanto" (means "how much")'
    );

    await testMessage(
      'ustedes hacen',
      'Incomplete: "ustedes hacen" (means "do you do")'
    );

    await testMessage(
      'la 4x5',
      'Super incomplete: just "la 4x5"'
    );

    // Test 3: SLANG & INFORMAL SPANISH
    console.log('\n\n📍 GROUP 3: SLANG & INFORMAL');
    await testMessage(
      'ps cuanto sale la malla we',
      'Slang: "ps" (pues) and "we" (güey/dude)'
    );

    await testMessage(
      'nel no la instalo yo mandame las medidas',
      'Slang: "nel" (no) - asking for measures'
    );

    await testMessage(
      'a webo quiero una',
      'Slang: "a webo" (hell yeah)'
    );

    // Test 4: MIXED DIMENSIONS FORMATS
    console.log('\n\n📍 GROUP 4: DIMENSION VARIATIONS');
    await testMessage(
      '4 por 5 metros',
      'Dimension: "por" instead of "x"'
    );

    await testMessage(
      'de 8 8 cuanto',
      'Dimension with spaces and typo'
    );

    await testMessage(
      '3.5 x 4.2',
      'Decimals in dimensions'
    );

    // Test 5: INSTALLATION VARIATIONS
    console.log('\n\n📍 GROUP 5: INSTALLATION QUERIES');
    await testMessage(
      'ustedes la arman?',
      'Installation: "arman" (assemble)'
    );

    await testMessage(
      'viene con montaje',
      'Installation: "montaje" (assembly)'
    );

    await testMessage(
      'la ponen ustds',
      'Installation: "ponen" with abbreviation "ustds"'
    );

    // Test 6: LOCATION/SHIPPING
    console.log('\n\n📍 GROUP 6: LOCATION & SHIPPING');
    await testMessage(
      'donde estan',
      'Location: no accent marks'
    );

    await testMessage(
      'hacen envios a gdl',
      'Shipping: abbreviated city "gdl" (Guadalajara)'
    );

    await testMessage(
      'me la mandan',
      'Shipping: informal "me la mandan"'
    );

    // Test 7: COLORS
    console.log('\n\n📍 GROUP 7: COLOR QUERIES');
    await testMessage(
      'hay en negro',
      'Color: simple "hay en negro"'
    );

    await testMessage(
      'nomas beige o q otros colores',
      'Color: slang "nomas" and "q"'
    );

    // Test 8: REALLY MESSY REAL-WORLD MESSAGES
    console.log('\n\n📍 GROUP 8: EXTREMELY MESSY MESSAGES');
    await testMessage(
      'ola ps qiero d la malla cuanto sta la d 4x6 yqe colres hay',
      'Everything wrong: multiple typos, no spaces, slang'
    );

    await testMessage(
      'ps ncsito sber si hacem envios y cuant sale una 3x4',
      'Compressed message with multiple intents'
    );

    await testMessage(
      'ok entoncez la qiero como ago para pedirla',
      'Multiple typos: "entoncez", "qiero", "ago"'
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('\n✅ All AI classifier tests completed!');
    console.log('\n💡 Check the logs above to see how AI handled:');
    console.log('   • Misspellings');
    console.log('   • Incomplete messages');
    console.log('   • Slang & informal language');
    console.log('   • Dimension variations');
    console.log('   • Installation queries');
    console.log('   • Location & shipping');
    console.log('   • Color queries');
    console.log('   • Extremely messy real-world messages');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

runTests();
