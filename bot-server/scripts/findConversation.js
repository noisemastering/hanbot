// Script to find conversation by partial PSID
require('dotenv').config();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const partialPSID = process.argv[2] || '244235116506';

async function findConversation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Try to find conversation with partial PSID match
    console.log(`\n🔍 Searching for conversations matching: ${partialPSID}\n`);

    const conversations = await Conversation.find({
      psid: { $regex: partialPSID }
    }).sort({ lastMessageAt: -1 }).limit(5);

    if (conversations.length > 0) {
      console.log(`Found ${conversations.length} matching conversation(s):\n`);
      conversations.forEach((conv, idx) => {
        console.log(`${idx + 1}. PSID: ${conv.psid}`);
        console.log(`   Last Intent: ${conv.lastIntent}`);
        console.log(`   Last Message: ${conv.lastMessageAt}`);
        console.log(`   State: ${conv.state}\n`);
      });
    } else {
      console.log('❌ No conversations found with that partial PSID');

      // Try to find recent conversations that might have asked for catalog
      console.log('\n🔍 Searching for recent catalog requests...\n');
      const catalogConvos = await Conversation.find({
        lastIntent: { $in: ['catalog_overview', 'unknown'] }
      }).sort({ lastMessageAt: -1 }).limit(10);

      console.log(`Found ${catalogConvos.length} recent catalog-related conversations:\n`);
      catalogConvos.forEach((conv, idx) => {
        console.log(`${idx + 1}. PSID: ${conv.psid}`);
        console.log(`   Last Intent: ${conv.lastIntent}`);
        console.log(`   Last Message: ${conv.lastMessageAt}\n`);
      });
    }

    // Also search messages for the catalog request text
    console.log('\n🔍 Searching for messages containing "CATALOGO"...\n');
    const messages = await Message.find({
      text: { $regex: /CATALOGO/i }
    }).sort({ timestamp: -1 }).limit(5);

    if (messages.length > 0) {
      console.log(`Found ${messages.length} message(s) with "CATALOGO":\n`);
      messages.forEach((msg, idx) => {
        console.log(`${idx + 1}. PSID: ${msg.psid}`);
        console.log(`   Message: ${msg.text}`);
        console.log(`   Timestamp: ${msg.timestamp}\n`);
      });
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

findConversation();
