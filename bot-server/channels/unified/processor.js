// Unified Message Processor - Channel-agnostic message processing

const { generateReply } = require('../../ai/index');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const { generateClickLink } = require('../../tracking');
const { sendHandoffNotification } = require('../../services/pushNotifications');

// Message aggregation for handling rapid-fire messages
const {
  aggregateMessage,
  setProcessingLock,
  clearProcessingLock,
  hasPendingMessages
} = require('./messageAggregator');

// Import channel-specific send functions
const { sendTextMessage: sendWhatsAppText } = require('../whatsapp/api');

/**
 * Save message to database and emit via Socket.IO
 */
async function saveMessage(psid, text, senderType, messageId = null, io = null) {
  const answered = senderType === 'user' ? false : undefined;

  const messageData = { psid, text, senderType };
  if (messageId !== null && messageId !== undefined) {
    messageData.messageId = messageId;
  }
  if (answered !== undefined) {
    messageData.answered = answered;
  }

  const msg = await Message.create(messageData);

  // Mark previous user message as answered when bot/human responds
  if (senderType === 'bot' || senderType === 'human') {
    await Message.findOneAndUpdate(
      { psid, senderType: 'user', answered: { $ne: true } },
      { answered: true },
      { sort: { timestamp: -1 } }
    );
  }

  // Emit to Socket.IO if available
  if (io) {
    io.emit('new_message', msg);
  }

  return msg;
}

/**
 * Check if message has been processed (deduplication)
 */
async function isMessageProcessed(messageId) {
  if (!messageId) return false;
  const existing = await Message.findOne({ messageId });
  return !!existing;
}

/**
 * Get or create conversation
 */
async function getOrCreateConversation(unifiedId, channel) {
  let conversation = await Conversation.findOne({ psid: unifiedId });

  if (!conversation) {
    conversation = await Conversation.create({
      psid: unifiedId,
      channel: channel,
      state: 'new',
      lastMessageAt: new Date()
    });
    console.log(`✨ Created new conversation for ${unifiedId} on ${channel}`);
  }

  return conversation;
}

/**
 * Update conversation
 */
async function updateConversation(psid, updates) {
  return await Conversation.findOneAndUpdate(
    { psid },
    { ...updates, lastMessageAt: new Date() },
    { upsert: true, new: true }
  );
}

/**
 * Register user if needed (channel-aware)
 */
async function registerUserIfNeeded(userId, channel, unifiedId) {
  // For WhatsApp, userId is phone number
  // For Facebook, userId is PSID

  let user;
  if (channel === 'whatsapp') {
    user = await User.findOne({ whatsappPhone: userId });

    if (!user) {
      // Create new WhatsApp user
      user = await User.create({
        whatsappPhone: userId,
        channel: 'whatsapp',
        unifiedId: unifiedId,
        first_name: '', // WhatsApp doesn't provide name via API
        last_name: '',
        profile_pic: '',
        last_interaction: new Date()
      });
      console.log(`✅ WhatsApp user registered: ${userId}`);
    }
  } else if (channel === 'facebook') {
    // Existing Facebook user registration logic (unchanged)
    user = await User.findOne({ psid: userId });
    // Facebook registration happens in index.js webhook handler
  }

  return user;
}

/**
 * Send message via appropriate channel
 */
async function sendMessageViaChannel(channel, userId, messageData) {
  if (channel === 'whatsapp') {
    // WhatsApp: userId is phone number
    if (typeof messageData === 'string') {
      await sendWhatsAppText(userId, messageData);
    } else if (messageData.text) {
      await sendWhatsAppText(userId, messageData.text);
    }
  } else if (channel === 'facebook') {
    // Facebook: Use existing callSendAPI (will be called from index.js)
    // This function doesn't handle FB sending directly to avoid circular deps
    console.log('📘 Facebook message handled by existing webhook');
  }
}

/**
 * Process incoming message (channel-agnostic)
 * Uses message aggregation to batch rapid-fire messages from same user
 */
