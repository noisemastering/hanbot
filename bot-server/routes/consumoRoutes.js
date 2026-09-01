// routes/consumoRoutes.js
//
// "Consumo" — conversation usage vs the billing plan. A CONVERSATION is counted as
// NEW when the user sends a message and their PREVIOUS user message (same PSID) was
// >=23h earlier (or there was none) — i.e. the USER re-initiated after a day. Bot/
// human messages never start a billable convo. Aggregated per day + per month.
const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const SystemState = require("../models/SystemState");

const GAP_MS = 23 * 3600 * 1000; // >=23h since the user's previous message → a NEW convo
const TZ = "America/Mexico_City";

// Month bounds (calendar month, MX-local) as UTC Dates. monthStr = "YYYY-MM".
function monthBounds(monthStr) {
  const [y, mo] = monthStr.split("-").map(Number);
  // 00:00 MX == 06:00 UTC (UTC-6, no DST in most of MX since 2022)
  const start = new Date(Date.UTC(y, mo - 1, 1, 6, 0, 0));
  const end = new Date(Date.UTC(y, mo, 1, 6, 0, 0));
  return { start, end };
}
function currentMonthStr() {
  const mx = new Date(Date.now() - 6 * 3600e3);
  return mx.toISOString().slice(0, 7);
}
// The calendar month before monthStr ("YYYY-MM").
function prevMonthStr(monthStr) {
  const [y, mo] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1)); // mo-2 = zero-based previous month
  return d.toISOString().slice(0, 7);
}

// New (session-opener) convos per MX-day for a calendar month. A convo is NEW when the
// user's previous message (same PSID) was >=23h earlier (or there was none).
async function monthDaily(monthStr) {
  const { start, end } = monthBounds(monthStr);
  const lookback = new Date(start.getTime() - GAP_MS); // so the month's first msg per psid knows its predecessor
  const rows = await Message.aggregate([
    { $match: { senderType: "user", timestamp: { $gte: lookback, $lt: end } } },
    { $setWindowFields: { partitionBy: "$psid", sortBy: { timestamp: 1 }, output: { prevTs: { $shift: { output: "$timestamp", by: -1 } } } } },
    { $addFields: { isNew: { $or: [{ $eq: ["$prevTs", null] }, { $gte: [{ $subtract: ["$timestamp", "$prevTs"] }, GAP_MS] }] } } },
    { $match: { isNew: true, timestamp: { $gte: start } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: TZ } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ], { allowDiskUse: true });
  return rows.map((r) => ({ date: r._id, count: r.count }));
}

// GET /consumo/usage?month=YYYY-MM  → daily + month totals vs plan.
router.get("/usage", async (req, res) => {
  try {
    const monthStr = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : currentMonthStr();

    const daily = await monthDaily(monthStr);
    const total = daily.reduce((a, d) => a + d.count, 0);
    const todayKey = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const today = daily.find((d) => d.date === todayKey)?.count || 0;

    // Previous calendar month's total — a reference point for the gauge (esp. early in a month).
    const prevStr = prevMonthStr(monthStr);
    const prevDaily = await monthDaily(prevStr);
    const lastMonth = { month: prevStr, total: prevDaily.reduce((a, d) => a + d.count, 0) };

    const state = await SystemState.getState();
    const p = (state.plan && state.plan.monthlyLimit) ? state.plan : { name: "Estándar", monthlyLimit: 3000, overageRate: 0, currency: "MXN" };
    const limit = p.monthlyLimit || 3000;
    const overCount = Math.max(0, total - limit);
    const overageRate = p.overageRate || 0;

    res.json({
      success: true,
      month: monthStr,
      plan: { name: p.name, monthlyLimit: limit, overageRate, currency: p.currency || "MXN" },
      total,
      today,
      remaining: Math.max(0, limit - total),
      overage: { count: overCount, rate: overageRate, cost: overCount * overageRate },
      lastMonth,
      daily,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET / POST the plan config.
router.get("/plan", async (req, res) => {
  try {
    const s = await SystemState.getState();
    res.json({ success: true, plan: s.plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.post("/plan", async (req, res) => {
  try {
    const { name, monthlyLimit, overageRate, currency } = req.body || {};
    const s = await SystemState.getState();
    if (!s.plan) s.plan = {};
    if (name !== undefined) s.plan.name = String(name);
    if (monthlyLimit !== undefined) s.plan.monthlyLimit = Number(monthlyLimit) || 0;
    if (overageRate !== undefined) s.plan.overageRate = Number(overageRate) || 0;
    if (currency !== undefined) s.plan.currency = String(currency);
    await s.save();
    res.json({ success: true, plan: s.plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
