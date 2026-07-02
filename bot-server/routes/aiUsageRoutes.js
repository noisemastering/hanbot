// routes/aiUsageRoutes.js
//
// Costos IA — SUPER_ADMIN ONLY.
// Real OpenAI spend from the AiUsage collection (one doc per chat.completions
// call, written by ai/utils/aiUsageLogger.js). Reports windowed totals, a daily
// series, a by-model breakdown, and the TRUE cost-per-conversation (spend ÷
// distinct conversations in the window). Replaces the hand estimates.
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const AiUsage = require("../models/AiUsage");
const Message = require("../models/Message");
const DashboardUser = require("../models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
const TZ = "America/Mexico_City";

// --- auth (same shape as workflowsRoutes.js) ---
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "Only Super Admin can view AI costs" });
  }
  next();
};

router.use(authenticate);
router.use(requireSuperAdmin);

/**
 * GET /ai-usage/summary?days=30
 * Everything the Costos IA view needs for the selected window.
 */
router.get("/summary", async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Totals for the window.
    const [totals] = await AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          costUsd: { $sum: "$costUsd" },
          calls: { $sum: 1 },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          reasoningTokens: { $sum: "$reasoningTokens" },
          cachedTokens: { $sum: "$cachedTokens" },
          totalTokens: { $sum: "$totalTokens" },
        },
      },
    ]);

    // Daily series (client timezone), oldest → newest.
    const daily = await AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } },
          costUsd: { $sum: "$costUsd" },
          calls: { $sum: 1 },
          totalTokens: { $sum: "$totalTokens" },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", costUsd: 1, calls: 1, totalTokens: 1 } },
    ]);

    // Per-model breakdown, most expensive first.
    const byModel = await AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$model",
          costUsd: { $sum: "$costUsd" },
          calls: { $sum: 1 },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          reasoningTokens: { $sum: "$reasoningTokens" },
        },
      },
      { $sort: { costUsd: -1 } },
      { $project: { _id: 0, model: "$_id", costUsd: 1, calls: 1, promptTokens: 1, completionTokens: 1, reasoningTokens: 1 } },
    ]);

    // True cost-per-conversation: distinct conversations that had ANY message in
    // the window. (A conversation costs money across all its turns; dividing
    // total spend by active conversations is the honest unit figure.)
    const convoIds = await Message.distinct("psid", { timestamp: { $gte: since } });
    const conversations = convoIds.length;

    const costUsd = totals?.costUsd || 0;
    const costPerConvoUsd = conversations > 0 ? costUsd / conversations : 0;

    res.json({
      success: true,
      window: { days, since: since.toISOString() },
      totals: {
        costUsd,
        calls: totals?.calls || 0,
        promptTokens: totals?.promptTokens || 0,
        completionTokens: totals?.completionTokens || 0,
        reasoningTokens: totals?.reasoningTokens || 0,
        cachedTokens: totals?.cachedTokens || 0,
        totalTokens: totals?.totalTokens || 0,
      },
      conversations,
      costPerConvoUsd,
      daily,
      byModel,
    });
  } catch (e) {
    console.error("ai-usage/summary error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
