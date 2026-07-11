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

// GET /sales-overview
router.get("/", authenticate, async (req, res) => {
  try {
    const period = req.query.period || '30';
    const periodStart = getPeriodStartDate(period);

    // ── All-time ML orders (paid) ──
    const allMLOrders = await MLOrder.find({ status: 'paid' })
      .select('totalAmount dateCreated items')
      .lean();

    // ── All-time manual sales ──
    const allManualSales = await ClickLog.find({
      correlationMethod: 'manual',
      converted: true
    })
      .select('conversionData.totalAmount conversionData.orderDate createdAt productName')
      .lean();

    // ── All-time totals ──
    const allMLRevenue = allMLOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const allManualRevenue = allManualSales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);

    const allDates = [
      ...allMLOrders.map(o => o.dateCreated),
      ...allManualSales.map(s => s.conversionData?.orderDate || s.createdAt)
    ].filter(Boolean).sort((a, b) => new Date(a) - new Date(b));

    const allTimeTotals = {
      revenue: allMLRevenue + allManualRevenue,
      orders: allMLOrders.length + allManualSales.length,
      firstOrderDate: allDates.length > 0 ? allDates[0] : null,
      lastOrderDate: allDates.length > 0 ? allDates[allDates.length - 1] : null
    };

    // ── Period-filtered data ──
    const periodMLOrders = periodStart
      ? allMLOrders.filter(o => new Date(o.dateCreated) >= periodStart)
      : allMLOrders;

    const periodManualSales = periodStart
      ? allManualSales.filter(s => {
          const d = s.conversionData?.orderDate || s.createdAt;
          return d && new Date(d) >= periodStart;
        })
      : allManualSales;

    const mlRevenue = periodMLOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const manualRevenue = periodManualSales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);
    const totalRevenue = mlRevenue + manualRevenue;
    const totalOrders = periodMLOrders.length + periodManualSales.length;

    const totals = {
      revenue: totalRevenue,
      orders: totalOrders,
      avgTicket: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      channels: {
        ml: { revenue: mlRevenue, orders: periodMLOrders.length },
        manual: { revenue: manualRevenue, orders: periodManualSales.length }
      }
    };

    // ── Monthly data (ALL months from beginning of time) ──
    const monthlyMap = {};

    for (const order of allMLOrders) {
      const d = new Date(order.dateCreated);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) {
        monthlyMap[key] = { month: key, revenue: 0, orders: 0, mlRevenue: 0, manualRevenue: 0 };
      }
      monthlyMap[key].revenue += (order.totalAmount || 0);
      monthlyMap[key].mlRevenue += (order.totalAmount || 0);
      monthlyMap[key].orders += 1;
    }

    for (const sale of allManualSales) {
      const d = new Date(sale.conversionData?.orderDate || sale.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) {
        monthlyMap[key] = { month: key, revenue: 0, orders: 0, mlRevenue: 0, manualRevenue: 0 };
      }
      monthlyMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      monthlyMap[key].manualRevenue += (sale.conversionData?.totalAmount || 0);
      monthlyMap[key].orders += 1;
    }

    const monthly = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => {
        const [year, mon] = m.month.split('-');
        return {
          ...m,
          label: `${MONTH_LABELS[parseInt(mon, 10) - 1]} ${year}`
        };
      });

    // ── Daily data (only for selected period) ──
    const dailyMap = {};

    for (const order of periodMLOrders) {
      const key = new Date(order.dateCreated).toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, revenue: 0, orders: 0 };
      }
      dailyMap[key].revenue += (order.totalAmount || 0);
      dailyMap[key].orders += 1;
    }

    for (const sale of periodManualSales) {
      const d = sale.conversionData?.orderDate || sale.createdAt;
      const key = new Date(d).toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, revenue: 0, orders: 0 };
      }
      dailyMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      dailyMap[key].orders += 1;
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // ── Top products (period) ──
    const productMap = {};

    for (const order of periodMLOrders) {
      for (const item of (order.items || [])) {
        const key = item.productFamilyId
          ? item.productFamilyId.toString()
          : `title:${item.title || 'Desconocido'}`;
        if (!productMap[key]) {
          productMap[key] = {
            productFamilyId: item.productFamilyId || null,
            fallbackName: item.title || 'Desconocido',
            revenue: 0,
            orders: 0
          };
        }
        productMap[key].revenue += (item.unitPrice || 0) * (item.quantity || 1);
        productMap[key].orders += 1;
      }
    }

    for (const sale of periodManualSales) {
      const key = `manual:${sale.productName || 'Venta Manual'}`;
      if (!productMap[key]) {
        productMap[key] = {
          productFamilyId: null,
          fallbackName: sale.productName || 'Venta Manual',
          revenue: 0,
          orders: 0
        };
      }
      productMap[key].revenue += (sale.conversionData?.totalAmount || 0);
      productMap[key].orders += 1;
    }

    // Resolve product family names
    const familyIds = Object.values(productMap)
      .filter(p => p.productFamilyId)
      .map(p => p.productFamilyId);

    const families = familyIds.length > 0
      ? await ProductFamily.find({ _id: { $in: familyIds } }).select('name').lean()
      : [];

    const familyNameMap = {};
    for (const f of families) {
      familyNameMap[f._id.toString()] = f.name;
    }

    const topProducts = Object.entries(productMap)
      .map(([key, val]) => ({
        name: val.productFamilyId
          ? (familyNameMap[val.productFamilyId.toString()] || val.fallbackName)
          : val.fallbackName,
        revenue: val.revenue,
        orders: val.orders,
        avgTicket: val.orders > 0 ? Math.round(val.revenue / val.orders) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        totals,
        monthly,
        daily,
        topProducts,
        allTimeTotals
      }
    });
  } catch (error) {
    console.error("Error fetching sales overview:", error);
    res.status(500).json({ success: false, error: "Failed to fetch sales overview" });
  }
});

module.exports = router;
