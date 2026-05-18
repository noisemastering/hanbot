const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const CrossSellRule = require("../models/CrossSellRule");

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

// Helper: check if user is admin+
const isAdmin = (user) => ["super_admin", "admin"].includes(user.role);

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ success: false, error: "Not authorized" });
  }
  next();
};

// GET /cross-sell — list all rules
router.get("/", authenticate, requireAdmin, async (req, res) => {
  try {
    const rules = await CrossSellRule.find()
      .populate("sourceProductFamilyId", "name")
      .populate("targetProductFamilyId", "name")
      .sort({ priority: -1, createdAt: -1 });

    res.json({ success: true, data: rules });
  } catch (error) {
    console.error("Error fetching cross-sell rules:", error);
    res.status(500).json({ success: false, error: "Failed to fetch rules" });
  }
});

// POST /cross-sell — create a rule
router.post("/", authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, sourceProductFamilyId, targetProductFamilyId, triggerType, priority, active, conditions, message } = req.body;

    if (!name || !sourceProductFamilyId || !targetProductFamilyId || !triggerType) {
      return res.status(400).json({ success: false, error: "Name, source, target, and trigger type are required" });
    }

    const rule = new CrossSellRule({
      name,
      sourceProductFamilyId,
      targetProductFamilyId,
      triggerType,
      priority: priority || 0,
      active: active !== undefined ? active : true,
      conditions: conditions || {},
      message: message || ""
    });

    await rule.save();

    const populated = await CrossSellRule.findById(rule._id)
      .populate("sourceProductFamilyId", "name")
      .populate("targetProductFamilyId", "name");

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error creating cross-sell rule:", error);
    res.status(500).json({ success: false, error: "Failed to create rule" });
  }
});

// PUT /cross-sell/:id — update a rule
router.put("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const rule = await CrossSellRule.findById(req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    const { name, sourceProductFamilyId, targetProductFamilyId, triggerType, priority, active, conditions, message } = req.body;

    if (name !== undefined) rule.name = name;
    if (sourceProductFamilyId !== undefined) rule.sourceProductFamilyId = sourceProductFamilyId;
    if (targetProductFamilyId !== undefined) rule.targetProductFamilyId = targetProductFamilyId;
    if (triggerType !== undefined) rule.triggerType = triggerType;
    if (priority !== undefined) rule.priority = priority;
    if (active !== undefined) rule.active = active;
    if (conditions !== undefined) rule.conditions = conditions;
    if (message !== undefined) rule.message = message;

    await rule.save();

    const populated = await CrossSellRule.findById(rule._id)
      .populate("sourceProductFamilyId", "name")
      .populate("targetProductFamilyId", "name");

    res.json({ success: true, data: populated });
  } catch (error) {
    console.error("Error updating cross-sell rule:", error);
    res.status(500).json({ success: false, error: "Failed to update rule" });
  }
});

// DELETE /cross-sell/:id — delete a rule
router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const rule = await CrossSellRule.findByIdAndDelete(req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, error: "Rule not found" });
    }

    res.json({ success: true, message: "Rule deleted" });
  } catch (error) {
    console.error("Error deleting cross-sell rule:", error);
    res.status(500).json({ success: false, error: "Failed to delete rule" });
  }
});

// ── MINING ENDPOINTS ──

const { minePatterns, getProgress } = require("../utils/crossSellMiner");
const ClickLog = require("../models/ClickLog");

// GET /cross-sell/stats — Cross-sell performance report
router.get("/stats", authenticate, requireAdmin, async (req, res) => {
  try {
    const rules = await CrossSellRule.find({ 'stats.offered': { $gt: 0 } })
      .populate('sourceProductFamilyId', 'name')
      .populate('targetProductFamilyId', 'name')
      .sort({ 'stats.offered': -1 })
      .lean();

    const totalOffered = rules.reduce((s, r) => s + (r.stats?.offered || 0), 0);
    const totalClicked = rules.reduce((s, r) => s + (r.stats?.clicked || 0), 0);
    const totalConverted = rules.reduce((s, r) => s + (r.stats?.converted || 0), 0);

    // Revenue from cross-sell conversions
    const crossSellRevenue = await ClickLog.aggregate([
      { $match: { crossSellRuleId: { $ne: null }, converted: true } },
      { $group: { _id: null, revenue: { $sum: '$conversionData.totalAmount' }, count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalRules: await CrossSellRule.countDocuments({ active: true }),
          totalOffered,
          totalClicked,
          totalConverted,
          clickRate: totalOffered > 0 ? +(totalClicked / totalOffered * 100).toFixed(1) : 0,
          conversionRate: totalClicked > 0 ? +(totalConverted / totalClicked * 100).toFixed(1) : 0,
          revenue: crossSellRevenue[0]?.revenue || 0
        },
        rules: rules.map(r => ({
          id: r._id,
          name: r.name,
          source: r.sourceProductFamilyId?.name || '—',
          target: r.targetProductFamilyId?.name || '—',
          offered: r.stats?.offered || 0,
          clicked: r.stats?.clicked || 0,
          converted: r.stats?.converted || 0,
          clickRate: r.stats?.offered > 0 ? +((r.stats.clicked || 0) / r.stats.offered * 100).toFixed(1) : 0,
          conversionRate: r.stats?.clicked > 0 ? +((r.stats.converted || 0) / r.stats.clicked * 100).toFixed(1) : 0,
          active: r.active
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cross-sell/mine — Run co-purchase pattern mining
router.post("/mine", authenticate, requireAdmin, async (req, res) => {
  try {
    const { minSupport, minConfidence, crossOrderWindowDays, autoCreate } = req.body;
    // Return immediately, run in background
    res.json({ success: true, data: { status: 'started' } });

    const result = await minePatterns({
      minSupport: minSupport || 3,
      minConfidence: minConfidence || 0.05,
      crossOrderWindowDays: crossOrderWindowDays || 90,
      autoCreate: autoCreate !== false
    });

    console.log(`✅ Mining complete: ${result.qualifiedPairs} pairs, ${result.rulesCreated} rules created`);
  } catch (err) {
    console.error('❌ Mining failed:', err.message);
  }
});

// GET /cross-sell/mine/progress — Check mining progress
router.get("/mine/progress", authenticate, async (req, res) => {
  const progress = getProgress();
  res.json({ success: true, data: progress || { status: 'idle' } });
});

module.exports = router;
