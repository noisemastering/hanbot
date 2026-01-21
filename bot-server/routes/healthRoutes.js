// routes/healthRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const ApiHealth = require("../models/ApiHealth");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// Middleware to authenticate dashboard users
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

// GET /health/status - Get current health status for all services
router.get("/status", authenticate, async (req, res) => {
  try {
    const status = await ApiHealth.getCurrentStatus();

    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error getting health status:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching health status"
    });
  }
});

// GET /health/alerts - Get active alerts (unresolved errors)
router.get("/alerts", authenticate, async (req, res) => {
  try {
    const alerts = await ApiHealth.getActiveAlerts();

    res.json({
      success: true,
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error getting alerts:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching alerts"
    });
  }
});

// GET /health/history/:service - Get error history for a specific service
router.get("/history/:service", authenticate, async (req, res) => {
  try {
    const { service } = req.params;
    const { days = 7 } = req.query;

    const validServices = ['openai', 'mercadolibre', 'facebook', 'mongodb'];
    if (!validServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: `Invalid service. Must be one of: ${validServices.join(', ')}`
      });
    }

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    const history = await ApiHealth.find({
      service,
      createdAt: { $gte: since }
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

    res.json({
      success: true,
      service,
      days: parseInt(days),
      history,
      count: history.length
    });
  } catch (error) {
    console.error("❌ Error getting service history:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching service history"
    });
  }
});

// POST /health/resolve/:id - Manually mark an error as resolved
router.post("/resolve/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const record = await ApiHealth.findById(id);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: "Health record not found"
      });
    }

    record.resolved = true;
    record.resolvedAt = new Date();
    await record.save();

    console.log(`✅ Health alert ${id} resolved by ${req.user.username}`);

    res.json({
      success: true,
      message: "Alert resolved",
      record
    });
  } catch (error) {
    console.error("❌ Error resolving alert:", error);
    res.status(500).json({
      success: false,
      error: "Error resolving alert"
    });
  }
});

module.exports = router;
