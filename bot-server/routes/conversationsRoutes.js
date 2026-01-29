// routes/conversationsRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { sendTextMessage: sendWhatsAppText } = require('../channels/whatsapp/api');

/**
 * Send a message via Facebook Messenger
 */
async function sendMessengerMessage(psid, text) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  const response = await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    {
      recipient: { id: psid },
      message: { text },
    },
    {
      headers: {
        Authorization: `Bearer ${FB_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

// GET /conversations - Get all messages with channel information
router.get('/', async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(500)
      .lean();

    // Enrich messages with channel information from Conversation
    const enrichedMessages = await Promise.all(messages.map(async (msg) => {
      const conversation = await Conversation.findOne({ psid: msg.psid }).lean();
      return {
        ...msg,
        channel: conversation?.channel || 'facebook' // Default to facebook for backward compatibility
      };
    }));

    res.json(enrichedMessages);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /conversations/:psid - Get messages for specific user with channel information
router.get('/:psid', async (req, res) => {
  try {
    const messages = await Message.find({ psid: req.params.psid })
      .sort({ timestamp: -1, createdAt: -1 })
      .lean();

    // Get channel information from Conversation
    const conversation = await Conversation.findOne({ psid: req.params.psid }).lean();
    const channel = conversation?.channel || 'facebook';

    // Enrich each message with channel information
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      channel
    }));

    res.json(enrichedMessages);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// POST /conversations/reply - Send a reply to a user (Messenger or WhatsApp)
router.post('/reply', async (req, res) => {
  try {
    const { psid, text } = req.body;

    if (!psid || !text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: psid and text'
      });
    }

    // Get channel from conversation
    const conversation = await Conversation.findOne({ psid }).lean();
    const channel = conversation?.channel || 'facebook';

    console.log(`📤 Sending reply via ${channel} to ${psid}: "${text.substring(0, 50)}..."`);

    // Send message via appropriate channel
    if (channel === 'whatsapp') {
      // WhatsApp: psid is like "wa:5214424891873", extract phone number
      const phoneNumber = psid.startsWith('wa:') ? psid.substring(3) : psid;
      await sendWhatsAppText(phoneNumber, text);
    } else {
      // Facebook Messenger
      await sendMessengerMessage(psid, text);
    }

    // Save message to database
    const message = await Message.create({
      psid,
      text,
      senderType: 'human',
      timestamp: new Date()
    });

    // Update conversation state
    await Conversation.findOneAndUpdate(
      { psid },
      {
        lastMessageAt: new Date(),
        state: 'human_active',
        handoffResolved: true,
        handoffResolvedAt: new Date()
      }
    );

    console.log(`✅ Reply sent and saved via ${channel}`);

    res.json({
      success: true,
      message,
      channel
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send reply'
    });
  }
});

module.exports = router;
