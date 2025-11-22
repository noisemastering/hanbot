// routes/conversationsRoutes.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

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

module.exports = router;
