require('dotenv').config();
const mongoose = require('mongoose');
const Message = require('./models/Message');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // Search for Noemi's takeover message
  const noemiMsg = await Message.findOne({ text: /Noemi Hanlob/i }).sort({ timestamp: -1 });

  if (!noemiMsg) {
    console.log('Could not find Noemi takeover message in DB.');
    console.log('The conversation was likely manually imported or not persisted.');
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  console.log('Found Noemi takeover message!');
  console.log('PSID:', noemiMsg.psid);
  console.log('Timestamp:', noemiMsg.timestamp);
  console.log('\nGetting full conversation...\n');

  // Get all messages from that conversation
  const allMessages = await Message.find({ psid: noemiMsg.psid })
    .sort({ timestamp: 1 });

  console.log('=== FULL CONVERSATION WITH TIMESTAMPS ===\n');
  allMessages.forEach((msg, i) => {
    const timestamp = msg.timestamp ? msg.timestamp.toISOString() : 'NO_TIMESTAMP';
    const timeOnly = timestamp !== 'NO_TIMESTAMP' ? timestamp.split('T')[1].slice(0, 12) : 'NO_TIMESTAMP';
    const sender = msg.senderType || 'unknown';
    console.log(`${i+1}. [${timeOnly}] (${sender.padEnd(6)}) ${msg.text.substring(0, 100)}`);
  });

  await mongoose.disconnect();
  process.exit(0);
})();
