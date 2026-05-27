// routes/mlRoutes.js
// Machine learning endpoints for data analysis features.
// All computations run in-process using simple-statistics (no Python needed).

const express = require('express');
const router = express.Router();
const ss = require('simple-statistics');
const ClickLog = require('../models/ClickLog');
const Conversation = require('../models/Conversation');

// ─── HELPERS ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

async function getMonthlyBreakdown() {
  const monthly = await ClickLog.aggregate([
    { $match: { converted: true } },
    { $group: { _id: { orderId: '$conversionData.orderId', month: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'America/Mexico_City' } } }, revenue: { $first: '$conversionData.totalAmount' } } },
    { $group: { _id: '$_id.month', revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  // For partial months, compute daily run rate and project full month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return monthly.map(m => {
    const [year, monthNum] = m._id.split('-');
    const isCurrentMonth = m._id === currentMonth;
    const dailyRate = isCurrentMonth && dayOfMonth > 0 ? m.revenue / dayOfMonth : null;
    const projected = isCurrentMonth ? Math.round(dailyRate * daysInMonth) : null;

    return {
      month: m._id,
      label: `${MONTH_NAMES[parseInt(monthNum) - 1]} ${year}`,
      revenue: Math.round(m.revenue),
      orders: m.orders,
      avgOrder: m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
      isPartial: isCurrentMonth,
      projected,
      dailyRate: dailyRate ? Math.round(dailyRate) : null
    };
  });
}

