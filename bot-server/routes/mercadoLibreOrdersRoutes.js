// routes/mercadoLibreOrdersRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const { getOrders, getOrderById } = require("../utils/mercadoLibreOrders");

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

// GET /ml/orders/:sellerId - Fetch orders for a specific seller
router.get("/orders/:sellerId", authenticate, async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { sort, limit, offset } = req.query;

    console.log(`📦 Orders request for seller ${sellerId} by user ${req.user.username}`);

    const result = await getOrders(sellerId, {
      sort: sort || "date_desc",
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0
    });

    res.json(result);
  } catch (error) {
    console.error("❌ Error in orders endpoint:", error.message);

    // Log full ML error response for debugging
    if (error.response) {
      console.error("📋 Full Mercado Libre error response:");
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Headers:`, JSON.stringify(error.response.headers, null, 2));
      console.error(`   Body:`, JSON.stringify(error.response.data, null, 2));
      console.error(`   Request URL:`, error.config?.url);
      console.error(`   Request params:`, error.config?.params);
    }

    // Return FULL ML error details (don't wrap as internal_error)
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error || error.code || "unknown_error",
      message: error.response?.data?.message || error.message,
      status: error.response?.status,
      cause: error.response?.data?.cause,
      ml_response: error.response?.data  // Full ML response for debugging
    });
  }
});

// GET /ml/orders/:sellerId/:orderId - Get specific order details
router.get("/orders/:sellerId/:orderId", authenticate, async (req, res) => {
  try {
    const { sellerId, orderId } = req.params;

    console.log(`📦 Order detail request for order ${orderId}, seller ${sellerId}`);

    const result = await getOrderById(sellerId, orderId);

    res.json(result);
  } catch (error) {
    console.error("❌ Error fetching order details:", error);

    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error || "internal_error",
      message: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
