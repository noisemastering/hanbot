require("dotenv").config();
const mongoose = require("mongoose");
const { generateReply } = require("./ai/index");
const { resetConversation } = require("./conversationManager");

const TEST_PSID = "test_installation_" + Date.now();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Test 1: FALSE POSITIVE - Should NOT trigger installation response
    console.log("========================================");
    console.log("TEST 1: Buying Intent (should NOT say 'no instalamos')");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);
    console.log('User: "Buena tarde ocupo poner una malla aquí"\n');
    const response1 = await generateReply("Buena tarde ocupo poner una malla aquí", TEST_PSID);

    console.log("Bot Response:");
    console.log(response1.text);
    console.log("\n---");

    const hasInstallationMessage1 = response1.text.toLowerCase().includes("no instalamos") ||
                                     response1.text.toLowerCase().includes("no ofrecemos instalación") ||
                                     response1.text.toLowerCase().includes("no contamos con instalación");

    console.log(`\n${!hasInstallationMessage1 ? "✅" : "❌"} Does NOT mention installation service`);

    if (!hasInstallationMessage1) {
      console.log("🎉 TEST 1 PASSED - Bot correctly treats this as buying intent");
    } else {
      console.log("❌ TEST 1 FAILED - Bot incorrectly detected installation request");
    }

    // Test 2: TRUE POSITIVE - SHOULD trigger installation response
    console.log("\n========================================");
    console.log("TEST 2: Installation Service Inquiry (SHOULD say 'no instalamos')");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);
    console.log('User: "¿Ustedes instalan las mallas?"\n');
    const response2 = await generateReply("¿Ustedes instalan las mallas?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response2.text);
    console.log("\n---");

    const hasInstallationMessage2 = response2.text.toLowerCase().includes("no instalamos") ||
                                     response2.text.toLowerCase().includes("no ofrecemos") ||
                                     response2.text.toLowerCase().includes("no contamos con instalación");

    console.log(`\n${hasInstallationMessage2 ? "✅" : "❌"} Correctly mentions installation service`);

    if (hasInstallationMessage2) {
      console.log("🎉 TEST 2 PASSED - Bot correctly responds to installation inquiry");
    } else {
      console.log("❌ TEST 2 FAILED - Bot should mention no installation service");
    }

    // Test 3: Another buying intent variant
    console.log("\n========================================");
    console.log("TEST 3: Another Buying Intent (should NOT say 'no instalamos')");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);
    console.log('User: "necesito poner una malla en mi terraza"\n');
    const response3 = await generateReply("necesito poner una malla en mi terraza", TEST_PSID);

    console.log("Bot Response:");
    console.log(response3.text);
    console.log("\n---");

    const hasInstallationMessage3 = response3.text.toLowerCase().includes("no instalamos") ||
                                     response3.text.toLowerCase().includes("no ofrecemos instalación") ||
                                     response3.text.toLowerCase().includes("no contamos con instalación");

    console.log(`\n${!hasInstallationMessage3 ? "✅" : "❌"} Does NOT mention installation service`);

    if (!hasInstallationMessage3) {
      console.log("🎉 TEST 3 PASSED - Bot correctly treats this as buying intent");
    } else {
      console.log("❌ TEST 3 FAILED - Bot incorrectly detected installation request");
    }

    // Test 4: Explicit installation service question
    console.log("\n========================================");
    console.log("TEST 4: Explicit Installation Question (SHOULD say 'no instalamos')");
    console.log("========================================\n");

    await resetConversation(TEST_PSID);
    console.log('User: "¿Quién pone la malla?"\n');
    const response4 = await generateReply("¿Quién pone la malla?", TEST_PSID);

    console.log("Bot Response:");
    console.log(response4.text);
    console.log("\n---");

    const hasInstallationMessage4 = response4.text.toLowerCase().includes("no instalamos") ||
                                     response4.text.toLowerCase().includes("no ofrecemos") ||
                                     response4.text.toLowerCase().includes("no contamos con instalación");

    console.log(`\n${hasInstallationMessage4 ? "✅" : "❌"} Correctly mentions installation service`);

    if (hasInstallationMessage4) {
      console.log("🎉 TEST 4 PASSED - Bot correctly responds to installation inquiry");
    } else {
      console.log("❌ TEST 4 FAILED - Bot should mention no installation service");
    }

    // Summary
    console.log("\n========================================");
    console.log("SUMMARY");
    console.log("========================================");
    const allPassed = !hasInstallationMessage1 && hasInstallationMessage2 &&
                      !hasInstallationMessage3 && hasInstallationMessage4;

    if (allPassed) {
      console.log("✅ ALL TESTS PASSED - Installation detection fixed!");
    } else {
      console.log("❌ SOME TESTS FAILED - Review results above");
    }

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