// ─── 1. SALES FORECAST ─────────────────────────────────────────────────────
// Day-of-week adjusted forecast with confidence bands and weekly moving average.
router.get('/forecast', async (req, res) => {
  try {
    const { days = 60 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // Daily revenue (deduplicated by orderId)
    const daily = await ClickLog.aggregate([
      { $match: { converted: true, createdAt: { $gte: since } } },
      { $group: { _id: { orderId: '$conversionData.orderId', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } } }, revenue: { $first: '$conversionData.totalAmount' } } },
      { $group: { _id: '$_id.date', revenue: { $sum: { $ifNull: ['$revenue', 0] } }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    if (daily.length < 7) {
      return res.json({ success: true, data: { history: [], forecast: [], trend: 0, r2: 0 } });
    }

    // ── Day-of-week average multipliers ──
    const DOW_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dowBuckets = [[], [], [], [], [], [], []];
    daily.forEach(d => {
      const dow = new Date(d._id + 'T12:00:00').getDay();
      dowBuckets[dow].push(d.revenue);
    });
    const overallMean = ss.mean(daily.map(d => d.revenue));
    const dowAvg = dowBuckets.map(b => b.length > 0 ? ss.mean(b) : overallMean);
    const dowMultiplier = dowAvg.map(a => overallMean > 0 ? a / overallMean : 1);

    // ── 7-day moving average for smoothed trend ──
    const movingAvg = daily.map((d, i) => {
      if (i < 6) return null;
      const window = daily.slice(i - 6, i + 1).map(w => w.revenue);
      return Math.round(ss.mean(window));
    });

    // ── Weekly aggregation ──
    const weeks = [];
    for (let i = 0; i < daily.length; i += 7) {
      const week = daily.slice(i, Math.min(i + 7, daily.length));
      if (week.length < 3) continue;
      weeks.push({
        startDate: week[0]._id,
        label: new Date(week[0]._id + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        revenue: Math.round(week.reduce((s, d) => s + d.revenue, 0)),
        orders: week.reduce((s, d) => s + d.orders, 0),
        days: week.length
      });
    }

    // ── Linear regression on WEEKLY data (much cleaner signal) ──
    const weeklyPoints = weeks.map((w, i) => [i, w.revenue]);
    const weeklyReg = weeklyPoints.length >= 3 ? ss.linearRegression(weeklyPoints) : { m: 0, b: overallMean * 7 };
    const weeklyLine = ss.linearRegressionLine(weeklyReg);
    const weeklyR2 = weeklyPoints.length >= 3 ? ss.rSquared(weeklyPoints, weeklyLine) : 0;

    // ── Confidence band (±1 std dev of residuals) ──
    const residuals = daily.map((d, i) => d.revenue - (overallMean * dowMultiplier[new Date(d._id + 'T12:00:00').getDay()]));
    const stdDev = ss.standardDeviation(residuals);

    // ── Format history ──
    const history = daily.map((d, i) => ({
      date: d._id,
      dateLabel: new Date(d._id + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      dow: DOW_NAMES[new Date(d._id + 'T12:00:00').getDay()],
      revenue: Math.round(d.revenue),
      orders: d.orders,
      movingAvg: movingAvg[i]
    }));

    // ── Forecast next 14 days with DOW adjustment + confidence ──
    // Use last 2 weeks' average as base, adjusted by day-of-week
    const last14 = daily.slice(-14);
    const recentBase = last14.length > 0 ? ss.mean(last14.map(d => d.revenue)) : overallMean;
    // Apply weekly trend from regression
    const weeklySlope = weeklyReg.m / 7; // per day

    const forecast = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i + 1);
      const dow = d.getDay();
      const trendAdj = recentBase + weeklySlope * i;
      const dowAdj = trendAdj * dowMultiplier[dow];
      const projected = Math.max(0, Math.round(dowAdj));
      forecast.push({
        date: d.toISOString().split('T')[0],
        dateLabel: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        dow: DOW_NAMES[dow],
        revenue: projected,
        upper: Math.round(projected + stdDev),
        lower: Math.max(0, Math.round(projected - stdDev)),
        orders: Math.max(0, Math.round(projected / (overallMean / ss.mean(daily.map(d => d.orders)) || 1)))
      });
    }

    // ── Trend ──
    const firstWeekAvg = ss.mean(daily.slice(0, 7).map(d => d.revenue));
    const lastWeekAvg = ss.mean(daily.slice(-7).map(d => d.revenue));
    const trend = firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg * 100) : 0;

    const totalHistoryRevenue = daily.reduce((s, d) => s + d.revenue, 0);
    const totalForecastRevenue = forecast.reduce((s, d) => s + d.revenue, 0);

    // ── Day-of-week summary ──
    const dowSummary = DOW_NAMES.map((name, i) => ({
      day: name,
      avg: Math.round(dowAvg[i]),
      multiplier: +dowMultiplier[i].toFixed(2),
      count: dowBuckets[i].length
    }));

    res.json({
      success: true,
      data: {
        history,
        forecast,
        weeks,
        dowSummary,
        trend: +trend.toFixed(1),
        r2: +weeklyR2.toFixed(3),
        slope: Math.round(weeklyReg.m),
        stdDev: Math.round(stdDev),
        totalHistoryRevenue: Math.round(totalHistoryRevenue),
        totalForecastRevenue: Math.round(totalForecastRevenue),
        avgDailyRevenue: Math.round(overallMean),
        monthly: await getMonthlyBreakdown()
      }
    });
  } catch (err) {
    console.error('❌ ML forecast error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 1a. ENHANCED FORECAST (MLOrder-based) ──────────────────────────────────
// Queries MLOrder for historical revenue with product family filtering.
// Supports: plain ML sales, Meta overlay, seasonality.
const MLOrder = require('../models/MLOrder');
const ProductFamily = require('../models/ProductFamily');

router.get('/forecast-v2', async (req, res) => {
  try {
    const {
      days = 90,
      reach = 'global',           // 'global' | 'product'
      channel = 'ml',             // 'ml' | 'manual' | 'campaigns'
      // Legacy compat: accept source/scope as aliases
      source, scope,
      productFamilyId,            // When reach=product
      campaignId,                 // When channel=campaigns (fbCampaignId or 'all')
      includeSubfamilies = 'true',
      seasonality = 'false'
    } = req.query;

    // Legacy compat
    const effectiveChannel = source === 'ml+meta' ? 'campaigns' : (channel || source || 'ml');
    const effectiveReach = scope === 'product' ? 'product' : (reach || scope || 'global');

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // ── BUILD PRODUCT FAMILY FILTER ──
    let familyFilter = null;
    if (productFamilyId) {
      // Get all descendant family IDs
      const familyIds = [productFamilyId];
      if (includeSubfamilies === 'true') {
        const queue = [productFamilyId];
        while (queue.length > 0) {
          const parentIds = queue.splice(0, queue.length);
          const children = await ProductFamily.find({ parentId: { $in: parentIds } }).select('_id').lean();
          for (const c of children) {
            familyIds.push(String(c._id));
            queue.push(c._id);
          }
        }
      }
      familyFilter = familyIds.map(id => {
        try { return require('mongoose').Types.ObjectId.createFromHexString(id); } catch { return null; }
      }).filter(Boolean);
    }

    // ── CAMPAIGN FILTER (resolve ad IDs belonging to the selected campaign) ──
    let campaignAdIds = null;
    if (effectiveChannel === 'campaigns' && campaignId && campaignId !== 'all') {
      const Ad = require('../models/Ad');
      const AdSet = require('../models/AdSet');
      const adSets = await AdSet.find({ campaignId: campaignId }).select('_id').lean();
      const adSetIds = adSets.map(s => s._id);
      const ads = await Ad.find({ adSetId: { $in: adSetIds } }).select('fbAdId').lean();
      campaignAdIds = ads.map(a => a.fbAdId);
      console.log(`📊 Campaign filter: ${campaignAdIds.length} ads for campaign ${campaignId}`);
    } else if (effectiveChannel === 'campaigns' && (!campaignId || campaignId === 'all')) {
      // All campaigns = all ads that have an adId (i.e. came from ads, not organic)
      campaignAdIds = 'all';
    }

    // ── QUERY DATA ──
    // Channel mapping: 'all' and 'online' and 'mercadolibre' all use MLOrder as base
    const useMLOrder = ['all', 'online', 'mercadolibre', 'ml'].includes(effectiveChannel);
    const includeManual = ['all', 'manual'].includes(effectiveChannel);
    const includeCampaigns = ['all', 'campaigns'].includes(effectiveChannel);
    let daily;

    if (effectiveChannel === 'manual') {
      // Manual sales only (CRM standalone sales)
      daily = await ClickLog.aggregate([
        { $match: { converted: true, correlationMethod: 'manual', createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } },
          revenue: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } },
          orders: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]);
    } else if (effectiveChannel === 'campaigns') {
      // Campaign-scoped: use ClickLog conversions (sales attributed to ads)
      const clMatch = { converted: true, createdAt: { $gte: since } };
      if (campaignAdIds !== 'all') {
        clMatch.adId = { $in: campaignAdIds };
      } else {
        clMatch.adId = { $ne: null };
      }

      daily = await ClickLog.aggregate([
        { $match: clMatch },
        { $group: {
          _id: { orderId: '$conversionData.orderId', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } } },
          revenue: { $first: { $ifNull: ['$conversionData.totalAmount', 0] } }
        }},
        { $group: {
          _id: '$_id.date',
          revenue: { $sum: '$revenue' },
          orders: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]);
    } else if (useMLOrder) {
      // ML-based channels: query MLOrder
      const mlMatch = { status: 'paid', dateCreated: { $gte: since } };
      const mlPipeline = [
        { $match: mlMatch },
        { $unwind: '$items' },
        ...(familyFilter ? [{ $match: { 'items.productFamilyId': { $in: familyFilter } } }] : []),
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$dateCreated', timezone: 'America/Mexico_City' } },
          revenue: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } },
          orders: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ];

      daily = await MLOrder.aggregate(mlPipeline);
    } else {
      daily = [];
    }

    // ── MANUAL SALES (merge when channel includes manual) ──
    let totalManualRevenue = 0;
    let totalManualOrders = 0;

    if (includeManual && effectiveChannel !== 'manual') {
      const manualDaily = await ClickLog.aggregate([
        { $match: { converted: true, correlationMethod: 'manual', createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } },
          revenue: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } },
          orders: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]);

      totalManualRevenue = manualDaily.reduce((s, d) => s + d.revenue, 0);
      totalManualOrders = manualDaily.reduce((s, d) => s + d.orders, 0);

      if (manualDaily.length > 0) {
        const dailyMap = new Map(daily.map(d => [d._id, { ...d }]));
        for (const md of manualDaily) {
          const existing = dailyMap.get(md._id);
          if (existing) {
            existing.revenue += md.revenue;
            existing.orders += md.orders;
            existing.manualRevenue = md.revenue;
            existing.manualOrders = md.orders;
          } else {
            dailyMap.set(md._id, {
              _id: md._id,
              revenue: md.revenue,
              orders: md.orders,
              manualRevenue: md.revenue,
              manualOrders: md.orders
            });
          }
        }
        for (const [, val] of dailyMap) {
          if (val.manualRevenue == null) {
            val.manualRevenue = 0;
            val.manualOrders = 0;
          }
        }
        daily = Array.from(dailyMap.values()).sort((a, b) => a._id.localeCompare(b._id));
      }
    }

    const manualSales = {
      totalRevenue: Math.round(totalManualRevenue),
      totalOrders: totalManualOrders
    };

    // ── META ATTRIBUTION OVERLAY — available for all/online/ml channels ──
    let metaAttribution = null;
    if (useMLOrder) {
      const clickDaily = await ClickLog.aggregate([
        { $match: { converted: true, createdAt: { $gte: since } } },
        { $group: {
          _id: { orderId: '$conversionData.orderId', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } } },
          revenue: { $first: '$conversionData.totalAmount' },
          adId: { $first: '$adId' }
        }},
        { $group: {
          _id: '$_id.date',
          adRevenue: { $sum: { $ifNull: ['$revenue', 0] } },
          adOrders: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]);

      // Build per-day ad attribution map
      const adByDate = new Map(clickDaily.map(d => [d._id, d]));
      const totalAdRevenue = clickDaily.reduce((s, d) => s + d.adRevenue, 0);
      const totalAdOrders = clickDaily.reduce((s, d) => s + d.adOrders, 0);
      const totalMLRevenue = daily.reduce((s, d) => s + d.revenue, 0);
      const totalMLOrders = daily.reduce((s, d) => s + d.orders, 0);

      // Enrich daily data with ad attribution (without changing revenue)
      daily = daily.map(d => {
        const ad = adByDate.get(d._id);
        return {
          ...d,
          adRevenue: ad?.adRevenue || 0,
          adOrders: ad?.adOrders || 0,
          organicRevenue: Math.max(0, d.revenue - (ad?.adRevenue || 0)),
          organicOrders: Math.max(0, d.orders - (ad?.adOrders || 0))
        };
      });

      metaAttribution = {
        totalAdRevenue: Math.round(totalAdRevenue),
        totalAdOrders,
        totalOrganicRevenue: Math.round(Math.max(0, totalMLRevenue - totalAdRevenue)),
        totalOrganicOrders: Math.max(0, totalMLOrders - totalAdOrders),
        adRevenuePercent: totalMLRevenue > 0 ? +(totalAdRevenue / totalMLRevenue * 100).toFixed(1) : 0
      };
    }

    if (daily.length < 7) {
      return res.json({ success: true, data: { history: [], forecast: [], trend: 0, r2: 0, source, productFamilyId: productFamilyId || null } });
    }

    // ── STANDARD FORECAST ALGORITHM (same as v1) ──
    const DOW_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dowBuckets = [[], [], [], [], [], [], []];
    daily.forEach(d => {
      const dow = new Date(d._id + 'T12:00:00').getDay();
      dowBuckets[dow].push(d.revenue);
    });
    const overallMean = ss.mean(daily.map(d => d.revenue));
    const dowAvg = dowBuckets.map(b => b.length > 0 ? ss.mean(b) : overallMean);
    const dowMultiplier = dowAvg.map(a => overallMean > 0 ? a / overallMean : 1);

    // Moving average
    const movingAvg = daily.map((d, i) => {
      if (i < 6) return null;
      return Math.round(ss.mean(daily.slice(i - 6, i + 1).map(w => w.revenue)));
    });

    // Weekly aggregation + regression
    const weeks = [];
    for (let i = 0; i < daily.length; i += 7) {
      const week = daily.slice(i, Math.min(i + 7, daily.length));
      if (week.length < 3) continue;
      weeks.push({
        startDate: week[0]._id,
        label: new Date(week[0]._id + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        revenue: Math.round(week.reduce((s, d) => s + d.revenue, 0)),
        orders: week.reduce((s, d) => s + d.orders, 0),
        days: week.length
      });
    }

    const weeklyPoints = weeks.map((w, i) => [i, w.revenue]);
    const weeklyReg = weeklyPoints.length >= 3 ? ss.linearRegression(weeklyPoints) : { m: 0, b: overallMean * 7 };
    const weeklyLine = ss.linearRegressionLine(weeklyReg);
    const weeklyR2 = weeklyPoints.length >= 3 ? ss.rSquared(weeklyPoints, weeklyLine) : 0;

    const residuals = daily.map(d => d.revenue - (overallMean * dowMultiplier[new Date(d._id + 'T12:00:00').getDay()]));
    const stdDev = ss.standardDeviation(residuals);

    // ── SEASONALITY (month-of-year multipliers from full history) ──
    let monthMultiplier = Array(12).fill(1); // default: no adjustment
    if (seasonality === 'true') {
      // Get ALL MLOrder monthly data for seasonality
      const allMonthly = await MLOrder.aggregate([
        { $match: { status: 'paid' } },
        ...(familyFilter ? [{ $unwind: '$items' }, { $match: { 'items.productFamilyId': { $in: familyFilter } } }] : []),
        { $group: {
          _id: { month: { $month: '$dateCreated' }, year: { $year: '$dateCreated' } },
          revenue: { $sum: familyFilter ? { $multiply: ['$items.unitPrice', '$items.quantity'] } : '$totalAmount' }
        }},
        { $group: {
          _id: '$_id.month',
          avgRevenue: { $avg: '$revenue' },
          count: { $sum: 1 }
        }}
      ]);

      if (allMonthly.length >= 6) {
        const monthlyAvgs = Array(12).fill(0);
        allMonthly.forEach(m => { monthlyAvgs[m._id - 1] = m.avgRevenue; });
        const monthlyMean = ss.mean(monthlyAvgs.filter(v => v > 0));
        if (monthlyMean > 0) {
          monthMultiplier = monthlyAvgs.map(v => v > 0 ? v / monthlyMean : 1);
        }
      }
    }

    // History
    const history = daily.map((d, i) => ({
      date: d._id,
      dateLabel: new Date(d._id + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      dow: DOW_NAMES[new Date(d._id + 'T12:00:00').getDay()],
      revenue: Math.round(d.revenue),
      orders: d.orders,
      movingAvg: movingAvg[i],
      manualRevenue: Math.round(d.manualRevenue || 0),
      ...(d.adRevenue != null ? {
        adRevenue: Math.round(d.adRevenue),
        organicRevenue: Math.round(d.organicRevenue)
      } : {})
    }));

    // Forecast (14 days)
    const last14 = daily.slice(-14);
    const recentBase = last14.length > 0 ? ss.mean(last14.map(d => d.revenue)) : overallMean;
    const weeklySlope = weeklyReg.m / 7;

    const forecast = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i + 1);
      const dow = d.getDay();
      const month = d.getMonth();
      const trendAdj = recentBase + weeklySlope * i;
      const dowAdj = trendAdj * dowMultiplier[dow];
      const seasonAdj = dowAdj * monthMultiplier[month];
      const projected = Math.max(0, Math.round(seasonAdj));
      forecast.push({
        date: d.toISOString().split('T')[0],
        dateLabel: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        dow: DOW_NAMES[dow],
        revenue: projected,
        upper: Math.round(projected + stdDev),
        lower: Math.max(0, Math.round(projected - stdDev)),
        orders: Math.max(0, Math.round(projected / (overallMean / ss.mean(daily.map(d => d.orders)) || 1)))
      });
    }

    const firstWeekAvg = ss.mean(daily.slice(0, 7).map(d => d.revenue));
    const lastWeekAvg = ss.mean(daily.slice(-7).map(d => d.revenue));
    const trend = firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg * 100) : 0;

    const totalHistoryRevenue = daily.reduce((s, d) => s + d.revenue, 0);
    const totalForecastRevenue = forecast.reduce((s, d) => s + d.revenue, 0);

    const dowSummary = DOW_NAMES.map((name, i) => ({
      day: name,
      avg: Math.round(dowAvg[i]),
      multiplier: +dowMultiplier[i].toFixed(2),
      count: dowBuckets[i].length
    }));

    // Monthly breakdown from MLOrder
    const mlMonthly = await MLOrder.aggregate([
      { $match: { status: 'paid' } },
      ...(familyFilter ? [{ $unwind: '$items' }, { $match: { 'items.productFamilyId': { $in: familyFilter } } }] : []),
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$dateCreated', timezone: 'America/Mexico_City' } },
        revenue: { $sum: familyFilter ? { $multiply: ['$items.unitPrice', '$items.quantity'] } : '$totalAmount' },
        orders: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const monthly = mlMonthly.map(m => {
      const [year, monthNum] = m._id.split('-');
      const isCurrentMonth = m._id === currentMonth;
      const dailyRate = isCurrentMonth && dayOfMonth > 0 ? m.revenue / dayOfMonth : null;
      return {
        month: m._id,
        label: `${MONTH_NAMES[parseInt(monthNum) - 1]} ${year}`,
        revenue: Math.round(m.revenue),
        orders: m.orders,
        avgOrder: m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
        isPartial: isCurrentMonth,
        projected: isCurrentMonth ? Math.round(dailyRate * daysInMonth) : null,
        dailyRate: dailyRate ? Math.round(dailyRate) : null
      };
    });

    // Seasonality summary (if enabled)
    const seasonSummary = seasonality === 'true' ? MONTH_NAMES.map((name, i) => ({
      month: name,
      multiplier: +monthMultiplier[i].toFixed(2)
    })) : null;

    res.json({
      success: true,
      data: {
        reach: effectiveReach,
        channel: effectiveChannel,
        productFamilyId: productFamilyId || null,
        campaignId: campaignId || null,
        seasonality: seasonality === 'true',
        history,
        forecast,
        weeks,
        dowSummary,
        trend: +trend.toFixed(1),
        r2: +weeklyR2.toFixed(3),
        slope: Math.round(weeklyReg.m),
        stdDev: Math.round(stdDev),
        totalHistoryRevenue: Math.round(totalHistoryRevenue),
        totalForecastRevenue: Math.round(totalForecastRevenue),
        avgDailyRevenue: Math.round(overallMean),
        monthly,
        seasonSummary,
        metaAttribution,
        manualSales
      }
    });
  } catch (err) {
    console.error('❌ ML forecast-v2 error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/forecast-v2/families — Available product families for filtering
router.get('/forecast-v2/families', async (req, res) => {
  try {
    // Get root families that have MLOrder data
    const familiesWithOrders = await MLOrder.aggregate([
      { $match: { status: 'paid' } },
      { $unwind: '$items' },
      { $match: { 'items.productFamilyId': { $ne: null } } },
      { $group: { _id: '$items.productFamilyId', orders: { $sum: 1 }, revenue: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } } } },
      { $sort: { revenue: -1 } }
    ]);

    // Resolve family names and walk up to root
    const allFamilies = await ProductFamily.find({}).select('name parentId sellable').lean();
    const familyMap = new Map(allFamilies.map(f => [String(f._id), f]));

    const result = [];
    const seenRoots = new Set();

    for (const fwo of familiesWithOrders) {
      // Walk up to find root and intermediate families
      let current = familyMap.get(String(fwo._id));
      if (!current) continue;

      const path = [{ id: String(fwo._id), name: current.name }];
      while (current?.parentId) {
        const parent = familyMap.get(String(current.parentId));
        if (parent) {
          path.unshift({ id: String(current.parentId), name: parent.name });
          current = parent;
        } else break;
      }

      // Add root if not seen
      const root = path[0];
      if (!seenRoots.has(root.id)) {
        seenRoots.add(root.id);
        // Get children of this root
        const children = allFamilies
          .filter(f => String(f.parentId) === root.id && !f.sellable)
          .map(f => ({ id: String(f._id), name: f.name }));

        result.push({
          id: root.id,
          name: root.name,
          children,
          orders: fwo.orders,
          revenue: Math.round(fwo.revenue)
        });
      }
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/forecast-v2/campaigns — Available campaigns for filtering
router.get('/forecast-v2/campaigns', async (req, res) => {
  try {
    const Campaign = require('../models/Campaign');
    const campaigns = await Campaign.find({})
      .select('name fbCampaignId status')
      .sort({ status: 1, name: 1 })
      .lean();
    res.json({
      success: true,
      data: campaigns.map(c => ({
        id: c._id,
        fbCampaignId: c.fbCampaignId,
        name: c.name,
        status: c.status
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ml/forecast-v2/sim-params — Real campaign parameters for the simulator
router.get('/forecast-v2/sim-params', async (req, res) => {
  try {
    const Campaign = require('../models/Campaign');
    const AdSet = require('../models/AdSet');
    const Ad = require('../models/Ad');

    // Active campaigns with budget and objective
    const campaigns = await Campaign.find({ status: 'ACTIVE' })
      .select('name fbCampaignId objective effectiveStatus dailyBudget lifetimeBudget buyingType metrics')
      .lean();

    // Active ad sets with targeting
    const adSets = await AdSet.find({ status: 'ACTIVE' })
      .select('name fbAdSetId campaignId optimizationGoal billingEvent dailyBudget targeting metrics effectiveStatus')
      .lean();

    // Count active ads per campaign
    const adCounts = await Ad.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $lookup: { from: 'adsets', localField: 'adSetId', foreignField: '_id', as: 'adset' } },
      { $unwind: '$adset' },
      { $group: { _id: '$adset.campaignId', activeAds: { $sum: 1 } } }
    ]);
    const adCountMap = Object.fromEntries(adCounts.map(a => [String(a._id), a.activeAds]));

    // Total active ads
    const totalActiveAds = await Ad.countDocuments({ status: 'ACTIVE' });

    // Aggregate budget
    const totalDailyBudget = campaigns.reduce((s, c) => s + (c.dailyBudget || 0), 0);

    // Objective breakdown
    const objectives = {};
    campaigns.forEach(c => {
      const obj = c.objective || 'UNKNOWN';
      objectives[obj] = (objectives[obj] || 0) + 1;
    });

    // Targeting summary from ad sets
    const allLocations = new Set();
    const ageRange = { min: 65, max: 13 };
    adSets.forEach(as => {
      if (as.targeting?.locations) as.targeting.locations.forEach(l => allLocations.add(l));
      if (as.targeting?.ageMin && as.targeting.ageMin < ageRange.min) ageRange.min = as.targeting.ageMin;
      if (as.targeting?.ageMax && as.targeting.ageMax > ageRange.max) ageRange.max = as.targeting.ageMax;
    });

    // Ad type breakdown (click vs presence)
    const adTypes = { click: 0, presence: 0, other: 0 };
    const clickObjectives = ['OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'LINK_CLICKS', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'];
    const presenceObjectives = ['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS', 'OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'VIDEO_VIEWS'];
    campaigns.forEach(c => {
      const obj = (c.objective || '').toUpperCase();
      if (clickObjectives.some(o => obj.includes(o))) adTypes.click++;
      else if (presenceObjectives.some(o => obj.includes(o))) adTypes.presence++;
      else adTypes.other++;
    });

    res.json({
      success: true,
      data: {
        campaigns: campaigns.map(c => ({
          id: c.fbCampaignId,
          name: c.name,
          objective: c.objective,
          effectiveStatus: c.effectiveStatus,
          dailyBudget: c.dailyBudget,
          lifetimeBudget: c.lifetimeBudget,
          activeAds: adCountMap[String(c._id)] || 0,
          spend: c.metrics?.spend || 0,
          impressions: c.metrics?.impressions || 0,
          frequency: c.metrics?.frequency || 0
        })),
        summary: {
          totalCampaigns: campaigns.length,
          totalActiveAds,
          totalDailyBudget: Math.round(totalDailyBudget),
          objectives,
          adTypes,
          targetLocations: [...allLocations],
          targetAgeRange: ageRange.min < 65 ? ageRange : null
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 1b. PRODUCT-LEVEL FORECAST ─────────────────────────────────────────────
// Per-product daily revenue with individual linear regressions.
router.get('/forecast-by-product', async (req, res) => {
  try {
    const { days = 60 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // Daily revenue per product (deduplicated by orderId)
    const raw = await ClickLog.aggregate([
      { $match: { converted: true, createdAt: { $gte: since }, 'conversionData.itemTitle': { $ne: null } } },
      { $group: {
        _id: { orderId: '$conversionData.orderId', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } } },
        revenue: { $first: '$conversionData.totalAmount' },
        item: { $first: '$conversionData.itemTitle' }
      }},
      { $group: {
        _id: { item: '$item', date: '$_id.date' },
        revenue: { $sum: '$revenue' },
        orders: { $sum: 1 }
      }},
      { $sort: { '_id.date': 1 } }
    ]);

    // Also get totals per product for ranking
    const productTotals = await ClickLog.aggregate([
      { $match: { converted: true, createdAt: { $gte: since }, 'conversionData.itemTitle': { $ne: null } } },
      { $group: { _id: '$conversionData.orderId', revenue: { $first: '$conversionData.totalAmount' }, item: { $first: '$conversionData.itemTitle' } } },
      { $group: { _id: '$item', revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
      { $limit: 10 }
    ]);

    // Build per-product forecasts
    const products = productTotals.map(pt => {
      const dailyData = raw
        .filter(r => r._id.item === pt._id)
        .map(r => ({ date: r._id.date, revenue: r.revenue, orders: r.orders }));

      // Run regression if enough data
      let forecast = [];
      let trend = 0;
      let r2 = 0;
      let slope = 0;

      if (dailyData.length >= 7) {
        const points = dailyData.map((d, i) => [i, d.revenue]);
        const regression = ss.linearRegression(points);
        const line = ss.linearRegressionLine(regression);
        r2 = +ss.rSquared(points, line).toFixed(3);
        slope = Math.round(regression.m);

        const firstWeekAvg = ss.mean(dailyData.slice(0, 7).map(d => d.revenue));
        const lastWeekAvg = ss.mean(dailyData.slice(-7).map(d => d.revenue));
        trend = firstWeekAvg > 0 ? +((lastWeekAvg - firstWeekAvg) / firstWeekAvg * 100).toFixed(1) : 0;

        // 7-day forecast
        const lastIdx = points.length;
        for (let i = 0; i < 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() + i + 1);
          forecast.push({
            date: d.toISOString().split('T')[0],
            dateLabel: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
            revenue: Math.max(0, Math.round(line(lastIdx + i)))
          });
        }
      }

      // Normalize product name to just the size (e.g., "6mx4m")
      const title = pt._id || '';
      const sizeMatch = title.match(/(\d+)\s*m?\s*[xX×]\s*(\d+)\s*m/);
      let shortName;
      if (sizeMatch) {
        shortName = `${sizeMatch[1]}x${sizeMatch[2]}m`;
      } else {
        shortName = title
          .replace(/Malla Sombra 90%\s*Raschell?\s*Beige\s*(De\s*)?/i, '')
          .replace(/Lona Sombra\s*(90%\s*Raschel\s*Beige\s*(De\s*)?)?/i, 'Lona ')
          .replace(/\s*Reforzada\s*Hanlob\s*$/i, '')
          .replace(/\s*Reforzada?\s*$/i, '')
          .replace(/\s*Lista Para Instalar\s*/i, '')
          .trim();
      }

      return {
        name: shortName || pt._id,
        fullName: pt._id,
        totalRevenue: Math.round(pt.revenue),
        totalOrders: pt.orders,
        avgOrder: pt.orders > 0 ? Math.round(pt.revenue / pt.orders) : 0,
        daily: dailyData.map(d => ({
          ...d,
          dateLabel: new Date(d.date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
        })),
        forecast,
        forecastRevenue: forecast.reduce((s, f) => s + f.revenue, 0),
        trend,
        r2,
        slope
      };
    });

    // Enrich with ad spend + promo info per product
    // Link: product title → adId (from ClickLogs) → Ad (promoId, name) → FB spend
    const Ad = require('../models/Ad');
    require('../models/Promo');
    const axios = require('axios');

    // Get FB spend per ad
    let spendByAd = {};
    try {
      const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID;
      const ACCESS_TOKEN = process.env.FB_MARKETING_TOKEN;
      if (AD_ACCOUNT_ID && ACCESS_TOKEN) {
        const sinceStr = since.toISOString().split('T')[0];
        const untilStr = new Date().toISOString().split('T')[0];
        const { data: fbData } = await axios.get(`https://graph.facebook.com/v25.0/${AD_ACCOUNT_ID}/insights`, {
          params: {
            access_token: ACCESS_TOKEN,
            fields: 'ad_id,spend',
            level: 'ad',
            time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
            limit: 500
          }
        });
        (fbData.data || []).forEach(r => { spendByAd[r.ad_id] = parseFloat(r.spend || 0); });
      }
    } catch (e) { console.error('FB spend lookup failed:', e.message); }

    // Get ad info (promo, name) and link ads to products
    const adDocs = await Ad.find({}, 'fbAdId name promoId').populate('promoId', 'name').lean();
    const adInfoMap = {};
    adDocs.forEach(a => { adInfoMap[a.fbAdId] = { name: a.name, promo: a.promoId?.name || null }; });

    // Map: which adIds drove sales for each product, with revenue per (ad, product)
    const productAdMap = await ClickLog.aggregate([
      { $match: { converted: true, createdAt: { $gte: since }, adId: { $ne: null }, 'conversionData.itemTitle': { $ne: null } } },
      { $group: { _id: { orderId: '$conversionData.orderId', item: '$conversionData.itemTitle', adId: '$adId' }, revenue: { $first: '$conversionData.totalAmount' } } },
      { $group: { _id: { item: '$_id.item', adId: '$_id.adId' }, revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } }
    ]);

    // Total revenue per ad (across all products) — used to split spend proportionally
    const totalRevenueByAd = {};
    for (const row of productAdMap) {
      const adId = row._id.adId;
      totalRevenueByAd[adId] = (totalRevenueByAd[adId] || 0) + (row.revenue || 0);
    }

    // Build per-product driver info with proportional spend allocation
    const productDrivers = {};
    for (const row of productAdMap) {
      const item = row._id.item;
      const adId = row._id.adId;
      if (!productDrivers[item]) productDrivers[item] = { totalSpend: 0, promos: new Set(), ads: [] };
      const adTotalSpend = spendByAd[adId] || 0;
      const adTotalRevenue = totalRevenueByAd[adId] || 1;
      // Allocate spend proportionally: this product's revenue / total ad revenue * ad spend
      const allocatedSpend = adTotalRevenue > 0 ? adTotalSpend * ((row.revenue || 0) / adTotalRevenue) : 0;
      const info = adInfoMap[adId] || {};
      productDrivers[item].totalSpend += allocatedSpend;
      if (info.promo) productDrivers[item].promos.add(info.promo);
      productDrivers[item].ads.push({ adId, name: info.name || adId, spend: Math.round(allocatedSpend), orders: row.orders, promo: info.promo });
    }

    // Attach driver info to each product
    products.forEach(p => {
      const driver = productDrivers[p.fullName] || { totalSpend: 0, promos: new Set(), ads: [] };
      const hasAdSpend = driver.totalSpend > 0;
      const hasPromo = driver.promos.size > 0;

      p.adSpend = Math.round(driver.totalSpend);
      p.promos = [...driver.promos];
      p.topAds = driver.ads.slice(0, 3);
      p.roi = driver.totalSpend > 0 ? +(p.totalRevenue / driver.totalSpend).toFixed(1) : null;

      // Growth driver classification
      if (hasPromo && hasAdSpend) p.driver = 'promo_paid';
      else if (hasAdSpend) p.driver = 'paid';
      else p.driver = 'organic';

      p.driverLabel = p.driver === 'promo_paid' ? 'Promo + Ads'
        : p.driver === 'paid' ? 'Ads pagados'
        : 'Orgánico';
    });

    res.json({
      success: true,
      data: {
        products,
        period: parseInt(days),
        totalProducts: productTotals.length
      }
    });
  } catch (err) {
    console.error('❌ ML product forecast error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 2. CUSTOMER SEGMENTATION ───────────────────────────────────────────────
// Cross-tab analysis: State × Gender × Product Size breakdown.
// Helper: fetch orders for a date range
async function fetchSegmentOrders(dateFrom, dateTo) {
  const dateMatch = {};
  if (dateFrom) dateMatch.$gte = new Date(dateFrom);
  if (dateTo) dateMatch.$lte = new Date(dateTo);
  const hasDate = Object.keys(dateMatch).length > 0;

  return ClickLog.aggregate([
    { $match: { converted: true, 'conversionData.orderId': { $ne: null }, ...(hasDate ? { createdAt: dateMatch } : {}) } },
    { $group: {
      _id: '$conversionData.orderId',
      revenue: { $first: '$conversionData.totalAmount' },
      state: { $first: '$conversionData.shippingState' },
      gender: { $first: '$conversionData.buyerGender' },
      item: { $first: '$conversionData.itemTitle' }
    }}
  ]);
}

// Helper: compute aggregates from a list of orders
function computeSegments(orders) {
  const getSize = (title) => {
    if (!title) return 'Otro';
    const m = title.match(/(\d+)\s*m?\s*[xX×]\s*(\d+)\s*m/);
    return m ? `${m[1]}x${m[2]}m` : 'Otro';
  };

  const stateGenderRaw = {};
  const sizeGenderRaw = {};
  const genderTotals = { male: 0, female: 0, unknown: 0 };
  orders.forEach(o => {
    const state = o.state || 'Desconocido';
    const gender = o.gender || 'unknown';
    if (!stateGenderRaw[state]) stateGenderRaw[state] = { male: 0, female: 0, unknown: 0, total: 0, revenue: 0 };
    stateGenderRaw[state][gender]++;
    stateGenderRaw[state].total++;
    stateGenderRaw[state].revenue += (o.revenue || 0);

    const size = getSize(o.item);
    if (!sizeGenderRaw[size]) sizeGenderRaw[size] = { male: 0, female: 0, unknown: 0, total: 0, revenue: 0 };
    sizeGenderRaw[size][gender]++;
    sizeGenderRaw[size].total++;
    sizeGenderRaw[size].revenue += (o.revenue || 0);

    genderTotals[gender]++;
  });

  return { stateGenderRaw, sizeGenderRaw, genderTotals, totalCustomers: orders.length };
}

// Helper: SHARE-of-total delta — measures composition shift, not volume.
// Returns percentage-point change in this segment's share of all orders.
// Useful to detect "tilting toward X" even when absolute numbers all drop.
function shareTrend(currentCount, currentTotal, previousCount, previousTotal) {
  if (!currentTotal) return { pp: 0, direction: 'flat', currentShare: 0, previousShare: 0 };
  const currentShare = (currentCount / currentTotal) * 100;
  if (!previousTotal || previousCount === undefined) {
    return { pp: null, direction: 'new', currentShare: Math.round(currentShare * 10) / 10, previousShare: 0 };
  }
  const previousShare = (previousCount / previousTotal) * 100;
  const pp = Math.round((currentShare - previousShare) * 10) / 10; // percentage points, 1 decimal
  let direction = 'flat';
  if (pp >= 2) direction = 'gaining';
  else if (pp <= -2) direction = 'losing';
  return { pp, direction, currentShare: Math.round(currentShare * 10) / 10, previousShare: Math.round(previousShare * 10) / 10 };
}

router.get('/segments', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Compute previous period (same length, immediately before)
    let prevFrom = null, prevTo = null;
    if (dateFrom && dateTo) {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      const lengthMs = to - from;
      prevTo = new Date(from.getTime() - 1).toISOString();
      prevFrom = new Date(from.getTime() - lengthMs - 1).toISOString();
    }

    const [orders, prevOrders] = await Promise.all([
      fetchSegmentOrders(dateFrom, dateTo),
      prevFrom ? fetchSegmentOrders(prevFrom, prevTo) : Promise.resolve([])
    ]);

    if (orders.length < 20) {
      return res.json({ success: true, data: { stateGender: [], topSizes: [], totalCustomers: 0, trends: null } });
    }

    const current = computeSegments(orders);
    const previous = computeSegments(prevOrders);

    const currentTotal = orders.length;
    const previousTotal = prevOrders.length;

    // 1. State × Gender cross-tab (top 12 states) — with SHARE trend per state
    const stateGender = Object.entries(current.stateGenderRaw)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 12)
      .map(([state, data]) => {
        const prev = previous.stateGenderRaw[state];
        return {
          state,
          male: data.male,
          female: data.female,
          unknown: data.unknown,
          total: data.total,
          revenue: Math.round(data.revenue),
          malePercent: Math.round(data.male / data.total * 100),
          femalePercent: Math.round(data.female / data.total * 100),
          avgOrder: Math.round(data.revenue / data.total),
          trend: shareTrend(data.total, currentTotal, prev?.total || 0, previousTotal)
        };
      });

    // 2. Top product sizes — with SHARE trend per size
    const topSizes = Object.entries(current.sizeGenderRaw)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([size, data]) => {
        const prev = previous.sizeGenderRaw[size];
        return {
          size,
          male: data.male,
          female: data.female,
          total: data.total,
          revenue: Math.round(data.revenue),
          malePercent: Math.round(data.male / data.total * 100),
          femalePercent: Math.round(data.female / data.total * 100),
          avgOrder: Math.round(data.revenue / data.total),
          trend: shareTrend(data.total, currentTotal, prev?.total || 0, previousTotal)
        };
      });

    // 3. Global gender split — SHARE trends (who's tilting toward whom?)
    const genderTotals = current.genderTotals;
    const genderTrends = {
      male: shareTrend(genderTotals.male, currentTotal, previous.genderTotals.male, previousTotal),
      female: shareTrend(genderTotals.female, currentTotal, previous.genderTotals.female, previousTotal),
      unknown: shareTrend(genderTotals.unknown, currentTotal, previous.genderTotals.unknown, previousTotal)
    };

    res.json({
      success: true,
      data: {
        stateGender,
        topSizes,
        genderTotals,
        genderTrends,
        totalCustomers: orders.length,
        previousPeriod: {
          totalCustomers: prevOrders.length,
          dateFrom: prevFrom,
          dateTo: prevTo
        }
      }
    });
  } catch (err) {
    console.error('❌ ML segments error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 3. CONVERSION PROBABILITY ──────────────────────────────────────────────
// Logistic-regression-style scoring based on feature weights.
router.get('/conversion-probability', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // Get recent click trails (last N days)
    const allClicks = await ClickLog.aggregate([
      { $match: { createdAt: { $gte: since }, adId: { $ne: null } } },
      { $group: {
        _id: '$psid',
        links: { $sum: 1 },
        clicks: { $sum: { $cond: ['$clicked', 1, 0] } },
        converted: { $max: { $cond: ['$converted', 1, 0] } },
        revenue: { $sum: { $cond: ['$converted', { $ifNull: ['$conversionData.totalAmount', 0] }, 0] } },
        lastProduct: { $last: '$productName' },
        adId: { $first: '$adId' },
        lastActivity: { $max: '$createdAt' }
      }},
      { $match: { _id: { $ne: null } } }
    ]);

    // Compute historical conversion rate by feature for weighting
    const totalConverted = allClicks.filter(c => c.converted).length;
    const totalNot = allClicks.filter(c => !c.converted).length;
    const baseRate = totalConverted / (totalConverted + totalNot || 1);

    // Score each lead
    const leads = allClicks
      .filter(c => !c.converted) // Only unconverted leads
      .map(c => {
        let score = baseRate;

        // Feature 1: Click-through (clicked at least one link)
        if (c.clicks > 0) score += 0.25;

        // Feature 2: Multiple links = more interest
        if (c.links >= 3) score += 0.1;
        if (c.links >= 5) score += 0.05;

        // Feature 3: Recent activity (within 24h = hot)
        const hoursAgo = (Date.now() - new Date(c.lastActivity).getTime()) / 3600000;
        if (hoursAgo < 24) score += 0.15;
        else if (hoursAgo < 72) score += 0.05;

        // Cap at 0.95
        const probability = Math.min(0.95, Math.max(0.05, score));

        return {
          psid: c._id,
          links: c.links,
          clicks: c.clicks,
          product: c.lastProduct || 'N/A',
          probability: Math.round(probability * 100),
          hoursAgo: Math.round(hoursAgo),
          status: probability >= 0.7 ? 'hot' : probability >= 0.4 ? 'warm' : 'cold'
        };
      })
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 50);

    // Enrich with conversation names
    const psids = leads.map(l => l.psid);
    const convos = await Conversation.find(
      { psid: { $in: psids } },
      'psid extractedName crmName userName'
    ).lean();
    const nameMap = {};
    convos.forEach(c => {
      nameMap[c.psid] = c.extractedName || c.crmName || c.userName || null;
    });
    leads.forEach(l => { l.name = nameMap[l.psid] || l.psid.slice(-10); });

    // Feature importance (based on the weight contribution above)
    const featureImportance = [
      { name: 'Click en link', importance: 35 },
      { name: 'Actividad reciente', importance: 25 },
      { name: 'Links generados', importance: 20 },
      { name: 'Tasa base de conversión', importance: 20 }
    ];

    const hot = leads.filter(l => l.status === 'hot').length;
    const warm = leads.filter(l => l.status === 'warm').length;
    const cold = leads.filter(l => l.status === 'cold').length;

    res.json({
      success: true,
      data: {
        leads,
        featureImportance,
        summary: { hot, warm, cold, baseRate: Math.round(baseRate * 100) },
        totalAnalyzed: allClicks.length
      }
    });
  } catch (err) {
    console.error('❌ ML conversion error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 4. AD SPEND OPTIMIZATION ───────────────────────────────────────────────
// Spend vs conversions per ad — identifies diminishing returns.
router.get('/spend-optimization', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const axios = require('axios');

    const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID;
    const ACCESS_TOKEN = process.env.FB_MARKETING_TOKEN;
    if (!AD_ACCOUNT_ID || !ACCESS_TOKEN) {
      return res.status(500).json({ success: false, error: 'FB credentials not configured' });
    }

    const since = dateFrom?.split('T')[0] || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const until = dateTo?.split('T')[0] || new Date().toISOString().split('T')[0];

    // Get FB spend per ad
    const { data: fbData } = await axios.get(`https://graph.facebook.com/v25.0/${AD_ACCOUNT_ID}/insights`, {
      params: {
        access_token: ACCESS_TOKEN,
        fields: 'ad_name,ad_id,spend,impressions,clicks',
        level: 'ad',
        time_range: JSON.stringify({ since, until }),
        limit: 500
      }
    });

    // Get our conversion data per ad (deduplicated)
    const dateMatch = {};
    if (dateFrom) dateMatch.$gte = new Date(dateFrom);
    if (dateTo) dateMatch.$lte = new Date(dateTo);
    const hasDate = Object.keys(dateMatch).length > 0;

    const convData = await ClickLog.aggregate([
      { $match: { converted: true, adId: { $ne: null }, ...(hasDate ? { createdAt: dateMatch } : {}) } },
      { $group: { _id: { orderId: '$conversionData.orderId', adId: '$adId' }, revenue: { $first: '$conversionData.totalAmount' } } },
      { $group: { _id: '$_id.adId', conversions: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$revenue', 0] } } } }
    ]);

    const convMap = {};
    convData.forEach(c => convMap[c._id] = c);

    // Product breakdown per ad — what actually sold vs what the ad promoted
    const productBreakdown = await ClickLog.aggregate([
      { $match: { converted: true, adId: { $ne: null }, ...(hasDate ? { createdAt: dateMatch } : {}) } },
      { $group: { _id: { orderId: '$conversionData.orderId', adId: '$adId' }, item: { $first: '$conversionData.itemTitle' }, revenue: { $first: '$conversionData.totalAmount' } } },
      { $group: { _id: { adId: '$_id.adId', item: '$item' }, count: { $sum: 1 }, revenue: { $sum: '$revenue' } } },
      { $sort: { count: -1 } }
    ]);

    // Build per-ad product map — keep both short label and the original title
    // so we can match by category keywords (e.g. "confeccionada"), not just size.
    const adProductMap = {};
    for (const row of productBreakdown) {
      const adId = row._id.adId;
      if (!adProductMap[adId]) adProductMap[adId] = [];
      const title = row._id.item || '';
      const sizeMatch = title.match(/(\d+)\s*m?\s*[xX×]\s*(\d+)\s*m/);
      const shortName = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}m` : title.slice(0, 30);
      adProductMap[adId].push({
        product: shortName,
        fullTitle: title,
        count: row.count,
        revenue: Math.round(row.revenue)
      });
    }

    // Also get stored metrics as fallback (from FB sync)
    const Ad = require('../models/Ad');
    const ConvoFlowManifest = require('../models/ConvoFlowManifest');
    const ProductFamily = require('../models/ProductFamily');
    require('../models/Promo');
    const adDocs = await Ad.find({}, 'fbAdId name convoFlowRef promoId metrics').populate('promoId', 'name promoProductIds').lean();

    // Build per-ad set of on-target SIZES by walking the targeted ProductFamily tree.
    // Sizes are normalized to lower-case "WxHm" form for comparison against the sold item's size.
    const normalizeSize = (str) => {
      if (!str) return null;
      const m = String(str).toLowerCase().match(/(\d+(?:\.\d+)?)\s*m?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*m?/);
      return m ? `${m[1]}x${m[2]}m` : null;
    };

    // Collect all distinct ConvoFlow refs used by ads
    const convoFlowRefs = [...new Set(adDocs.map(a => a.convoFlowRef).filter(Boolean))];
    const manifestByName = {};
    if (convoFlowRefs.length > 0) {
      const manifests = await ConvoFlowManifest.find({ name: { $in: convoFlowRefs } })
        .populate('products', '_id name')
        .lean();
      manifests.forEach(m => { manifestByName[m.name] = m; });
    }

    // For each manifest, fetch the descendant sellable products and collect their sizes
    const adTargetSizesMap = {}; // fbAdId -> Set<sizeStr>
    for (const ad of adDocs) {
      if (!ad.fbAdId) continue;
      const manifest = ad.convoFlowRef ? manifestByName[ad.convoFlowRef] : null;
      if (!manifest?.products?.length) continue;
      const rootIds = manifest.products.map(p => p._id);
      // BFS down the tree to gather all descendant family names
      let frontier = rootIds;
      const allNames = new Set();
      const safetyMax = 5; // up to 5 levels deep
      for (let depth = 0; depth < safetyMax && frontier.length > 0; depth++) {
        const families = await ProductFamily.find({ _id: { $in: frontier } }).select('_id name').lean();
        families.forEach(f => { if (f.name) allNames.add(f.name); });
        const children = await ProductFamily.find({ parentId: { $in: frontier } }).select('_id name').lean();
        if (children.length === 0) break;
        children.forEach(c => { if (c.name) allNames.add(c.name); });
        frontier = children.map(c => c._id);
      }
      // Extract sizes from family names
      const sizes = new Set();
      allNames.forEach(n => {
        const s = normalizeSize(n);
        if (s) sizes.add(s);
      });
      if (sizes.size > 0) adTargetSizesMap[ad.fbAdId] = sizes;
    }

    // Build stored metrics fallback map
    const storedMetricsMap = {};
    adDocs.forEach(a => {
      if (a.fbAdId && a.metrics) {
        storedMetricsMap[a.fbAdId] = {
          spend: a.metrics.spend || 0,
          impressions: a.metrics.impressions || 0,
          clicks: a.metrics.clicks || 0
        };
      }
    });
    const adTargetMap = {};
    adDocs.forEach(a => {
      let target = null;
      if (a.promoId?.name) target = a.promoId.name;
      else if (a.convoFlowRef) target = a.convoFlowRef.replace('convo_', '').replace(/([A-Z])/g, ' $1').trim();
      adTargetMap[a.fbAdId] = target;
    });

    // Also include ads from stored DB that FB Insights didn't return (paused, old, etc.)
    const fbAdIds = new Set((fbData.data || []).map(r => r.ad_id));
    const missingAds = adDocs
      .filter(a => a.fbAdId && !fbAdIds.has(a.fbAdId) && (a.metrics?.spend > 0 || convMap[a.fbAdId]))
      .map(a => ({
        ad_id: a.fbAdId,
        ad_name: a.name,
        spend: String(a.metrics?.spend || 0),
        impressions: String(a.metrics?.impressions || 0),
        clicks: String(a.metrics?.clicks || 0),
        _fromStored: true
      }));

    const allFbData = [...(fbData.data || []), ...missingAds];

    // Merge and analyze
    const ads = allFbData.map(row => {
      const fbSpend = parseFloat(row.spend || 0);
      const stored = storedMetricsMap[row.ad_id];
      const spend = fbSpend > 0 ? fbSpend : (stored?.spend || 0);
      const conv = convMap[row.ad_id] || { conversions: 0, revenue: 0 };
      const cpa = conv.conversions > 0 ? spend / conv.conversions : null;
      const roi = spend > 0 ? conv.revenue / spend : 0;

      // Efficiency classification
      let efficiency = 'no_data';
      if (conv.conversions === 0) efficiency = 'no_conversions';
      else if (roi >= 20) efficiency = 'optimal';
      else if (roi >= 5) efficiency = 'good';
      else if (roi >= 1) efficiency = 'moderate';
      else efficiency = 'diminishing';

      // Recommendation
      let recommendation = '';
      if (efficiency === 'optimal') recommendation = 'Escalar presupuesto';
      else if (efficiency === 'good') recommendation = 'Mantener y optimizar';
      else if (efficiency === 'moderate') recommendation = 'Revisar targeting';
      else if (efficiency === 'diminishing') recommendation = 'Reducir o pausar';
      else if (efficiency === 'no_conversions') recommendation = 'Revisar flujo o pausar';
      else recommendation = 'Datos insuficientes';

      // Product breakdown for this ad
      const products = adProductMap[row.ad_id] || [];
      const targetProduct = adTargetMap[row.ad_id] || null;
      const totalOrders = products.reduce((s, p) => s + p.count, 0);

      // Variety analysis for category-targeted ads:
      //   X = total variants/sizes available in the targeted category
      //   Y = distinct variants the ad actually moved
      //   Z = sales from outside the category (true cross-sell)
      let inCategorySales = 0;
      let distinctInCategory = 0;
      let crossSell = [];
      const targetSizes = adTargetSizesMap[row.ad_id]; // Set<"WxHm">
      const categoryTotalVariants = targetSizes ? targetSizes.size : 0;

      if (products.length > 0 && (targetSizes || targetProduct)) {
        const targetLower = (targetProduct || '').toLowerCase().trim();
        const stopwords = new Set(['retail', 'mayoreo', 'wholesale', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'sin']);
        const categoryTokens = targetLower
          .replace(/[0-9]+\s*x\s*[0-9]+\s*m?/g, '')
          .split(/\s+/)
          .map(t => t.trim())
          .filter(t => t.length >= 3 && !stopwords.has(t));

        const distinctSeen = new Set();

        products.forEach(p => {
          const sizeLabel = (p.product || '').toLowerCase();
          const fullLower = (p.fullTitle || p.product || '').toLowerCase();

          let isInCategory = false;
          if (targetSizes && targetSizes.size > 0) {
            isInCategory = targetSizes.has(sizeLabel);
          } else if (categoryTokens.length > 0) {
            isInCategory = categoryTokens.some(tok => fullLower.includes(tok));
          }

          if (isInCategory) {
            inCategorySales += p.count;
            distinctSeen.add(sizeLabel);
          } else {
            crossSell.push(p);
          }
        });

        distinctInCategory = distinctSeen.size;
      }

      // Backwards-compat aliases for the frontend's older shape
      const onTarget = inCategorySales;
      const crossSellCount = totalOrders - inCategorySales;

      return {
        adId: row.ad_id,
        name: row.ad_name,
        spend: Math.round(spend),
        impressions: parseInt(row.impressions || 0) || (stored?.impressions || 0),
        fbClicks: parseInt(row.clicks || 0) || (stored?.clicks || 0),
        conversions: conv.conversions,
        revenue: Math.round(conv.revenue),
        cpa: cpa !== null ? Math.round(cpa) : null,
        roi: +roi.toFixed(1),
        efficiency,
        recommendation,
        targetProduct,
        products: products.slice(0, 5),
        onTarget,
        crossSellCount,
        crossSellPct: totalOrders > 0 ? Math.round((crossSellCount / totalOrders) * 100) : 0,
        // Variety stats: X variants in target category, Y distinct sold, Z out-of-category sales
        categoryTotalVariants,
        distinctInCategory,
        outOfCategorySales: crossSellCount,
        // The actual out-of-category items (for the popup)
        crossSellItems: crossSell
          .sort((a, b) => b.count - a.count)
          .slice(0, 20)
          .map(p => ({
            product: p.product,
            fullTitle: p.fullTitle,
            count: p.count,
            revenue: p.revenue
          }))
      };
    }).filter(a => a.spend > 0).sort((a, b) => b.revenue - a.revenue);

    const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
    const totalRevenue = ads.reduce((s, a) => s + a.revenue, 0);
    const totalConversions = ads.reduce((s, a) => s + a.conversions, 0);
    const avgCpa = totalConversions > 0 ? Math.round(totalSpend / totalConversions) : null;

    const efficiencyCounts = { optimal: 0, good: 0, moderate: 0, diminishing: 0, no_conversions: 0 };
    ads.forEach(a => { if (efficiencyCounts[a.efficiency] !== undefined) efficiencyCounts[a.efficiency]++; });

    res.json({
      success: true,
      data: {
        ads,
        totals: { spend: totalSpend, revenue: totalRevenue, conversions: totalConversions, avgCpa, roi: totalSpend > 0 ? +(totalRevenue / totalSpend).toFixed(1) : 0 },
        efficiency: efficiencyCounts
      }
    });
  } catch (err) {
    console.error('❌ ML spend optimization error:', err.response?.data?.error?.message || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.error?.message || err.message });
  }
});

// ─── K-MEANS IMPLEMENTATION ─────────────────────────────────────────────────
function kMeans(data, k, maxIter = 50) {
  const n = data.length;
  const dim = data[0].length;

  // Initialize centroids randomly from data points
  const used = new Set();
  const centroids = [];
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * n);
    if (!used.has(idx)) { used.add(idx); centroids.push([...data[idx]]); }
  }

  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = data.map(point => {
      let minDist = Infinity, closest = 0;
      centroids.forEach((c, ci) => {
        const dist = point.reduce((sum, val, di) => sum + (val - c[di]) ** 2, 0);
        if (dist < minDist) { minDist = dist; closest = ci; }
      });
      return closest;
    });

    // Check convergence
    if (newAssignments.every((a, i) => a === assignments[i])) break;
    assignments = newAssignments;

    // Recompute centroids
    for (let ci = 0; ci < k; ci++) {
      const members = data.filter((_, i) => assignments[i] === ci);
      if (members.length === 0) continue;
      for (let di = 0; di < dim; di++) {
        centroids[ci][di] = ss.mean(members.map(m => m[di]));
      }
    }
  }

  // Build clusters
  const clusters = Array.from({ length: k }, () => ({ indices: [] }));
  assignments.forEach((ci, i) => clusters[ci].indices.push(i));
  return clusters.filter(c => c.indices.length > 0);
}

module.exports = router;
