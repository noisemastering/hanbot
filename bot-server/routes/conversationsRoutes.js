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

// GET /conversations/grouped - Grouped conversations with pagination (replaces old / + N status calls)
router.get('/grouped', async (req, res) => {
  try {
    const { start, end, page = 1, limit = 30, excludePsids } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Build the date match stage
    const dateMatch = {};
    if (start) dateMatch.$gte = new Date(start);
    if (end) dateMatch.$lt = new Date(end);

    // Build exclude list
    const excludeList = excludePsids ? excludePsids.split(',').filter(Boolean) : [];

    const hasDateFilter = !!(start || end);
    const pipeline = [];

    // 1. Optional date filter on messages
    const matchStage = {};
    if (hasDateFilter) matchStage.timestamp = dateMatch;
    if (excludeList.length > 0) matchStage.psid = { $nin: excludeList };
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    // 2. Sort by timestamp desc so $first gives latest
    pipeline.push({ $sort: { timestamp: -1 } });

    // 2b. For unfiltered queries (quick actions), pre-limit to recent messages
    // to avoid scanning the entire collection. 500 messages covers 10+ conversations easily.
    if (!hasDateFilter && excludeList.length === 0) {
      pipeline.push({ $limit: 500 });
    }

    // 3. Group by psid, take latest message info
    pipeline.push({
      $group: {
        _id: '$psid',
        lastMessage: { $first: '$text' },
        lastMessageAt: { $first: '$timestamp' },
        senderType: { $first: '$senderType' },
        messageId: { $first: '$_id' }
      }
    });

    // 4. Lookup conversation metadata
    pipeline.push({
      $lookup: {
        from: 'conversations',
        localField: '_id',
        foreignField: 'psid',
        as: 'conv'
      }
    });
    pipeline.push({ $unwind: { path: '$conv', preserveNullAndEmptyArrays: true } });

    // 5. Project final shape
    pipeline.push({
      $project: {
        _id: 0,
        psid: '$_id',
        lastMessage: 1,
        lastMessageAt: 1,
        senderType: 1,
        channel: { $ifNull: ['$conv.channel', 'facebook'] },
        purchaseIntent: '$conv.purchaseIntent',
        humanActive: {
          $cond: [{ $eq: ['$conv.state', 'human_active'] }, true, false]
        },
        handoffRequested: { $ifNull: ['$conv.handoffRequested', false] },
        handoffReason: '$conv.handoffReason',
        state: '$conv.state'
      }
    });

    // 6. Sort by latest message
    pipeline.push({ $sort: { lastMessageAt: -1 } });

    // Count total only when paginating (date-filtered queries)
    let total = 0;
    if (hasDateFilter) {
      const countPipeline = [...pipeline, { $count: 'total' }];
      const countResult = await Message.aggregate(countPipeline);
      total = countResult.length > 0 ? countResult[0].total : 0;
    }

    // 7. Paginate
    pipeline.push({ $skip: (pageNum - 1) * limitNum });
    pipeline.push({ $limit: limitNum });

    const conversations = await Message.aggregate(pipeline);

    res.json({
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: hasDateFilter ? total : conversations.length,
        pages: hasDateFilter ? Math.ceil(total / limitNum) : 1
      }
    });
  } catch (error) {
    console.error('Error fetching grouped conversations:', error);
    res.status(500).json({ error: 'Failed to fetch grouped conversations' });
  }
});

// GET /conversations - Get all messages with channel information (legacy)
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

// GET /conversations/follow-ups - Get leads with future purchase intent
// IMPORTANT: This route must be before /:psid to avoid matching "follow-ups" as a psid
router.get('/follow-ups', async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'due', 'all'

    const query = {
      'futureInterest.interested': true
    };

    // Filter by status
    if (status === 'pending') {
      query['futureInterest.followedUp'] = { $ne: true };
      query['futureInterest.followUpDate'] = { $gt: new Date() };
    } else if (status === 'due') {
      query['futureInterest.followedUp'] = { $ne: true };
      query['futureInterest.followUpDate'] = { $lte: new Date() };
    }

    const followUps = await Conversation.find(query)
      .sort({ 'futureInterest.followUpDate': 1 })
      .lean();

    // Get last message for each conversation
    const enrichedFollowUps = await Promise.all(followUps.map(async (conv) => {
      const lastMessage = await Message.findOne({ psid: conv.psid })
        .sort({ timestamp: -1 })
        .lean();

      return {
        psid: conv.psid,
        channel: conv.channel || 'facebook',
        futureInterest: conv.futureInterest,
        productInterest: conv.productInterest || conv.futureInterest?.productInterest,
        requestedSize: conv.requestedSize,
        city: conv.city,
        lastMessage: lastMessage?.text,
        lastMessageAt: lastMessage?.timestamp
      };
    }));

    res.json({
      success: true,
      total: enrichedFollowUps.length,
      data: enrichedFollowUps
    });

  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch follow-ups' });
  }
});

// GET /conversations/pending-handoffs - Get after-hours handoffs since last business close
const { wasBusinessHours, getLastBusinessClose } = require('../ai/utils/businessHours');

