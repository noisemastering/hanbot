const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
// mlorders (legacy normalized) was retired; ml_sales is the canonical sales store.
// Same fields used here (status/totalAmount/dateCreated/items.title); product
// grouping falls back to item.title since ml_sales items carry no productFamilyId.
const MLOrder = require("../models/MLSale");
const ClickLog = require("../models/ClickLog");
const ProductFamily = require("../models/ProductFamily");

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

// Helper: get period start date
function getPeriodStartDate(period) {
  if (period === 'all') return null;
  const days = parseInt(period, 10);
  if (isNaN(days)) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Spanish month labels
const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// The all-time rollup (monthly + totals) changes slowly and scanning every paid order
// per request is what made this route slow on the free-tier cluster — cache it briefly.
let _allTimeCache = { at: 0, ml: null };
const ALLTIME_TTL_MS = 5 * 60 * 1000;

// GET /sales-overview
router.get("/", authenticate, async (req, res) => {
  try {
    const period = req.query.period || '30';
    const periodStart = getPeriodStartDate(period);

    // ── ML all-time monthly + totals (server-side aggregation, cached ~5 min) ──
    let mlAll = (_allTimeCache.ml && (Date.now() - _allTimeCache.at) < ALLTIME_TTL_MS) ? _allTimeCache.ml : null;
    if (!mlAll) {
      const [f] = await MLOrder.aggregate([
        { $match: { status: 'paid' } },
        { $facet: {
          monthly: [{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$dateCreated' } }, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } }],
          totals: [{ $group: { _id: null, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 }, first: { $min: '$dateCreated' }, last: { $max: '$dateCreated' } } }],
        } },
      ]);
      mlAll = { monthly: (f && f.monthly) || [], tot: (f && f.totals && f.totals[0]) || { revenue: 0, orders: 0, first: null, last: null } };
      _allTimeCache = { at: Date.now(), ml: mlAll };
    }
    const mlMonthlyAgg = mlAll.monthly;
    const mlTot = mlAll.tot;

    // ── Manual sales are few → fetch all (cheap) and roll up in JS. ──
    const allManualSales = await ClickLog.find({ correlationMethod: 'manual', converted: true })
      .select('conversionData.totalAmount conversionData.orderDate createdAt productName').lean();
    const manualDateOf = (s) => s.conversionData?.orderDate || s.createdAt;
    const allManualRevenue = allManualSales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);

    // ── All-time totals (ML aggregate + manual) ──
    const manualMs = allManualSales.map(manualDateOf).filter(Boolean).map((d) => new Date(d).getTime());
    const firstCand = [mlTot.first, ...manualMs].filter((v) => v != null).map((v) => new Date(v).getTime());
    const lastCand = [mlTot.last, ...manualMs].filter((v) => v != null).map((v) => new Date(v).getTime());
    const allTimeTotals = {
      revenue: (mlTot.revenue || 0) + allManualRevenue,
      orders: (mlTot.orders || 0) + allManualSales.length,
      firstOrderDate: firstCand.length ? new Date(Math.min(...firstCand)) : null,
      lastOrderDate: lastCand.length ? new Date(Math.max(...lastCand)) : null
    };

    // ── Monthly (ALL months) — ML from the aggregate, manual rolled up in JS. ──
    const monthlyMap = {};
    for (const m of mlMonthlyAgg) {
      const key = m._id;
      if (!key) continue;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, revenue: 0, orders: 0, mlRevenue: 0, manualRevenue: 0 };
      monthlyMap[key].revenue += m.revenue || 0;
      monthlyMap[key].mlRevenue += m.revenue || 0;
      monthlyMap[key].orders += m.orders || 0;
    }
    for (const sale of allManualSales) {
      const d = new Date(manualDateOf(sale));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, revenue: 0, orders: 0, mlRevenue: 0, manualRevenue: 0 };
      monthlyMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      monthlyMap[key].manualRevenue += (sale.conversionData?.totalAmount || 0);
      monthlyMap[key].orders += 1;
    }
    const monthly = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => { const [year, mon] = m.month.split('-'); return { ...m, label: `${MONTH_LABELS[parseInt(mon, 10) - 1]} ${year}` }; });

    // ── Period: daily + totals + top products via ONE aggregation (no doc transfer) ──
    const mlPeriodMatch = periodStart ? { status: 'paid', dateCreated: { $gte: periodStart } } : { status: 'paid' };
    const [pf] = await MLOrder.aggregate([
      { $match: mlPeriodMatch },
      { $facet: {
        daily: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$dateCreated' } }, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } }],
        totals: [{ $group: { _id: null, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } }],
        products: [
          { $unwind: '$items' },
          { $group: { _id: { fam: '$items.productFamilyId', title: '$items.title' }, revenue: { $sum: { $multiply: [{ $ifNull: ['$items.unitPrice', 0] }, { $ifNull: ['$items.quantity', 1] }] } }, orders: { $sum: 1 } } },
        ],
      } },
    ]);
    const mlDailyAgg = (pf && pf.daily) || [];
    const mlPeriodTot = (pf && pf.totals && pf.totals[0]) || { revenue: 0, orders: 0 };
    const mlProductsAgg = (pf && pf.products) || [];

    const periodManualSales = periodStart
      ? allManualSales.filter((s) => { const d = manualDateOf(s); return d && new Date(d) >= periodStart; })
      : allManualSales;
    const manualRevenue = periodManualSales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);

    const mlRevenue = mlPeriodTot.revenue || 0;
    const mlOrders = mlPeriodTot.orders || 0;
    const totalRevenue = mlRevenue + manualRevenue;
    const totalOrders = mlOrders + periodManualSales.length;
    const totals = {
      revenue: totalRevenue,
      orders: totalOrders,
      avgTicket: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      channels: { ml: { revenue: mlRevenue, orders: mlOrders }, manual: { revenue: manualRevenue, orders: periodManualSales.length } }
    };

    // daily (ML aggregate + manual)
    const dailyMap = {};
    for (const d of mlDailyAgg) {
      const key = d._id;
      if (!key) continue;
      if (!dailyMap[key]) dailyMap[key] = { date: key, revenue: 0, orders: 0 };
      dailyMap[key].revenue += d.revenue || 0;
      dailyMap[key].orders += d.orders || 0;
    }
    for (const sale of periodManualSales) {
      const key = new Date(manualDateOf(sale)).toISOString().split('T')[0];
      if (!dailyMap[key]) dailyMap[key] = { date: key, revenue: 0, orders: 0 };
      dailyMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      dailyMap[key].orders += 1;
    }
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // top products (ML aggregate + manual)
    const productMap = {};
    for (const p of mlProductsAgg) {
      const fam = p._id.fam; const title = p._id.title;
      const key = fam ? fam.toString() : `title:${title || 'Desconocido'}`;
      if (!productMap[key]) productMap[key] = { productFamilyId: fam || null, fallbackName: title || 'Desconocido', revenue: 0, orders: 0 };
      productMap[key].revenue += p.revenue || 0;
      productMap[key].orders += p.orders || 0;
    }
    for (const sale of periodManualSales) {
      const key = `manual:${sale.productName || 'Venta Manual'}`;
      if (!productMap[key]) productMap[key] = { productFamilyId: null, fallbackName: sale.productName || 'Venta Manual', revenue: 0, orders: 0 };
      productMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      productMap[key].orders += 1;
    }
    const familyIds = Object.values(productMap).filter(p => p.productFamilyId).map(p => p.productFamilyId);
    const families = familyIds.length > 0 ? await ProductFamily.find({ _id: { $in: familyIds } }).select('name').lean() : [];
    const familyNameMap = {};
    for (const f of families) familyNameMap[f._id.toString()] = f.name;
    const topProducts = Object.entries(productMap)
      .map(([key, val]) => ({
        name: val.productFamilyId ? (familyNameMap[val.productFamilyId.toString()] || val.fallbackName) : val.fallbackName,
        revenue: val.revenue,
        orders: val.orders,
        avgTicket: val.orders > 0 ? Math.round(val.revenue / val.orders) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({ success: true, data: { totals, monthly, daily, topProducts, allTimeTotals } });
  } catch (error) {
    console.error("Error fetching sales overview:", error);
    res.status(500).json({ success: false, error: "Failed to fetch sales overview" });
  }
});

module.exports = router;
