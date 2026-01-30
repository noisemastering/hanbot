// routes/clickLogsRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const ClickLog = require("../models/ClickLog");
const DashboardUser = require("../models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");

    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

// Apply authentication to all routes
router.use(authenticate);

// GET /click-logs - Get all click logs with pagination and filtering
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      psid,
      clicked,
      converted,
      productId,
      campaignId,
      adSetId,
      adId,
      startDate,
      endDate
    } = req.query;

    // Build filter
    const filter = {};
    if (psid) filter.psid = psid;
    if (clicked !== undefined) filter.clicked = clicked === 'true';
    if (converted !== undefined) filter.converted = converted === 'true';
    if (productId) filter.productId = productId;
    if (campaignId) filter.campaignId = campaignId;
    if (adSetId) filter.adSetId = adSetId;
    if (adId) filter.adId = adId;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate + 'T00:00:00');
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999');
    }

    const skip = (page - 1) * limit;

    const [clickLogs, total] = await Promise.all([
      ClickLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      ClickLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      clickLogs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching click logs:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching click logs"
    });
  }
});

// GET /click-logs/stats - Get overall statistics
router.get("/stats", async (req, res) => {
  try {
    const { startDate, endDate, campaignId, adSetId, adId } = req.query;

    // Run correlation in background (non-blocking) to catch any missed orders
    runBackgroundCorrelation().catch(err => {
      console.error("Background correlation error:", err.message);
    });

    // Build filter
    const filter = {};
    if (campaignId) filter.campaignId = campaignId;
    if (adSetId) filter.adSetId = adSetId;
    if (adId) filter.adId = adId;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate + 'T00:00:00');
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999');
    }

    const Conversation = require("../models/Conversation");

    const [
      totalLinks,
      totalClicks,
      totalConversions,
      uniqueUsers,
      topProduct,
      busiestDay,
      topAd,
      handovers
    ] = await Promise.all([
      ClickLog.countDocuments(filter),
      ClickLog.countDocuments({ ...filter, clicked: true }),
      ClickLog.countDocuments({ ...filter, converted: true }),
      ClickLog.distinct('psid', filter).then(arr => arr.length),
      // Most popular product (by clicks)
      ClickLog.aggregate([
        { $match: { ...filter, clicked: true, productName: { $exists: true, $ne: null } } },
        { $group: { _id: "$productName", clicks: { $sum: 1 } } },
        { $sort: { clicks: -1 } },
        { $limit: 1 }
      ]).then(res => res[0] || null),
      // Busiest day
      ClickLog.aggregate([
        { $match: { ...filter, clicked: true } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } },
          clicks: { $sum: 1 }
        }},
        { $sort: { clicks: -1 } },
        { $limit: 1 }
      ]).then(res => res[0] || null),
      // Top ad (by clicks)
      ClickLog.aggregate([
        { $match: { ...filter, clicked: true, adId: { $exists: true, $ne: null } } },
        { $group: { _id: "$adId", clicks: { $sum: 1 } } },
        { $sort: { clicks: -1 } },
        { $limit: 1 }
      ]).then(res => res[0] || null),
      // Handovers count
      Conversation.countDocuments({
        handoffRequested: true,
        ...(startDate || endDate ? {
          handoffTimestamp: {
            ...(startDate ? { $gte: new Date(startDate + 'T00:00:00') } : {}),
            ...(endDate ? { $lte: new Date(endDate + 'T23:59:59.999') } : {})
          }
        } : {})
      })
    ]);

    res.json({
      success: true,
      stats: {
        totalLinks,
        totalClicks,
        totalConversions,
        uniqueUsers,
        clickRate: totalLinks > 0 ? ((totalClicks / totalLinks) * 100).toFixed(2) : 0,
        conversionRate: totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : 0,
        topProduct: topProduct ? { name: topProduct._id, clicks: topProduct.clicks } : null,
        busiestDay: busiestDay ? {
          date: busiestDay._id,
          dateLabel: new Date(busiestDay._id + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', month: 'short', day: 'numeric' }),
          clicks: busiestDay.clicks
        } : null,
        topAd: topAd ? { adId: topAd._id, clicks: topAd.clicks } : null,
        handovers
      }
    });
  } catch (error) {
    console.error("Error fetching click stats:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching click statistics"
    });
  }
});

