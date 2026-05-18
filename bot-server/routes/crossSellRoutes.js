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

module.exports = router;