async function processMessage(normalizedMessage, io = null) {
  const {
    channel,
    unifiedId,
    userId,
    messageId,
    text,
    isFromPage,
    recipientId,
    referral
  } = normalizedMessage;

  console.log(`\n📨 Received ${channel} message from ${userId}`);
  console.log(`   Text: "${text}"`);

  // 1. Deduplication
  if (await isMessageProcessed(messageId)) {
    console.log(`⚠️  Duplicate message ${messageId}, skipping`);
    return;
  }

  // 2. Handle human agent messages (no aggregation needed)
  if (isFromPage) {
    console.log(`👨‍💼 Human agent message on ${channel}`);
    const targetPsid = recipientId || unifiedId;
    await saveMessage(targetPsid, text, 'human', messageId, io);
    await updateConversation(targetPsid, { state: 'human_active' });
    return;
  }

  // 3. Register user if needed
  await registerUserIfNeeded(userId, channel, unifiedId);

  // 4. Save incoming message immediately (for dashboard visibility)
  await saveMessage(unifiedId, text, 'user', messageId, io);

  // 5. Aggregate messages - wait for more messages from this user
  // This returns null if this message was batched with others
  const aggregatedMessage = await aggregateMessage(unifiedId, normalizedMessage);

  if (!aggregatedMessage) {
    console.log(`📦 Message batched with others, skipping individual processing`);
    return;
  }

  // Use the combined text if multiple messages were batched
  const processText = aggregatedMessage.text;
  const wasBatched = aggregatedMessage.isBatched;

  if (wasBatched) {
    console.log(`📬 Processing batched messages: "${processText.substring(0, 100)}..."`);
  }

  // 6. Get/create conversation
  const conversation = await getOrCreateConversation(unifiedId, channel);

  // 7. Handle campaign referrals (Facebook and WhatsApp)
  if (referral) {
    if (channel === 'facebook') {
      await updateConversation(unifiedId, {
        lastIntent: 'ad_entry',
        campaignRef: referral.ref || null,
        adId: referral.ad_id || null,
        campaignId: referral.campaign_id || null
      });
    } else if (channel === 'whatsapp') {
      // WhatsApp CTWA (Click-to-WhatsApp) ad referral
      console.log(`📣 WhatsApp ad referral: ad=${referral.source_id}, type=${referral.source_type}`);
      await updateConversation(unifiedId, {
        lastIntent: 'ad_entry',
        adId: referral.source_id || null,
        adHeadline: referral.headline || null,
        adBody: referral.body || null,
        adSourceUrl: referral.source_url || null,
        adSourceType: referral.source_type || null
      });
    }
  }

  // 8. Check if conversation is in human_active state
  if (conversation.state === 'human_active') {
    console.log(`🚫 Conversation in human_active state, bot not responding`);
    return;
  }

  // 9. Set processing lock to queue any new incoming messages
  setProcessingLock(unifiedId);

  try {
    // 10. Generate AI response
    console.log(`🤖 Generating AI response...`);
    const aiResponse = await generateReply(processText, unifiedId, conversation);

    // 11. Check if more messages arrived while processing
    const newMessagesArrived = hasPendingMessages(unifiedId);
    if (newMessagesArrived) {
      console.log(`🔔 New messages arrived while processing - they will be handled next`);
      // We still send this response, but the new messages will trigger another batch
    }

    if (aiResponse && aiResponse.text) {
      console.log(`💬 AI response: "${aiResponse.text.substring(0, 100)}..."`);

      // 12. Send response via appropriate channel
      await sendMessageViaChannel(channel, userId, aiResponse);

      // 13. Save bot response
      await saveMessage(unifiedId, aiResponse.text, 'bot', null, io);

      // 14. Schedule silence follow-up (store link after 5min of inactivity)
      const { scheduleFollowUpIfNeeded } = require('../../jobs/silenceFollowUp');
      scheduleFollowUpIfNeeded(unifiedId, aiResponse.text).catch(err =>
        console.error("❌ Error scheduling silence follow-up:", err.message)
      );

      console.log(`✅ Message processed successfully\n`);
    } else {
      console.log(`⚠️  No AI response generated`);
    }
  } finally {
    // 14. Clear processing lock - this may trigger processing of queued messages
    const queued = clearProcessingLock(unifiedId);
    if (queued) {
      console.log(`📋 Will process ${queued.messages.length} queued message(s) next`);
    }
  }
}

module.exports = {
  processMessage,
  saveMessage,
  isMessageProcessed,
  getOrCreateConversation,
  updateConversation,
  registerUserIfNeeded,
  sendMessageViaChannel
};
