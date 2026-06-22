// routes/messagePerformanceRoutes.js
// Message performance: conversations active within a period and their outcome
// (sale, click, handoff, report).
//   - `daily`   : per-day time series (uncapped, by event timestamp) for the chart
//   - `summary` : period totals (sum of daily)
//   - `rows`    : the most-recent conversations (capped) with per-conversation
//                 outcome flags, for the table
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const ClickLog = require("../models/ClickLog");
const Ticket = require("../models/Ticket");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
const TZ = "America/Mexico_City"; // bucket days in local time, like the clicks route

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

const dayExpr = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: TZ } });

// GET /message-performance?period=7|15|30|90  (or start=&end= ISO)
router.get("/", authenticate, async (req, res) => {
  try {
    const { period = "30", start, end, limit = "500" } = req.query;
    const from = start ? new Date(start) : periodStart(period) || periodStart("30");
    const to = end ? new Date(end) : new Date();
    const cap = Math.min(2000, Math.max(1, parseInt(limit, 10) || 500));

    // ── DAILY SERIES (uncapped, by event timestamp) ──────────────────────────
    const [convDaily, clicksDaily, salesDaily, handoffDaily, reportDaily] = await Promise.all([
      // conversations active per day = distinct psid with a message that day
      Message.aggregate([
        { $match: { timestamp: { $gte: from, $lte: to } } },
        { $group: { _id: { p: "$psid", d: dayExpr("$timestamp") } } },
        { $group: { _id: "$_id.d", n: { $sum: 1 } } },
      ]),
      // clicks per day = distinct psid that clicked that day
      ClickLog.aggregate([
        { $match: { clicked: true, clickedAt: { $gte: from, $lte: to } } },
        { $group: { _id: { p: "$psid", d: dayExpr("$clickedAt") } } },
        { $group: { _id: "$_id.d", n: { $sum: 1 } } },
      ]),
      // sales per day = distinct psid that converted that day (+ revenue)
      ClickLog.aggregate([
        { $match: { converted: true, convertedAt: { $gte: from, $lte: to } } },
        { $group: { _id: { p: "$psid", d: dayExpr("$convertedAt") }, amt: { $sum: "$conversionData.totalAmount" } } },
        { $group: { _id: "$_id.d", n: { $sum: 1 }, revenue: { $sum: "$amt" } } },
      ]),
      // handoffs per day = conversations flagged for a human, bucketed by last activity
      Conversation.aggregate([
        {
          $match: {
            $or: [{ handoffRequested: true }, { state: { $in: ["needs_human", "human_active"] } }],
            lastMessageAt: { $gte: from, $lte: to },
          },
        },
        { $group: { _id: dayExpr("$lastMessageAt"), n: { $sum: 1 } } },
      ]),
      // reports per day = conversation_report tickets created that day, split by severity
      Ticket.aggregate([
        { $match: { source: "conversation_report", createdAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: dayExpr("$createdAt"),
            n: { $sum: 1 },
            high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
            medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
            low: { $sum: { $cond: [{ $eq: ["$priority", "low"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const dayMap = new Map();
    const ensure = (day) => {
      let e = dayMap.get(day);
      if (!e) {
        e = { date: day, conversations: 0, clicks: 0, sales: 0, handoffs: 0, reports: 0, revenue: 0, reportsHigh: 0, reportsMedium: 0, reportsLow: 0 };
        dayMap.set(day, e);
      }
      return e;
    };
    convDaily.forEach((d) => { if (d._id) ensure(d._id).conversations = d.n; });
    clicksDaily.forEach((d) => { if (d._id) ensure(d._id).clicks = d.n; });
    salesDaily.forEach((d) => { if (d._id) { const e = ensure(d._id); e.sales = d.n; e.revenue = Math.round(d.revenue || 0); } });
    handoffDaily.forEach((d) => { if (d._id) ensure(d._id).handoffs = d.n; });
    reportDaily.forEach((d) => {
      if (!d._id) return;
      const e = ensure(d._id);
      e.reports = d.n;
      e.reportsHigh = d.high || 0;
      e.reportsMedium = d.medium || 0;
      e.reportsLow = d.low || 0;
    });

    const daily = [...dayMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        ...e,
        dateLabel: new Date(e.date + "T12:00:00").toLocaleDateString("es-MX", { month: "short", day: "numeric" }),
      }));

    const summary = {
      conversations: daily.reduce((s, d) => s + d.conversations, 0),
      sales: daily.reduce((s, d) => s + d.sales, 0),
      clicks: daily.reduce((s, d) => s + d.clicks, 0),
      handoffs: daily.reduce((s, d) => s + d.handoffs, 0),
      reports: daily.reduce((s, d) => s + d.reports, 0),
      salesRevenue: daily.reduce((s, d) => s + d.revenue, 0),
      reportsByPriority: {
        high: daily.reduce((s, d) => s + d.reportsHigh, 0),
        medium: daily.reduce((s, d) => s + d.reportsMedium, 0),
        low: daily.reduce((s, d) => s + d.reportsLow, 0),
      },
    };

    // ── TABLE ROWS (most-recent conversations, capped) ───────────────────────
    const activity = await Message.aggregate([
      { $match: { timestamp: { $gte: from, $lte: to } } },
      { $group: { _id: "$psid", lastMessageAt: { $max: "$timestamp" }, firstMessageAt: { $min: "$timestamp" }, msgCount: { $sum: 1 } } },
      { $sort: { lastMessageAt: -1 } },
      { $limit: cap },
    ]);
    const psids = activity.map((a) => a._id).filter(Boolean);

    let rows = [];
    if (psids.length) {
      const [convos, clicks, tickets] = await Promise.all([
        Conversation.find({ psid: { $in: psids } })
          .select("psid channel extractedName productSpecs.customerName adId state handoffRequested handoffReason")
          .lean(),
        ClickLog.find({ psid: { $in: psids } }).select("psid clicked converted conversionData").lean(),
        Ticket.find({ psid: { $in: psids }, source: "conversation_report" }).select("psid priority category createdAt status noError").lean(),
      ]);

      const convoBy = new Map(convos.map((c) => [c.psid, c]));
      const clickAgg = new Map();
      for (const cl of clicks) {
        const e = clickAgg.get(cl.psid) || { clicked: false, sale: false, saleAmount: 0 };
        if (cl.clicked) e.clicked = true;
        if (cl.converted) { e.sale = true; e.saleAmount += Number(cl.conversionData?.totalAmount) || 0; }
        clickAgg.set(cl.psid, e);
      }
      const reportBy = new Map();
      for (const t of tickets) {
        const prev = reportBy.get(t.psid);
        if (!prev || new Date(t.createdAt) > new Date(prev.createdAt)) reportBy.set(t.psid, t);
      }

      rows = activity.map((a) => {
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
          reportStatus: rep?.status || null, // open | review | working | solved | dismissed
          reportResolved: rep ? ["solved", "dismissed"].includes(rep.status) : false,
        };
      });
    }

    res.json({
      success: true,
      data: { daily, summary, rows, total: rows.length, capped: psids.length >= cap, from, to },
    });
  } catch (err) {
    console.error("message-performance error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
