// scripts/clearMessages.js
// Clear all imported messages from the database

require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");

const Message = require("../models/Message");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function clearMessages() {
  console.log("🗑️  CLEAR ALL MESSAGES");
  console.log("=".repeat(70));

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const count = await Message.countDocuments();
    console.log(`Found ${count} messages in database`);

    if (count === 0) {
      console.log("Database is already empty!");
      rl.close();
      await mongoose.disconnect();
      return;
    }

    rl.question(`\n⚠️  Delete ALL ${count} messages? (yes/no): `, async (answer) => {
      if (answer.toLowerCase() === "yes") {
        await Message.deleteMany({});
        console.log(`✅ Deleted all ${count} messages!`);
        console.log("\nYou can now import fresh data:");
        console.log("  node scripts/importConversations.js");
      } else {
        console.log("❌ Cancelled");
      }

      rl.close();
      await mongoose.disconnect();
    });

  } catch (error) {
    console.error("❌ Error:", error);
    rl.close();
    await mongoose.disconnect();
  }
}

clearMessages();
