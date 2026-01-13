// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ClickLog = require('../models/ClickLog');
const MercadoLibreAuth = require('../models/MercadoLibreAuth');
const {
  correlateClicksToOrders,
  getConversionStats,
  getRecentConversions
} = require('../utils/conversionCorrelation');

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

// GET /analytics/attribution - Meta to ML attribution tracking
router.get('/attribution', async (req, res) => {
  try {
    const { limit = 50, offset = 0, hasMLAuth, hasClicks } = req.query;

    // Get all PSIDs with click activity
    const clickStats = await ClickLog.aggregate([
      {
        $group: {
          _id: '$psid',
          totalLinks: { $sum: 1 },
          totalClicks: { $sum: { $cond: ['$clicked', 1, 0] } },
          totalConversions: { $sum: { $cond: ['$converted', 1, 0] } },
          lastActivity: { $max: '$createdAt' },
          firstActivity: { $min: '$createdAt' }
        }
      },
      { $sort: { lastActivity: -1 } }
    ]);

    // Get all ML authorizations with PSID
    const mlAuths = await MercadoLibreAuth.find({ active: true })
      .select('psid sellerId sellerInfo authorizedAt lastRefreshedAt')
      .lean();

    // Create PSID lookup map for ML auth
    const mlAuthMap = new Map();
    mlAuths.forEach(auth => {
      if (auth.psid) {
        mlAuthMap.set(auth.psid, auth);
      }
    });

    // Combine data
    let attributionData = clickStats.map(stat => {
      const mlAuth = mlAuthMap.get(stat._id);
      return {
        psid: stat._id,
        meta: {
          totalLinks: stat.totalLinks,
          totalClicks: stat.totalClicks,
          totalConversions: stat.totalConversions,
          clickRate: stat.totalLinks > 0 ? ((stat.totalClicks / stat.totalLinks) * 100).toFixed(2) : 0,
          firstActivity: stat.firstActivity,
          lastActivity: stat.lastActivity
        },
        mercadoLibre: mlAuth ? {
          authorized: true,
          sellerId: mlAuth.sellerId,
          sellerName: mlAuth.sellerInfo?.nickname || 'Unknown',
          sellerEmail: mlAuth.sellerInfo?.email,
          authorizedAt: mlAuth.authorizedAt,
          lastRefreshedAt: mlAuth.lastRefreshedAt,
          // Will be populated when Orders API is certified
          orders: {
            total: 0,
            revenue: 0,
            message: 'Orders API pending certification'
          }
        } : {
          authorized: false
        },
        attribution: {
          hasMetaActivity: true,
          hasMLAuthorization: !!mlAuth,
          conversionStatus: mlAuth ? 'converted_to_ml_auth' : 'clicks_only'
        }
      };
    });

    // Add PSIDs that have ML auth but no click activity
    mlAuths.forEach(auth => {
      if (auth.psid && !clickStats.find(s => s._id === auth.psid)) {
        attributionData.push({
          psid: auth.psid,
          meta: {
            totalLinks: 0,
            totalClicks: 0,
            totalConversions: 0,
            clickRate: 0,
            firstActivity: null,
            lastActivity: null
          },
          mercadoLibre: {
            authorized: true,
            sellerId: auth.sellerId,
            sellerName: auth.sellerInfo?.nickname || 'Unknown',
            sellerEmail: auth.sellerInfo?.email,
            authorizedAt: auth.authorizedAt,
            lastRefreshedAt: auth.lastRefreshedAt,
            orders: {
              total: 0,
              revenue: 0,
              message: 'Orders API pending certification'
            }
          },
          attribution: {
            hasMetaActivity: false,
            hasMLAuthorization: true,
            conversionStatus: 'ml_auth_only'
          }
        });
      }
    });

    // Apply filters
    if (hasMLAuth !== undefined) {
      const filterValue = hasMLAuth === 'true';
      attributionData = attributionData.filter(a => a.mercadoLibre.authorized === filterValue);
    }
    if (hasClicks !== undefined) {
      const filterValue = hasClicks === 'true';
      attributionData = attributionData.filter(a => a.meta.totalClicks > 0 === filterValue);
    }

    // Sort by last activity (Meta or ML)
    attributionData.sort((a, b) => {
      const aDate = a.meta.lastActivity || a.mercadoLibre.authorizedAt || new Date(0);
      const bDate = b.meta.lastActivity || b.mercadoLibre.authorizedAt || new Date(0);
      return new Date(bDate) - new Date(aDate);
    });

    // Pagination
    const total = attributionData.length;
    const paginatedData = attributionData.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    // Summary stats
    const summary = {
      totalPSIDs: attributionData.length,
      withMetaActivity: attributionData.filter(a => a.attribution.hasMetaActivity).length,
      withMLAuthorization: attributionData.filter(a => a.attribution.hasMLAuthorization).length,
      fullyAttributed: attributionData.filter(a => a.attribution.hasMetaActivity && a.attribution.hasMLAuthorization).length,
      conversionRate: attributionData.filter(a => a.attribution.hasMetaActivity).length > 0
        ? ((attributionData.filter(a => a.attribution.hasMLAuthorization && a.attribution.hasMetaActivity).length /
            attributionData.filter(a => a.attribution.hasMetaActivity).length) * 100).toFixed(2)
        : 0
    };

    res.json({
      success: true,
      summary,
      attribution: paginatedData,
      pagination: {
        total,
        offset: parseInt(offset),
        limit: parseInt(limit),
        hasMore: (parseInt(offset) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    console.error('❌ Error fetching attribution data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attribution data',
      details: error.message
    });
  }
});

// GET /analytics/attribution/:psid - Detailed attribution for specific PSID
router.get('/attribution/:psid', async (req, res) => {
  try {
    const { psid } = req.params;

    // Get Meta click activity
    const clickLogs = await ClickLog.find({ psid })
      .select('clickId productName productId originalUrl clicked clickedAt converted convertedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(100);

    const clickStats = {
      totalLinks: clickLogs.length,
      totalClicks: clickLogs.filter(c => c.clicked).length,
      totalConversions: clickLogs.filter(c => c.converted).length,
      clickRate: clickLogs.length > 0 ? ((clickLogs.filter(c => c.clicked).length / clickLogs.length) * 100).toFixed(2) : 0,
      recentActivity: clickLogs.slice(0, 10)
    };

    // Get ML authorization
    const mlAuth = await MercadoLibreAuth.findOne({ psid, active: true })
      .select('-accessToken -refreshToken')
      .lean();

    // Get ML orders (placeholder until Orders API is certified)
    const mlOrders = {
      available: false,
      message: 'Orders API pending Mercado Libre certification',
      total: 0,
      revenue: 0,
      recentOrders: []
    };

    // Build attribution timeline
    const timeline = [];

    // Add click events
    clickLogs.forEach(log => {
      timeline.push({
        timestamp: log.createdAt,
        type: 'meta_link_generated',
        source: 'Meta/Messenger',
        data: {
          productName: log.productName,
          productId: log.productId
        }
      });
      if (log.clicked) {
        timeline.push({
          timestamp: log.clickedAt,
          type: 'meta_link_clicked',
          source: 'Meta/Messenger',
          data: {
            productName: log.productName,
            clickId: log.clickId
          }
        });
      }
    });

    // Add ML authorization event
    if (mlAuth) {
      timeline.push({
        timestamp: mlAuth.authorizedAt,
        type: 'ml_authorization',
        source: 'Mercado Libre',
        data: {
          sellerId: mlAuth.sellerId,
          sellerName: mlAuth.sellerInfo?.nickname
        }
      });
      if (mlAuth.lastRefreshedAt) {
        timeline.push({
          timestamp: mlAuth.lastRefreshedAt,
          type: 'ml_token_refresh',
          source: 'Mercado Libre',
          data: {
            sellerId: mlAuth.sellerId
          }
        });
      }
    }

    // Sort timeline by timestamp descending
    timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      psid,
      meta: {
        stats: clickStats,
        hasActivity: clickLogs.length > 0
      },
      mercadoLibre: {
        authorized: !!mlAuth,
        auth: mlAuth || null,
        orders: mlOrders
      },
      attribution: {
        fullyTracked: clickLogs.length > 0 && !!mlAuth,
        journeyStage: clickLogs.length === 0 && !mlAuth ? 'no_activity' :
                      clickLogs.length > 0 && !mlAuth ? 'meta_engagement' :
                      !clickLogs.length && mlAuth ? 'ml_auth_only' :
                      'fully_attributed'
      },
      timeline: timeline.slice(0, 50) // Last 50 events
    });
  } catch (error) {
    console.error(`❌ Error fetching attribution for PSID ${req.params.psid}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PSID attribution',
      details: error.message
    });
  }
});

// ============================================
// CONVERSION CORRELATION ENDPOINTS
// ============================================

// POST /analytics/correlate-conversions - Run time-based correlation
router.post('/correlate-conversions', async (req, res) => {
  try {
    const {
      sellerId = '482595248',
      timeWindowHours = 48,
      orderLimit = 100,
      dryRun = false
    } = req.body;

    console.log(`\n🚀 Correlation requested:`, {
      sellerId,
      timeWindowHours,
      orderLimit,
      dryRun
    });

    // Run correlation
    const results = await correlateClicksToOrders(sellerId, {
      timeWindowHours,
      orderLimit,
      dryRun
    });

    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error('❌ Error running correlation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run correlation',
      details: error.message
    });
  }
});

// GET /analytics/conversions - Get conversion statistics
router.get('/conversions', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    console.log(`📊 Conversions request - dateFrom: ${dateFrom}, dateTo: ${dateTo}`);

    const stats = await getConversionStats({ dateFrom, dateTo });

    res.json({
      success: true,
      stats,
      filters: { dateFrom, dateTo }
    });
  } catch (error) {
    console.error('❌ Error fetching conversion stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversion stats',
      details: error.message
    });
  }
});

// GET /analytics/conversions/recent - Get recent conversions
router.get('/conversions/recent', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const conversions = await getRecentConversions(parseInt(limit));

    res.json({
      success: true,
      conversions,
      count: conversions.length
    });
  } catch (error) {
    console.error('❌ Error fetching recent conversions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent conversions',
      details: error.message
    });
  }
});

// GET /analytics/conversions/by-psid/:psid - Get conversions for a specific PSID
router.get('/conversions/by-psid/:psid', async (req, res) => {
  try {
    const { psid } = req.params;

    const conversions = await ClickLog.find({
      psid,
      converted: true
    }).sort({ convertedAt: -1 });

    const totalRevenue = conversions.reduce(
      (sum, c) => sum + (c.conversionData?.totalAmount || 0),
      0
    );

    res.json({
      success: true,
      psid,
      conversions,
      count: conversions.length,
      totalRevenue
    });
  } catch (error) {
    console.error(`❌ Error fetching conversions for PSID ${req.params.psid}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PSID conversions',
      details: error.message
    });
  }
});

module.exports = router;
