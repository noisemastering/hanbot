// scripts/importConversations.js
// Import conversations manually from copy-pasted Messenger data

require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");

const Message = require("../models/Message");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("📥 IMPORT MESSENGER CONVERSATIONS");
console.log("=".repeat(70));
console.log("");
console.log("Just paste your conversations - alternating lines will be:");
console.log("  Line 1: Customer");
console.log("  Line 2: You");
console.log("  Line 3: Customer");
console.log("  Line 4: You");
console.log("  etc...");
console.log("");
console.log("Example:");
console.log("  hola tienes mallas?");
console.log("  Sí, tenemos mallas sombra");
console.log("  cuánto cuestan?");
console.log("  Desde $450");
console.log("");
console.log("  buenos días           <- blank line before = new conversation");
console.log("  Hola! En qué te ayudo?");
console.log("");
console.log("💡 Press Enter TWICE between conversations to separate them");
console.log("");
console.log("Type 'DONE' when finished.");
console.log("=".repeat(70));
console.log("");

const lines = [];

rl.on('line', (line) => {
  if (line.trim().toUpperCase() === 'DONE') {
    rl.close();
  } else {
    lines.push(line.trim());
  }
});

rl.on('close', async () => {
  if (lines.length === 0) {
    console.log("\n⚠️  No lines entered. Exiting.");
    process.exit(0);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("\n✅ Connected to MongoDB");

    let currentPsid = `manual_import_${Date.now()}_1`;
    let conversationCount = 1;
    let imported = 0;
    let messagesInCurrentConvo = 0;
    let isUserTurn = true; // Alternates: user, bot, user, bot...

    console.log(`\n📝 Processing ${lines.length} lines...\n`);

    for (const line of lines) {
      // Detect conversation boundary (blank line after at least one message)
      if (!line || line.trim() === "") {
        if (messagesInCurrentConvo > 0) {
          // Start new conversation
          conversationCount++;
          currentPsid = `manual_import_${Date.now()}_${conversationCount}`;
          messagesInCurrentConvo = 0;
          isUserTurn = true; // Reset to user for new conversation
          console.log(`\n  --- Conversation #${conversationCount} ---`);
        }
        continue;
      }

      const text = line.trim();
      if (!text) continue;

      // Alternate between user and bot
      if (isUserTurn) {
        await Message.create({ psid: currentPsid, text, senderType: "user" });
        console.log(`  👤 Customer: "${text}"`);
      } else {
        await Message.create({ psid: currentPsid, text, senderType: "bot" });
        console.log(`  💬 You: "${text}"`);
      }

      imported++;
      messagesInCurrentConvo++;
      isUserTurn = !isUserTurn; // Switch turns
    }

    console.log(`\n✅ Imported ${imported} messages across ${conversationCount} conversations!`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review and cleanup: node scripts/cleanupConversations.js`);
    console.log(`  2. Learn from data: node scripts/learnFromHumanConversations.js`);

  } catch (error) {
    console.error("\n❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
});
