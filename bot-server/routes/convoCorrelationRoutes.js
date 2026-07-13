// routes/convoCorrelationRoutes.js
// Freshness-gated convo↔sale correlation + chart data over our own DB.
const express = require("express");
const router = express.Router();
const ConvoSaleMatch = require("../models/ConvoSaleMatch");
const ClickLog = require("../models/ClickLog");
const MLSale = require("../models/MLSale");
const { runConvoCorrelation, correlateOneConversation, correlationStatus, reconcileOverride } = require("../utils/runConvoCorrelation");
const Conversation = require("../models/Conversation");

// Rejected matches are kept for audit but must NOT count as conversions anywhere.
const NOT_REJECTED = { humanVerdict: { $ne: "rejected" } };

// Bucket by Mexico City local day (UTC-6, no DST) — the business reads dates in
// local time, so a sale at 02:24 UTC is "yesterday 8:24pm", not today.
const MX_OFFSET_MS = 6 * 3600e3;
const dayKey = (d) => new Date(new Date(d).getTime() - MX_OFFSET_MS).toISOString().slice(0, 10);

// Freshness: is the correlation stale (>3h) / running?
router.get("/status", async (req, res) => {
  try {
    res.json({ success: true, ...(await correlationStatus()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Trigger a correlation run (non-blocking). ?full=1 → first-time Dec-2025 backtrace.
// The dashboard calls this when status.stale is true, then polls /status.
router.post("/run", async (req, res) => {
  const full = req.query.full === "1" || req.body?.full === true;
  const status = await correlationStatus();
  if (status.running) return res.status(202).json({ success: true, started: false, running: true });
  // fire-and-forget; freshness + guard live on SystemState
  runConvoCorrelation({ full }).catch((e) => console.error("❌ convo correlation run failed:", e.message));
  res.status(202).json({ success: true, started: true, full });
});

// Correlate a SINGLE conversation on demand (blocking, fast) — the per-conversation
// "↻ Correlacionar" button on the conversations route. Scoped to one psid so it doesn't
// run the whole batch; returns the outcome so the panel can reload immediately.
router.post("/run/:psid", async (req, res) => {
  try {
    const result = await correlateOneConversation(req.params.psid);
    if (!result.ok) return res.status(result.notFound ? 404 : 400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Daily chart data: clicks/links (ClickLog) + conversions/revenue (convo_sale_matches).
router.get("/chart", async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : new Date(Date.now() - 90 * 864e5);
    // Extend the upper bound by 6h so the FULL Mexico-local day is included (a UTC
    // dateTo of 23:59 would otherwise cut the last 6h of the local day).
    const dateTo = new Date((req.query.dateTo ? new Date(req.query.dateTo) : new Date()).getTime() + MX_OFFSET_MS);
    const days = new Map(); // date → row
    const row = (d) => {
      if (!days.has(d)) days.set(d, { date: d, links: 0, clicks: 0, sales: 0, conversions: 0, revenue: 0, byCert: {} });
      return days.get(d);
    };

    // clicks / links shared
    const clicks = await ClickLog.find({ createdAt: { $gte: dateFrom, $lte: dateTo } }).select("createdAt clicked").lean();
    for (const c of clicks) { const r = row(dayKey(c.createdAt)); r.links++; if (c.clicked) r.clicks++; }

    // TOTAL sales (all ML sales, not just attributed) — so the chart shows real
    // sales vs the subset we could tie to a conversation.
    const allSales = await MLSale.find({ dateCreated: { $gte: dateFrom, $lte: dateTo } }).select("dateCreated").lean();
    for (const s of allSales) row(dayKey(s.dateCreated)).sales++;

    // conversions from our correlation (by sale date) — the ATTRIBUTED subset,
    // excluding human-rejected matches.
    // Per-day AND per-certainty (so the dashboard's confidence slider can filter to
    // "certainty ≥ N" entirely client-side, in realtime, without refetching). Human-
    // confirmed matches (null certainty) are the highest trust → bucketed as 100.
    const matches = await ConvoSaleMatch.find({ "sale.dateCreated": { $gte: dateFrom, $lte: dateTo }, ...NOT_REJECTED }).select("sale.dateCreated sale.totalAmount certainty").lean();
    for (const m of matches) {
      const r = row(dayKey(m.sale.dateCreated));
      const amt = m.sale.totalAmount || 0;
      r.conversions++; r.revenue += amt;
      const c = m.certainty == null ? 100 : m.certainty;
      (r.byCert[c] = r.byCert[c] || { conversions: 0, revenue: 0 });
      r.byCert[c].conversions++; r.byCert[c].revenue += amt;
    }

    const chartData = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, dateLabel: new Date(r.date + "T00:00:00Z").toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" }), revenue: Math.round(r.revenue) }));
    res.json({ success: true, chartData });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Summary tiles + tier / linkAudit breakdown.
router.get("/summary", async (req, res) => {
  try {
    const KEEP = { $match: NOT_REJECTED }; // drop human-rejected from every tile
    const [byTier, totals, auditAgg, prodAgg, humanConfirmed] = await Promise.all([
      ConvoSaleMatch.aggregate([KEEP, { $group: { _id: "$certainty", count: { $sum: 1 }, revenue: { $sum: "$sale.totalAmount" } } }, { $sort: { _id: -1 } }]),
      ConvoSaleMatch.aggregate([KEEP, { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$sale.totalAmount" }, avgCertainty: { $avg: "$certainty" } } }]),
      ConvoSaleMatch.aggregate([KEEP, { $group: { _id: "$linkAudit.mismatch", count: { $sum: 1 } } }]),
      // top SELLING products FROM the correlation, split by certainty so the confidence
      // slider can re-filter + re-rank them client-side (human/null certainty → 100).
      ConvoSaleMatch.aggregate([KEEP, { $group: { _id: { title: "$sale.itemTitle", cert: "$certainty" }, conversions: { $sum: 1 }, revenue: { $sum: "$sale.totalAmount" } } }]),
      ConvoSaleMatch.countDocuments({ humanVerdict: "confirmed" }),
    ]);
    // Fold the {title,cert} groups into one row per product carrying a per-tier map.
    const prodMap = new Map();
    for (const p of prodAgg) {
      const name = p._id.title || "—";
      const cert = p._id.cert == null ? 100 : p._id.cert;
      let e = prodMap.get(name);
      if (!e) { e = { name, conversions: 0, totalRevenue: 0, tiers: {} }; prodMap.set(name, e); }
      e.conversions += p.conversions; e.totalRevenue += p.revenue || 0;
      (e.tiers[cert] = e.tiers[cert] || { conversions: 0, revenue: 0 });
      e.tiers[cert].conversions += p.conversions; e.tiers[cert].revenue += p.revenue || 0;
    }
    const topProducts = [...prodMap.values()].sort((a, b) => b.conversions - a.conversions).slice(0, 40);
    const rejected = await ConvoSaleMatch.countDocuments({ humanVerdict: "rejected" });
    const t = totals[0] || { count: 0, revenue: 0, avgCertainty: 0 };
    const mismatch = (auditAgg.find((x) => x._id === true) || {}).count || 0;
    const matchedShared = (auditAgg.find((x) => x._id === false) || {}).count || 0;
    res.json({
      success: true,
      totals: { conversions: t.count, revenue: Math.round(t.revenue || 0), avgCertainty: Math.round(t.avgCertainty || 0) },
      byTier: byTier.map((x) => ({ certainty: x._id, count: x.count, revenue: Math.round(x.revenue || 0) })),
      human: { confirmed: humanConfirmed, rejected },
      linkAudit: { mismatch, matchedShared },
      topProducts: topProducts.map((x) => ({ name: x.name || "—", conversions: x.conversions, totalRevenue: Math.round(x.totalRevenue || 0), tiers: x.tiers })),
      status: await correlationStatus(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Per-conversation commerce status from the SAME source as the charts:
// clicked (ClickLog) + purchased (convo_sale_matches) + last-correlation stamp.
router.get("/convo/:psid", async (req, res) => {
  try {
    const psid = req.params.psid;
    const clicks = await ClickLog.find({ psid }).select("clicked clickedAt productName").lean();
    const clickedRows = clicks.filter((c) => c.clicked);
    const clickedAt = clickedRows.map((c) => c.clickedAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
    // Effective sale = the best NON-rejected match (a human "no_sale" hides it).
    const match = await ConvoSaleMatch.findOne({ psid, ...NOT_REJECTED }).sort({ certainty: -1 }).lean();
    const convoDoc = await Conversation.findOne({ psid }).select("saleOverride").lean();
    const override = (convoDoc && convoDoc.saleOverride) || {};
    const status = await correlationStatus();

    // Chronological click+sale timeline so the reviewer sees the TEMPORAL relationship
    // (a sale attributed here is never a month from the click — it must be same-day —
    // but showing the dates makes that self-evident instead of trusted blindly).
    const clickEvents = clickedRows
      .filter((c) => c.clickedAt)
      .map((c) => ({ type: "click", date: c.clickedAt, label: c.productName || "Link" }));
    const saleEvent = match
      ? { type: "sale", date: match.sale?.dateCreated, label: match.sale?.itemTitle || "Venta", amount: match.sale?.totalAmount, certainty: match.certainty, orderId: match.orderId }
      : null;
    const timeline = [...clickEvents, ...(saleEvent ? [saleEvent] : [])]
      .filter((e) => e.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    // Gap from the sale to its NEAREST click + whether they share a Mexico-local day.
    let saleGapHours = null, saleSameDayAsClick = null;
    if (saleEvent?.date && clickEvents.length) {
      const ts = new Date(saleEvent.date).getTime();
      let g = Infinity;
      for (const ce of clickEvents) g = Math.min(g, Math.abs(ts - new Date(ce.date).getTime()));
      saleGapHours = Math.round((g / 3600e3) * 10) / 10;
      saleSameDayAsClick = clickEvents.some((ce) => dayKey(ce.date) === dayKey(saleEvent.date));
    }
    res.json({
      success: true,
      clicked: clickedRows.length > 0,
      clickedAt,
      hasLink: clicks.length > 0,
      clickedProducts: [...new Set(clickedRows.map((c) => c.productName).filter(Boolean))],
      timeline,
      saleGapHours,
      saleSameDayAsClick,
      purchased: !!match,
      // Human verdict on this conversation (beats the algorithm): "sale" | "no_sale" | null.
      override: override.verdict || null,
      overrideNote: override.note || null,
      overrideBy: override.by || null,
      overrideAt: override.at || null,
      humanConfirmed: !!(match && match.human),
      // The actual data we compared to match: convo side vs ML (sale) side + which
      // signals fired. Same content the conversions table shows in its data column.
      matchDetails: match ? match.matchDetails || null : null,
      saleItemTitle: match ? match.sale?.itemTitle || null : null,
      signals: match ? match.signals || null : null,
      conversion: match
        ? {
            totalAmount: match.sale?.totalAmount,
            certainty: match.certainty,
            confidence: match.confidence,
            undisputed: match.undisputed,
            ventaIndirecta: match.ventaIndirecta,
            attributionReason: match.reason,
            itemTitle: match.sale?.itemTitle,
            orderId: match.orderId,
            saleDate: match.sale?.dateCreated,
            mismatch: match.linkAudit?.mismatch,
            sharedProducts: match.linkAudit?.sharedProducts,
            boughtProduct: match.linkAudit?.boughtProduct,
          }
        : null,
      lastCorrelation: status,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Paged matches (for a review table) — supports ?mismatch=1 to see the safety-net cases.
router.get("/matches", async (req, res) => {
  try {
    const q = {};
    if (req.query.psid) q.psid = req.query.psid;
    if (req.query.mismatch === "1") q["linkAudit.mismatch"] = true;
    if (req.query.minCertainty) q.certainty = { $gte: Number(req.query.minCertainty) };
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const matches = await ConvoSaleMatch.find(q).sort({ "sale.dateCreated": -1 }).limit(limit).lean();
    res.json({ success: true, count: matches.length, matches });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Human override: deem a conversation a sale / not-a-sale (or clear it). The verdict
// is stored on the Conversation (authoritative, survives re-runs) and applied to the
// match collection immediately so every view reflects it without waiting for a run.
//   body: { verdict: "sale" | "no_sale" | null, note?, by? }
router.post("/override/:psid", async (req, res) => {
  try {
    const psid = req.params.psid;
    const verdict = req.body?.verdict === "sale" || req.body?.verdict === "no_sale" ? req.body.verdict : null;
    const saleOverride = {
      verdict,
      note: (req.body?.note || "").trim() || null,
      by: (req.body?.by || req.user?.email || "dashboard").toString(),
      at: new Date(),
    };
    const convo = await Conversation.findOneAndUpdate({ psid }, { $set: { saleOverride } }, { new: true }).select("_id psid saleOverride").lean();
    if (!convo) return res.status(404).json({ success: false, error: "Conversación no encontrada" });
    await reconcileOverride(psid, convo._id, saleOverride);
    res.json({ success: true, psid, override: verdict });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
