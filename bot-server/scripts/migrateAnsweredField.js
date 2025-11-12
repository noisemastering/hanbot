// scripts/migrateAnsweredField.js
// Retroactively mark old user messages as answered if they have a bot/human response after them

require("dotenv").config();
const mongoose = require("mongoose");
const Message = require("../models/Message");

async function migrateAnsweredField() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // Get all unique PSIDs
    const psids = await Message.distinct("psid");
    console.log(`Found ${psids.length} unique users`);

    let updatedCount = 0;

    for (const psid of psids) {
      // Get all messages for this user, sorted by timestamp
      const messages = await Message.find({ psid }).sort({ timestamp: 1 });

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // If it's a user message and doesn't have answered field or is false
        if (msg.senderType === 'user' && msg.answered !== true) {
          // Check if there's a bot or human response after this message
          const hasResponse = messages.slice(i + 1).some(
            m => m.senderType === 'bot' || m.senderType === 'human'
          );

          if (hasResponse) {
            await Message.updateOne(
              { _id: msg._id },
              { answered: true }
            );
            updatedCount++;
          } else {
            // Mark as unanswered (false) if no response found
            await Message.updateOne(
              { _id: msg._id },
              { answered: false }
            );
          }
        }
      }
    }

    console.log(`✅ Migration complete! Updated ${updatedCount} messages as answered.`);
    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateAnsweredField();
