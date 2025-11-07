// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

// GET /analytics - Get analytics data
router.get('/', async (req, res) => {
  try {
    // Total messages
    const totalMessages = await Message.countDocuments();

    // Total unique users
    const uniqueUsers = await Message.distinct('psid');
    const totalUsers = uniqueUsers.length;

    // Bot response rate
    const botMessages = await Message.countDocuments({ senderType: 'bot' });
    const botResponseRate = totalMessages > 0 ? ((botMessages / totalMessages) * 100).toFixed(1) : 0;

    // Unanswered (conversations in pending state or with human_handoff intent)
    const unanswered = await Conversation.countDocuments({
      $or: [
        { state: 'pending' },
        { lastIntent: 'human_handoff' },
        { humanHandoff: true }
      ]
    });

    // Activity per day (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activityData = await Message.aggregate([
      {
        $match: {
          $or: [
            { timestamp: { $gte: sevenDaysAgo } },
            { createdAt: { $gte: sevenDaysAgo } }
          ]
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$timestamp', '$createdAt'] }
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalMessages,
      totalUsers,
      botResponseRate: parseFloat(botResponseRate),
      unanswered,
      activityData: activityData.map(item => ({
        date: item._id,
        messages: item.count
      }))
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
