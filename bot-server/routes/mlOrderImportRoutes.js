const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) return res.status(401).json({ success: false, error: "Invalid token" });
    req.user = user;
    next();
  } catch { return res.status(401).json({ success: false, error: "Invalid or expired token" }); }
};
const MLOrder = require("../models/MLOrder");
const MLProductMapping = require("../models/MLProductMapping");
const { importAllOrders, getProgress, stopImport } = require("../utils/mlOrderImport");
const { bootstrapFromExistingLinks, normalizeUnmapped, applyMappingsToOrders, getUnmappedTitles, getStats, getNormProgress } = require("../utils/mlProductNormalization");

// POST /ml/import/start/:sellerId — Start historical import
router.post("/import/start/:sellerId", authenticate, async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { startDate, fullResync } = req.body;
    const result = await importAllOrders(sellerId, {
      startDate: startDate ? new Date(startDate) : undefined,
      fullResync: fullResync || false
    });
    if (result.error) return res.status(409).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/import/progress/:sellerId — Check import progress
router.get("/import/progress/:sellerId", authenticate, async (req, res) => {
  const progress = getProgress(req.params.sellerId);
  if (!progress) return res.json({ success: true, data: { status: 'idle' } });
  res.json({ success: true, data: progress });
});

// POST /ml/import/stop/:sellerId — Cancel running import
router.post("/import/stop/:sellerId", authenticate, async (req, res) => {
  const stopped = stopImport(req.params.sellerId);
  res.json({ success: true, stopped });
});

// GET /ml/import/stats — Import and normalization stats
router.get("/import/stats", authenticate, async (req, res) => {
  try {
    const stats = await getStats();

    // Date range of imported orders
    const oldest = await MLOrder.findOne().sort({ dateCreated: 1 }).select('dateCreated').lean();
    const newest = await MLOrder.findOne().sort({ dateCreated: -1 }).select('dateCreated').lean();

    res.json({
      success: true,
      data: {
        ...stats,
        dateRange: {
          from: oldest?.dateCreated || null,
          to: newest?.dateCreated || null
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/import/unmapped — List unmapped item titles
router.get("/import/unmapped", authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const unmapped = await getUnmappedTitles(limit);
    res.json({ success: true, data: unmapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /ml/import/normalize — Run AI normalization (async, returns immediately)
router.post("/import/normalize", authenticate, async (req, res) => {
  try {
    // Return immediately, run in background
    res.json({ success: true, data: { status: 'started' } });

    // Bootstrap from existing ML links first
    await bootstrapFromExistingLinks();

    // AI-match remaining
    await normalizeUnmapped({
      batchSize: req.body.batchSize || 10,
      limit: req.body.limit || 200,
      progressKey: 'default'
    });

    // Apply all mappings to orders
    await applyMappingsToOrders();
  } catch (err) {
    console.error('❌ Normalization error:', err.message);
  }
});

// GET /ml/import/normalize/progress — Poll normalization progress
router.get("/import/normalize/progress", authenticate, async (req, res) => {
  const progress = getNormProgress('default');
  res.json({ success: true, data: progress || { status: 'idle' } });
});

// GET /ml/import/mappings — List all mappings
router.get("/import/mappings", authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.reviewed === 'true') filter.reviewed = true;
    if (req.query.reviewed === 'false') filter.reviewed = false;
    if (req.query.confidence) filter.confidence = req.query.confidence;
    if (req.query.unmapped === 'true') filter.productFamilyId = null;

    const mappings = await MLProductMapping.find(filter)
      .populate('productFamilyId', 'name size')
      .sort({ orderCount: -1 })
      .limit(parseInt(req.query.limit) || 200)
      .lean();

    res.json({ success: true, data: mappings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /ml/import/mappings/:id — Manually correct a mapping
router.put("/import/mappings/:id", authenticate, async (req, res) => {
  try {
    const { productFamilyId, confidence } = req.body;
    const mapping = await MLProductMapping.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          productFamilyId: productFamilyId || null,
          confidence: confidence || 'high',
          matchedBy: 'manual',
          reviewed: true,
          reviewedBy: req.user._id,
          reviewedAt: new Date()
        }
      },
      { new: true }
    ).populate('productFamilyId', 'name size');

    if (!mapping) return res.status(404).json({ success: false, error: 'Mapping not found' });

    // Apply this mapping to orders
    if (mapping.productFamilyId) {
      await MLOrder.updateMany(
        { 'items.title': mapping.mlItemTitle },
        {
          $set: {
            'items.$[elem].productFamilyId': mapping.productFamilyId._id,
            'items.$[elem].mappingConfidence': mapping.confidence
          }
        },
        { arrayFilters: [{ 'elem.title': mapping.mlItemTitle }] }
      );
    }

    res.json({ success: true, data: mapping });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /ml/import/mappings/:id — Delete a mapping
router.delete("/import/mappings/:id", authenticate, async (req, res) => {
  try {
    const mapping = await MLProductMapping.findByIdAndDelete(req.params.id);
    if (!mapping) return res.status(404).json({ success: false, error: 'Mapping not found' });

    // Revert order items to unmapped
    await MLOrder.updateMany(
      { 'items.title': mapping.mlItemTitle },
      {
        $set: {
          'items.$[elem].productFamilyId': null,
          'items.$[elem].mappingConfidence': null
        }
      },
      { arrayFilters: [{ 'elem.title': mapping.mlItemTitle }] }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/import/revenue-by-month — Monthly revenue from imported orders (for forecasting)
router.get("/import/revenue-by-month", authenticate, async (req, res) => {
  try {
    const pipeline = [
      { $match: { status: 'paid' } },
      { $group: {
        _id: {
          year: { $year: '$dateCreated' },
          month: { $month: '$dateCreated' }
        },
        revenue: { $sum: '$totalAmount' },
        orders: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ];

    const results = await MLOrder.aggregate(pipeline);
    const monthly = results.map(r => ({
      year: r._id.year,
      month: r._id.month,
      label: `${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][r._id.month - 1]} ${r._id.year}`,
      revenue: Math.round(r.revenue),
      orders: r.orders
    }));

    res.json({ success: true, data: monthly });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
