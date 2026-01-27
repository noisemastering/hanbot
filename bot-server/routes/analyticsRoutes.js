// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ClickLog = require('../models/ClickLog');
const MercadoLibreAuth = require('../models/MercadoLibreAuth');
const { correlateOrders } = require('../utils/conversionCorrelation');
const { getOrders } = require('../utils/mercadoLibreOrders');

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

// GET /analytics/conversions - Get conversion/attribution stats for orders view
// Returns FB attributed conversions and ML order totals for a date range
router.get('/conversions', async (req, res) => {
  try {
    const { dateFrom, dateTo, sellerId = '482595248' } = req.query;

    // Auto-sync: correlate recent orders before returning stats
    try {
      const ordersResult = await getOrders(sellerId, { limit: 50, sort: 'date_desc' });
      if (ordersResult.success) {
        const paidOrders = ordersResult.orders.filter(o => o.status === 'paid');
        if (paidOrders.length > 0) {
          const correlationResult = await correlateOrders(paidOrders, sellerId);
          console.log(`🔄 Auto-sync: ${correlationResult.correlated} new correlations`);
        }
      }
    } catch (syncError) {
      console.error('⚠️ Auto-sync failed (continuing with cached data):', syncError.message);
    }

    // Build date filter for clicks
    const dateFilter = {};
    if (dateFrom) {
      dateFilter.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      dateFilter.$lte = new Date(dateTo);
    }

    // Build query for all links in date range
    const allLinksQuery = {};
    if (Object.keys(dateFilter).length > 0) {
      allLinksQuery.createdAt = dateFilter;
    }

    // Get all click stats
    const totalLinks = await ClickLog.countDocuments(allLinksQuery);
    const clickedLinks = await ClickLog.countDocuments({ ...allLinksQuery, clicked: true });

    // Query for conversions
    const conversionQuery = { converted: true };
    if (Object.keys(dateFilter).length > 0) {
      conversionQuery.$or = [
        { 'conversionData.orderDate': dateFilter },
        { convertedAt: dateFilter },
        { createdAt: dateFilter }
      ];
    }

    // Get attributed conversions
    const attributedClicks = await ClickLog.find(conversionQuery).lean();
    const conversions = attributedClicks.length;

    // Calculate attributed revenue
    const totalRevenue = attributedClicks.reduce((sum, click) => {
      return sum + (click.conversionData?.totalAmount || click.conversionData?.paidAmount || 0);
    }, 0);

    // Confidence breakdown
    const confidenceBreakdown = { high: 0, medium: 0, low: 0 };
    attributedClicks.forEach(click => {
      const conf = click.correlationConfidence || 'low';
      if (confidenceBreakdown[conf] !== undefined) {
        confidenceBreakdown[conf]++;
      }
    });

    // Top converters (by PSID)
    const topConverters = await ClickLog.aggregate([
      { $match: conversionQuery },
      {
        $group: {
          _id: '$psid',
          conversions: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } }
        }
      },
      { $sort: { conversions: -1 } },
      { $limit: 5 }
    ]);

    // Calculate rates
    const clickRate = totalLinks > 0 ? ((clickedLinks / totalLinks) * 100).toFixed(1) : '0';
    const conversionRate = clickedLinks > 0 ? ((conversions / clickedLinks) * 100).toFixed(1) : '0';

    res.json({
      success: true,
      stats: {
        totalLinks,
        clickedLinks,
        clickRate,
        conversions,
        conversionRate,
        totalRevenue,
        confidenceBreakdown,
        topConverters
      },
      dateRange: {
        from: dateFrom || 'not specified',
        to: dateTo || 'not specified'
      }
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

// GET /analytics/conversions/recent - Get recent conversions for display
router.get('/conversions/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get recent converted clicks
    const recentConversions = await ClickLog.find({ converted: true })
      .sort({ convertedAt: -1, clickedAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      conversions: recentConversions.map(click => ({
        clickId: click._id,
        psid: click.psid,
        productName: click.productName,
        productId: click.productId,
        clickedAt: click.clickedAt,
        convertedAt: click.convertedAt,
        correlationConfidence: click.correlationConfidence,
        conversionData: click.conversionData
      }))
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

// POST /analytics/correlate-conversions - Run correlation (dashboard format)
router.post('/correlate-conversions', async (req, res) => {
  try {
    const { sellerId = '482595248', timeWindowHours = 48, orderLimit = 100, dryRun = false } = req.body;

    console.log(`🔄 Running correlation: seller=${sellerId}, window=${timeWindowHours}h, limit=${orderLimit}, dryRun=${dryRun}`);

    // Fetch recent orders from ML API
    const ordersResult = await getOrders(sellerId, {
      limit: parseInt(orderLimit),
      sort: 'date_desc'
    });

    if (!ordersResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch orders from ML API',
        details: ordersResult.error
      });
    }

    // Filter to paid orders only
    const paidOrders = ordersResult.orders.filter(o => o.status === 'paid');
    console.log(`📦 Found ${paidOrders.length} paid orders out of ${ordersResult.orders.length} total`);

    // For each order, try to find a matching click
    const correlations = [];
    let ordersWithClicks = 0;
    const matchedClickIds = new Set(); // Track clicks already matched in this run

    for (const order of paidOrders) {
      // Skip if order already has a correlation in ClickLog
      const existingCorrelation = await ClickLog.findOne({
        'conversionData.orderId': order.id
      }).lean();

      if (existingCorrelation) {
        console.log(`⏭️ Order ${order.id} already correlated to click ${existingCorrelation._id}`);
        continue;
      }

      // Look for clicks that match this order
      const orderDate = new Date(order.date_created);
      const windowStart = new Date(orderDate.getTime() - (timeWindowHours * 60 * 60 * 1000));

      // Find click logs that could match this order (not yet converted)
      const matchingClicks = await ClickLog.find({
        clicked: true,
        converted: { $ne: true },
        clickedAt: { $gte: windowStart, $lte: orderDate }
      }).sort({ clickedAt: -1 }).limit(10).lean();

      // Filter out clicks already matched in this run
      const availableClicks = matchingClicks.filter(c => !matchedClickIds.has(c._id.toString()));

      if (availableClicks.length > 0) {
        ordersWithClicks++;

        // Find the best match (by product if possible, or most recent)
        let bestMatch = availableClicks[0];
        const orderItemTitle = order.order_items?.[0]?.item?.title?.toLowerCase() || '';

        for (const click of availableClicks) {
          const clickProduct = (click.productName || '').toLowerCase();
          if (orderItemTitle.includes(clickProduct) || clickProduct.includes(orderItemTitle.split(' ')[0])) {
            bestMatch = click;
            break;
          }
        }

        // Mark this click as matched for this run
        matchedClickIds.add(bestMatch._id.toString());

        // Determine confidence
        const timeDiff = orderDate - new Date(bestMatch.clickedAt);
        const hoursApart = timeDiff / (1000 * 60 * 60);
        let confidence = 'low';
        if (hoursApart < 2) confidence = 'high';
        else if (hoursApart < 12) confidence = 'medium';

        correlations.push({
          clickId: bestMatch._id,
          psid: bestMatch.psid,
          productName: bestMatch.productName,
          orderId: order.id,
          totalAmount: order.total_amount,
          buyerNickname: order.buyer?.nickname,
          confidence,
          timeDiff: `${hoursApart.toFixed(1)}h`
        });

        // If not dry run, update the click log
        if (!dryRun) {
          await ClickLog.updateOne(
            { _id: bestMatch._id },
            {
              $set: {
                converted: true,
                convertedAt: orderDate,
                correlationConfidence: confidence,
                conversionData: {
                  orderId: order.id,
                  orderStatus: order.status,
                  totalAmount: order.total_amount,
                  paidAmount: order.paid_amount,
                  buyerNickname: order.buyer?.nickname,
                  orderDate: order.date_created
                }
              }
            }
          );
          console.log(`✅ Correlated order ${order.id} → click ${bestMatch._id}`);
        }
      }
    }

    res.json({
      success: true,
      dryRun,
      ordersProcessed: paidOrders.length,
      ordersWithClicks,
      clicksCorrelated: correlations.length,
      correlations: dryRun ? correlations : undefined
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

// POST /analytics/correlate - Run correlation on existing orders (legacy)
// This will match ML orders with ClickLog entries based on city + timestamp
router.post('/correlate', async (req, res) => {
  try {
    const { sellerId = '482595248', dateFrom, dateTo, limit = 100 } = req.body;

    console.log(`🔄 Starting batch correlation for seller ${sellerId}...`);

    // Convert dates to ML API format
    const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000-00:00` : undefined;
    const dateToISO = dateTo ? `${dateTo}T23:59:59.000-00:00` : undefined;

    // Fetch orders from ML API
    const ordersResult = await getOrders(sellerId, {
      dateFrom: dateFromISO,
      dateTo: dateToISO,
      limit: parseInt(limit),
      sort: 'date_desc'
    });

    if (!ordersResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch orders from ML API'
      });
    }

    // Filter to only paid orders
    const paidOrders = ordersResult.orders.filter(o => o.status === 'paid');

    console.log(`📦 Found ${ordersResult.orders.length} orders, ${paidOrders.length} paid`);

    // Run correlation on paid orders
    const correlationResult = await correlateOrders(paidOrders, sellerId);

    res.json({
      success: true,
      message: `Correlation complete for ${paidOrders.length} paid orders`,
      results: {
        totalOrders: ordersResult.orders.length,
        paidOrders: paidOrders.length,
        newCorrelations: correlationResult.correlated,
        alreadyCorrelated: correlationResult.alreadyCorrelated,
        noMatch: correlationResult.noMatch,
        errors: correlationResult.errors
      },
      details: correlationResult.details
    });
  } catch (error) {
    console.error('❌ Error running batch correlation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run correlation',
      details: error.message
    });
  }
});

// GET /analytics/correlation-stats - Get correlation statistics
router.get('/correlation-stats', async (req, res) => {
  try {
    // Get conversion stats by confidence level
    const stats = await ClickLog.aggregate([
      {
        $match: { converted: true }
      },
      {
        $group: {
          _id: '$correlationConfidence',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$conversionData.totalAmount' }
        }
      }
    ]);

    // Get total clicks with city info
    const clicksWithCity = await ClickLog.countDocuments({
      clicked: true,
      city: { $exists: true, $ne: null, $ne: '' }
    });

    const totalClicks = await ClickLog.countDocuments({ clicked: true });
    const totalConverted = await ClickLog.countDocuments({ converted: true });

    // Format stats by confidence
    const byConfidence = {
      high: { count: 0, revenue: 0 },
      medium: { count: 0, revenue: 0 },
      low: { count: 0, revenue: 0 }
    };

    stats.forEach(s => {
      if (s._id && byConfidence[s._id]) {
        byConfidence[s._id].count = s.count;
        byConfidence[s._id].revenue = s.totalRevenue || 0;
      }
    });

    res.json({
      success: true,
      stats: {
        totalClicks,
        clicksWithCity,
        cityTrackingRate: totalClicks > 0 ? ((clicksWithCity / totalClicks) * 100).toFixed(1) : 0,
        totalConverted,
        conversionRate: totalClicks > 0 ? ((totalConverted / totalClicks) * 100).toFixed(1) : 0,
        byConfidence
      }
    });
  } catch (error) {
    console.error('❌ Error fetching correlation stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /analytics/top-products - Get top selling products through ads
router.get('/top-products', async (req, res) => {
  try {
    const result = await ClickLog.aggregate([
      {
        $match: {
          converted: true,
          productName: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        $group: {
          _id: '$productName',
          productId: { $first: '$productId' },
          conversions: { $sum: 1 },
          totalRevenue: { $sum: '$conversionData.totalAmount' }
        }
      },
      { $sort: { conversions: -1 } },
      { $limit: 10 }
    ]);

    const topProduct = result[0] || null;

    res.json({
      success: true,
      topProduct,
      allProducts: result
    });
  } catch (error) {
    console.error('❌ Error fetching top products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /analytics/ad-metrics - Get aggregated ad metrics (impressions, clicks, CTR)
router.get('/ad-metrics', async (req, res) => {
  try {
    const Ad = require('../models/Ad');

    const result = await Ad.aggregate([
      {
        $group: {
          _id: null,
          totalImpressions: { $sum: '$metrics.impressions' },
          totalClicks: { $sum: '$metrics.clicks' },
          totalSpend: { $sum: '$metrics.spend' },
          totalConversions: { $sum: '$metrics.conversions' }
        }
      }
    ]);

    const metrics = result[0] || {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalConversions: 0
    };

    // Calculate rates
    metrics.ctr = metrics.totalImpressions > 0
      ? ((metrics.totalClicks / metrics.totalImpressions) * 100).toFixed(2)
      : 0;
    metrics.conversionRate = metrics.totalClicks > 0
      ? ((metrics.totalConversions / metrics.totalClicks) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error('❌ Error fetching ad metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /analytics/clicks-by-ad - Get click stats aggregated by ad
router.get('/clicks-by-ad', async (req, res) => {
  try {
    // Aggregate clicks from ClickLog grouped by adId
    const clickStats = await ClickLog.aggregate([
      {
        $match: {
          adId: { $ne: null },
          clicked: true
        }
      },
      {
        $group: {
          _id: '$adId',
          clicks: { $sum: 1 },
          conversions: {
            $sum: { $cond: ['$converted', 1, 0] }
          }
        }
      },
      { $sort: { clicks: -1 } }
    ]);

    // Get ad details for the top ads (adId in ClickLog is the Facebook Ad ID = fbAdId)
    const Ad = require('../models/Ad');
    const fbAdIds = clickStats.map(s => s._id);
    const ads = await Ad.find({ fbAdId: { $in: fbAdIds } }).lean();

    // Merge ad details with click stats
    const result = clickStats.map(stat => {
      const ad = ads.find(a => a.fbAdId === stat._id);
      return {
        adId: stat._id,
        mongoId: ad?._id,
        name: ad?.name || 'Unknown Ad',
        clicks: stat.clicks,
        conversions: stat.conversions,
        conversionRate: stat.clicks > 0 ? ((stat.conversions / stat.clicks) * 100).toFixed(1) : 0
      };
    });

    // Find best ad (most clicks)
    const bestAd = result.length > 0 ? result[0] : null;

    res.json({
      success: true,
      bestAd,
      allAds: result
    });
  } catch (error) {
    console.error('❌ Error fetching clicks by ad:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
