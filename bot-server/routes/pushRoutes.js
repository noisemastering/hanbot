// routes/pushRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const PushSubscription = require("../models/PushSubscription");
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
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
};

// GET /push/vapid-key - Get public VAPID key
router.get("/vapid-key", (req, res) => {
  res.json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

// POST /push/subscribe - Subscribe to push notifications
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys) {
      return res.status(400).json({
        success: false,
        error: "Endpoint and keys are required"
      });
    }

    // Upsert subscription
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId: req.user._id,
        endpoint,
        keys
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: "Subscribed to push notifications"
    });
  } catch (error) {
    console.error("Error subscribing to push:", error);
    res.status(500).json({
      success: false,
      error: "Error subscribing to push notifications"
    });
  }
});

// DELETE /push/unsubscribe - Unsubscribe from push notifications
router.delete("/unsubscribe", authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;

    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });

    res.json({
      success: true,
      message: "Unsubscribed from push notifications"
    });
  } catch (error) {
    console.error("Error unsubscribing:", error);
    res.status(500).json({
      success: false,
      error: "Error unsubscribing"
    });
  }
});

module.exports = router;
