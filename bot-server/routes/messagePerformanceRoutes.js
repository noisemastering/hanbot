// routes/messagePerformanceRoutes.js
// Message performance: conversations active within a period and their outcome
// (sale, click, handoff, report). One row per conversation.
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const ClickLog = require("../models/ClickLog");
const Ticket = require("../models/Ticket");

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
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

function periodStart(period) {
  const days = parseInt(period, 10);
  if (isNaN(days)) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /message-performance?period=7|15|30|90  (or start=&end= ISO)
router.get("/", authenticate, async (req, res) => {
  try {
    const { period = "30", start, end, limit = "500" } = req.query;
    const from = start ? new Date(start) : periodStart(period) || periodStart("30");
    const to = end ? new Date(end) : new Date();
    const cap = Math.min(2000, Math.max(1, parseInt(limit, 10) || 500));

    // 1. Conversations active in the window — one entry per psid, with last activity.
    const activity = await Message.aggregate([
      { $match: { timestamp: { $gte: from, $lte: to } } },
      { $group: { _id: "$psid", lastMessageAt: { $max: "$timestamp" }, firstMessageAt: { $min: "$timestamp" }, msgCount: { $sum: 1 } } },
      { $sort: { lastMessageAt: -1 } },
      { $limit: cap },
    ]);

    const psids = activity.map((a) => a._id).filter(Boolean);
    if (psids.length === 0) {
      return res.json({ success: true, data: { rows: [], summary: emptySummary(), total: 0, capped: false } });
    }

    // 2. Batch-fetch enrichment for those psids.
    const [convos, clicks, tickets] = await Promise.all([
      Conversation.find({ psid: { $in: psids } })
        .select("psid channel extractedName productSpecs.customerName adId state handoffRequested handoffReason")
        .lean(),
      ClickLog.find({ psid: { $in: psids } })
        .select("psid clicked converted conversionData")
        .lean(),
      Ticket.find({ psid: { $in: psids }, source: "conversation_report" })
        .select("psid priority category createdAt")
        .lean(),
    ]);

    const convoBy = new Map(convos.map((c) => [c.psid, c]));

    // Click/sale flags + sale amount per psid (a psid can have multiple ClickLogs).
    const clickAgg = new Map();
    for (const cl of clicks) {
      const e = clickAgg.get(cl.psid) || { clicked: false, sale: false, saleAmount: 0 };
      if (cl.clicked) e.clicked = true;
      if (cl.converted) {
        e.sale = true;
        e.saleAmount += Number(cl.conversionData?.totalAmount) || 0;
      }
      clickAgg.set(cl.psid, e);
    }

    // Latest report ticket per psid (keep the most recent + its priority).
    const reportBy = new Map();
    for (const t of tickets) {
      const prev = reportBy.get(t.psid);
      if (!prev || new Date(t.createdAt) > new Date(prev.createdAt)) reportBy.set(t.psid, t);
    }

    const rows = activity.map((a) => {
      const psid = a._id;
      const c = convoBy.get(psid) || {};
      const ck = clickAgg.get(psid) || { clicked: false, sale: false, saleAmount: 0 };
      const rep = reportBy.get(psid) || null;
      const handoff = !!c.handoffRequested || c.state === "needs_human" || c.state === "human_active";
      return {
        psid,
        name: c.productSpecs?.customerName || c.extractedName || null,
        channel: c.channel || (psid.startsWith("wa:") ? "whatsapp" : "facebook"),
        adId: c.adId || null,
        lastMessageAt: a.lastMessageAt,
        firstMessageAt: a.firstMessageAt,
        msgCount: a.msgCount,
        click: ck.clicked,
        sale: ck.sale,
        saleAmount: ck.sale ? Math.round(ck.saleAmount) : null,
        handoff,
        handoffReason: handoff ? c.handoffReason || null : null,
        reported: !!rep,
        reportPriority: rep?.priority || null,
        reportCategory: rep?.category || null,
      };
    });

    const summary = {
      conversations: rows.length,
      sales: rows.filter((r) => r.sale).length,
      clicks: rows.filter((r) => r.click).length,
      handoffs: rows.filter((r) => r.handoff).length,
      reports: rows.filter((r) => r.reported).length,
      salesRevenue: rows.reduce((s, r) => s + (r.saleAmount || 0), 0),
    };

    res.json({
      success: true,
      data: { rows, summary, total: rows.length, capped: psids.length >= cap, from, to },
    });
  } catch (err) {
    console.error("message-performance error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function emptySummary() {
  return { conversations: 0, sales: 0, clicks: 0, handoffs: 0, reports: 0, salesRevenue: 0 };
}

module.exports = router;