router.get('/pending-handoffs', async (req, res) => {
  try {
    // Only look at handoffs since the last business close (yesterday 6pm or Friday 6pm)
    const cutoff = getLastBusinessClose();

    const conversations = await Conversation.find({
      handoffRequested: true,
      state: { $in: ['needs_human'] },
      $or: [
        { handoffResolved: false },
        { handoffResolved: { $exists: false } }
      ],
      handoffTimestamp: { $gte: cutoff }
    }).sort({ handoffTimestamp: 1 }).lean();

    const now = new Date();

    const data = conversations.map(conv => {
      const handoffTime = conv.handoffTimestamp ? new Date(conv.handoffTimestamp) : null;
      const isAfterHours = handoffTime ? !wasBusinessHours(handoffTime) : false;
      const waitTimeMinutes = handoffTime ? Math.round((now - handoffTime) / 60000) : null;

      return {
        psid: conv.psid,
        channel: conv.channel || 'facebook',
        handoffReason: conv.handoffReason,
        handoffTimestamp: conv.handoffTimestamp,
        productInterest: conv.productInterest,
        requestedSize: conv.requestedSize,
        city: conv.city,
        stateMx: conv.stateMx,
        currentFlow: conv.currentFlow,
        lastMessageAt: conv.lastMessageAt,
        purchaseIntent: conv.purchaseIntent,
        isAfterHours,
        waitTimeMinutes
      };
    });

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Error fetching pending handoffs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending handoffs' });
  }
});

// POST /conversations/:psid/resolve-handoff - Mark a handoff as resolved
router.post('/:psid/resolve-handoff', async (req, res) => {
  try {
    const { psid } = req.params;

    const result = await Conversation.findOneAndUpdate(
      { psid },
      {
        handoffResolved: true,
        handoffResolvedAt: new Date(),
        handoffRequested: false
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error resolving handoff:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve handoff' });
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

// POST /conversations/:psid/mark-followed-up - Mark a lead as followed up
router.post('/:psid/mark-followed-up', async (req, res) => {
  try {
    const { psid } = req.params;

    const result = await Conversation.findOneAndUpdate(
      { psid },
      {
        'futureInterest.followedUp': true,
        'futureInterest.followedUpAt': new Date()
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({ success: true, data: result.futureInterest });

  } catch (error) {
    console.error('Error marking follow-up:', error);
    res.status(500).json({ success: false, error: 'Failed to mark follow-up' });
  }
});

// ============================================================
// PURCHASE INTENT ENDPOINTS
// ============================================================

const { getScoreExplanation } = require('../ai/utils/purchaseIntentScorer');

// GET /conversations/purchase-intent/stats - Summary stats by intent level
router.get('/purchase-intent/stats', async (req, res) => {
  try {
    const stats = await Conversation.aggregate([
      {
        $match: {
          purchaseIntent: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$purchaseIntent',
          count: { $sum: 1 },
          conversations: {
            $push: {
              psid: '$psid',
              userName: '$userName',
              updatedAt: '$updatedAt'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          intent: '$_id',
          count: 1,
          recentConversations: { $slice: ['$conversations', 5] }
        }
      }
    ]);

    // Format as object for easier consumption
    const formatted = {
      high: { count: 0, recentConversations: [] },
      medium: { count: 0, recentConversations: [] },
      low: { count: 0, recentConversations: [] }
    };

    stats.forEach(s => {
      if (formatted[s.intent]) {
        formatted[s.intent] = {
          count: s.count,
          recentConversations: s.recentConversations
        };
      }
    });

    // Get total conversations for context
    const total = await Conversation.countDocuments({ purchaseIntent: { $exists: true } });

    res.json({
      success: true,
      data: {
        ...formatted,
        total,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// GET /conversations/purchase-intent/leads - Get conversations by intent level
router.get('/purchase-intent/leads', async (req, res) => {
  try {
    const { intent = 'high', limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const conversations = await Conversation.find({
      purchaseIntent: intent
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('psid userName channel state purchaseIntent intentSignals productInterest updatedAt createdAt')
      .lean();

    // Enrich with score explanation
    const enriched = conversations.map(c => ({
      ...c,
      scoreExplanation: c.intentSignals ? getScoreExplanation(c.intentSignals) : []
    }));

    const total = await Conversation.countDocuments({ purchaseIntent: intent });

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent leads:', error);
    res.status(500).json({ success: false, error: 'Failed to get leads' });
  }
});

// GET /conversations/purchase-intent/:psid - Get purchase intent for specific conversation
router.get('/purchase-intent/:psid', async (req, res) => {
  try {
    const { psid } = req.params;

    const conversation = await Conversation.findOne({ psid })
      .select('psid userName purchaseIntent intentSignals isWholesaleInquiry productInterest state')
      .lean();

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      data: {
        ...conversation,
        scoreExplanation: conversation.intentSignals ? getScoreExplanation(conversation.intentSignals) : [],
        intentEmoji: conversation.purchaseIntent === 'high' ? '🟢' :
                     conversation.purchaseIntent === 'low' ? '🔴' : '🟡'
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent:', error);
    res.status(500).json({ success: false, error: 'Failed to get purchase intent' });
  }
});

module.exports = router;