// GET /click-logs/daily - Get daily aggregated data for charts
router.get("/daily", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate + 'T00:00:00');
    if (endDate) dateFilter.$lte = new Date(endDate + 'T23:59:59.999');

    // Aggregate links created per day
    const linksPerDay = await ClickLog.aggregate([
      { $match: dateFilter.$gte ? { createdAt: dateFilter } : {} },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          links: { $sum: 1 },
          clicks: { $sum: { $cond: ["$clicked", 1, 0] } },
          conversions: { $sum: { $cond: ["$converted", 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format for chart
    const chartData = linksPerDay.map(day => ({
      date: day._id,
      dateLabel: new Date(day._id + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
      links: day.links,
      clicks: day.clicks,
      conversions: day.conversions
    }));

    res.json({
      success: true,
      chartData
    });
  } catch (error) {
    console.error("Error fetching daily stats:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching daily statistics"
    });
  }
});

// Background correlation function - runs without blocking the response
async function runBackgroundCorrelation() {
  try {
    const { correlateOrders } = require("../utils/conversionCorrelation");
    const { getOrders } = require("../utils/mercadoLibreOrders");
    const MercadoLibreAuth = require("../models/MercadoLibreAuth");

    // Get active seller
    const seller = await MercadoLibreAuth.findOne({ active: true });
    if (!seller) return;

    const sellerId = seller.sellerId;

    // Get orders from last 7 days
    const endDate = new Date();
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    console.log("🔄 Running background correlation check...");

    const ordersResult = await getOrders(sellerId, {
      dateFrom: startDate.toISOString().replace('Z', '-00:00'),
      dateTo: endDate.toISOString().replace('Z', '-00:00'),
      limit: 50
    });
    if (!ordersResult.success || !ordersResult.orders?.length) return;

    // Filter to paid orders only
    const paidOrders = ordersResult.orders.filter(o => o.status === 'paid');
    if (paidOrders.length === 0) return;

    const result = await correlateOrders(paidOrders, sellerId);

    if (result.correlated > 0) {
      console.log(`✅ Background correlation: ${result.correlated} new correlations found`);
    }
  } catch (error) {
    // Silent fail - don't disrupt the main request
    console.error("Background correlation error:", error.message);
  }
}

// GET /click-logs/by-user/:psid - Get click logs for a specific user
router.get("/by-user/:psid", async (req, res) => {
  try {
    const { psid } = req.params;
    const { limit = 20 } = req.query;

    const clickLogs = await ClickLog.find({ psid })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const stats = {
      total: await ClickLog.countDocuments({ psid }),
      clicked: await ClickLog.countDocuments({ psid, clicked: true }),
      converted: await ClickLog.countDocuments({ psid, converted: true })
    };

    stats.clickRate = stats.total > 0 ? ((stats.clicked / stats.total) * 100).toFixed(2) : 0;
    stats.conversionRate = stats.clicked > 0 ? ((stats.converted / stats.clicked) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      clickLogs,
      stats
    });
  } catch (error) {
    console.error("Error fetching user click logs:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user click logs"
    });
  }
});

// GET /click-logs/by-product/:productId - Get click logs for a specific product
router.get("/by-product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const clickLogs = await ClickLog.find({ productId })
      .sort({ createdAt: -1 })
      .limit(100);

    const stats = {
      total: await ClickLog.countDocuments({ productId }),
      clicked: await ClickLog.countDocuments({ productId, clicked: true }),
      converted: await ClickLog.countDocuments({ productId, converted: true }),
      uniqueUsers: (await ClickLog.distinct('psid', { productId })).length
    };

    stats.clickRate = stats.total > 0 ? ((stats.clicked / stats.total) * 100).toFixed(2) : 0;
    stats.conversionRate = stats.clicked > 0 ? ((stats.converted / stats.clicked) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      clickLogs,
      stats
    });
  } catch (error) {
    console.error("Error fetching product click logs:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching product click logs"
    });
  }
});

// POST /click-logs/:clickId/conversion - Mark a click as converted
router.post("/:clickId/conversion", async (req, res) => {
  try {
    const { clickId } = req.params;
    const { conversionData } = req.body;

    const clickLog = await ClickLog.findOneAndUpdate(
      { clickId },
      {
        converted: true,
        convertedAt: new Date(),
        conversionData: conversionData || {}
      },
      { new: true }
    );

    if (!clickLog) {
      return res.status(404).json({
        success: false,
        error: "Click log not found"
      });
    }

    res.json({
      success: true,
      clickLog
    });
  } catch (error) {
    console.error("Error recording conversion:", error);
    res.status(500).json({
      success: false,
      error: "Error recording conversion"
    });
  }
});

// POST /click-logs/generate - Generate a tracked link for human agents
router.post("/generate", async (req, res) => {
  try {
    const { psid, productId, productName, originalUrl, campaignId, adSetId, adId } = req.body;

    // Validate required fields
    if (!psid || !originalUrl) {
      return res.status(400).json({
        success: false,
        error: "PSID and original URL are required"
      });
    }

    const { randomUUID } = require('crypto');
    const clickId = randomUUID().slice(0, 8);

    // Create the click log entry
    const clickLog = new ClickLog({
      clickId,
      psid,
      originalUrl,
      productName: productName || "Manual link",
      productId: productId || null,
      campaignId: campaignId || null,
      adSetId: adSetId || null,
      adId: adId || null
    });

    await clickLog.save();

    // Generate the tracked URL
    const baseUrl = process.env.BASE_URL || 'https://hanbot-production.up.railway.app';
    const trackedUrl = `${baseUrl}/r/${clickId}`;

    console.log(`🔗 Generated tracked link for agent: ${trackedUrl} -> ${originalUrl}`);

    res.json({
      success: true,
      clickLog: {
        clickId,
        trackedUrl,
        originalUrl,
        productName,
        psid
      }
    });
  } catch (error) {
    console.error("Error generating tracked link:", error);
    res.status(500).json({
      success: false,
      error: "Error generating tracked link"
    });
  }
});

// GET /click-logs/products - Get products for tracked link generation
router.get("/products", async (req, res) => {
  try {
    const Product = require("../models/Product");
    const { search, limit = 10 } = req.query;

    let filter = {};
    if (search) {
      const regex = new RegExp(search, 'i');
      filter = {
        $or: [
          { name: regex },
          { description: regex },
          { category: regex }
        ]
      };
    }

    const products = await Product.find(filter)
      .select("name description price imageUrl mLink permalink")
      .limit(parseInt(limit))
      .sort({ name: 1 });

    res.json({
      success: true,
      products: products.map(p => ({
        _id: p._id,
        name: p.name,
        description: p.description,
        price: p.price,
        imageUrl: p.imageUrl,
        originalUrl: p.mLink || p.permalink || ""
      }))
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching products"
    });
  }
});

module.exports = router;
