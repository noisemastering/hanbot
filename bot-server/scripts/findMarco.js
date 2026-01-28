const mongoose = require('mongoose');
require('dotenv').config();

async function findConvo() {
  await mongoose.connect(process.env.MONGODB_URI);

  const User = require('../models/User');
  const Message = require('../models/Message');
  const Conversation = require('../models/Conversation');

  // First, search for Marco directly in users
  console.log('=== Searching for Marco in Users ===');
  const allUsers = await User.find({}).lean();
  const marcoUsers = allUsers.filter(u => {
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
    return fullName.includes('marco') || fullName.includes('rodriguez');
  });

  if (marcoUsers.length > 0) {
    console.log('Found Marco users:', marcoUsers.map(u => ({
      psid: u.psid,
      name: `${u.first_name || ''} ${u.last_name || ''}`
    })));

    for (const user of marcoUsers) {
      console.log(`\n=== Messages for ${user.first_name} ${user.last_name} (${user.psid}) ===`);
      const msgs = await Message.find({ psid: user.psid }).sort({ createdAt: -1 }).limit(30).lean();
      msgs.reverse().forEach(m => {
        const text = m.text ? m.text.substring(0, 120) : '[no text]';
        console.log(`[${m.createdAt.toISOString()}] ${m.senderType}: ${text}`);
      });

      const convo = await Conversation.findOne({ psid: user.psid }).lean();
      console.log('\nConversation state:', JSON.stringify(convo, null, 2));
    }
  } else {
    console.log('No Marco users found directly. Checking recent messages...');
  }

  // Also check recent messages in the last hour
  console.log('\n=== Recent messages (last 2 hours) ===');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recentMsgs = await Message.find({ createdAt: { $gte: twoHoursAgo } }).sort({ createdAt: 1 }).lean();
  console.log('Found', recentMsgs.length, 'messages in last 2 hours');

  const startWindow = twoHoursAgo;
  const endWindow = new Date();

  console.log('Searching messages between:', startWindow.toISOString(), 'and', endWindow.toISOString());

  const messages = recentMsgs;

  // Group by psid
  const byPsid = {};
  messages.forEach(m => {
    if (!byPsid[m.psid]) byPsid[m.psid] = [];
    byPsid[m.psid].push(m);
  });

  for (const [psid, msgs] of Object.entries(byPsid)) {
    const user = await User.findOne({ psid }).lean();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';
    console.log(`\n--- PSID: ${psid} (User: ${userName}) ---`);
    msgs.forEach(m => {
      const text = m.text ? m.text.substring(0, 100) : '[no text]';
      console.log(`[${m.createdAt.toISOString()}] ${m.senderType}: ${text}`);
    });

    // Check if this is Marco
    if (userName.toLowerCase().includes('marco')) {
      console.log('\n*** FOUND MARCO! Getting full conversation... ***');
      const allMsgs = await Message.find({ psid }).sort({ createdAt: 1 }).lean();
      console.log('\nFull conversation:');
      allMsgs.forEach(m => {
        const text = m.text ? m.text.substring(0, 150) : '[no text]';
        console.log(`[${m.createdAt.toISOString()}] ${m.senderType}: ${text}`);
      });

      const convo = await Conversation.findOne({ psid }).lean();
      console.log('\nConversation state:', JSON.stringify(convo, null, 2));
    }
  }

  await mongoose.disconnect();
}

findConvo().catch(console.error);
