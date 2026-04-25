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
// Linear regression on daily revenue, projects 7 days forward.
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

    // Build data points: x = day index, y = revenue
    const points = daily.map((d, i) => [i, d.revenue]);
    const regression = ss.linearRegression(points);
    const line = ss.linearRegressionLine(regression);
    const r2 = ss.rSquared(points, line);

    // Format history
    const history = daily.map((d, i) => ({
      date: d._id,
      dateLabel: new Date(d._id + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      revenue: Math.round(d.revenue),
      orders: d.orders,
      trendLine: Math.round(line(i))
    }));

    // Forecast next 7 days
    const forecast = [];
    const lastIdx = points.length;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i + 1);
      const dateStr = d.toISOString().split('T')[0];
      const projected = Math.max(0, Math.round(line(lastIdx + i)));
      forecast.push({
        date: dateStr,
        dateLabel: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        revenue: projected,
        orders: Math.max(0, Math.round(projected / (ss.mean(daily.map(d => d.revenue / d.orders)) || 700)))
      });
    }

    // Trend: % change over period
    const firstWeekAvg = ss.mean(daily.slice(0, 7).map(d => d.revenue));
    const lastWeekAvg = ss.mean(daily.slice(-7).map(d => d.revenue));
    const trend = firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg * 100) : 0;

    const totalHistoryRevenue = daily.reduce((s, d) => s + d.revenue, 0);
    const totalForecastRevenue = forecast.reduce((s, d) => s + d.revenue, 0);

    res.json({
      success: true,
      data: {
        history,
        forecast,
        trend: +trend.toFixed(1),
        r2: +r2.toFixed(3),
        slope: Math.round(regression.m),
        totalHistoryRevenue: Math.round(totalHistoryRevenue),
        totalForecastRevenue: Math.round(totalForecastRevenue),
        avgDailyRevenue: Math.round(ss.mean(daily.map(d => d.revenue))),
        monthly: await getMonthlyBreakdown()
      }
    });
  } catch (err) {
    console.error('❌ ML forecast error:', err.message);
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
router.get('/segments', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const dateMatch = {};
    if (dateFrom) dateMatch.$gte = new Date(dateFrom);
    if (dateTo) dateMatch.$lte = new Date(dateTo);
    const hasDate = Object.keys(dateMatch).length > 0;

    // Get all converted orders deduplicated
    const orders = await ClickLog.aggregate([
      { $match: { converted: true, 'conversionData.orderId': { $ne: null }, ...(hasDate ? { createdAt: dateMatch } : {}) } },
      { $group: {
        _id: '$conversionData.orderId',
        revenue: { $first: '$conversionData.totalAmount' },
        state: { $first: '$conversionData.shippingState' },
        gender: { $first: '$conversionData.buyerGender' },
        item: { $first: '$conversionData.itemTitle' }
      }}
    ]);

    if (orders.length < 20) {
      return res.json({ success: true, data: { stateGender: [], topSizes: [], totalCustomers: 0 } });
    }

    // Extract size from item title
    const getSize = (title) => {
      if (!title) return 'Otro';
      const m = title.match(/(\d+)\s*m?\s*[xX×]\s*(\d+)\s*m/);
      return m ? `${m[1]}x${m[2]}m` : 'Otro';
    };

    // 1. State × Gender cross-tab (top 10 states)
    const stateGenderRaw = {};
    orders.forEach(o => {
      const state = o.state || 'Desconocido';
      const gender = o.gender || 'unknown';
      if (!stateGenderRaw[state]) stateGenderRaw[state] = { male: 0, female: 0, unknown: 0, total: 0, revenue: 0 };
      stateGenderRaw[state][gender]++;
      stateGenderRaw[state].total++;
      stateGenderRaw[state].revenue += (o.revenue || 0);
    });

    const stateGender = Object.entries(stateGenderRaw)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 12)
      .map(([state, data]) => ({
        state,
        male: data.male,
        female: data.female,
        unknown: data.unknown,
        total: data.total,
        revenue: Math.round(data.revenue),
        malePercent: Math.round(data.male / data.total * 100),
        femalePercent: Math.round(data.female / data.total * 100),
        avgOrder: Math.round(data.revenue / data.total)
      }));

    // 2. Top product sizes with gender split
    const sizeGenderRaw = {};
    orders.forEach(o => {
      const size = getSize(o.item);
      const gender = o.gender || 'unknown';
      if (!sizeGenderRaw[size]) sizeGenderRaw[size] = { male: 0, female: 0, unknown: 0, total: 0, revenue: 0 };
      sizeGenderRaw[size][gender]++;
      sizeGenderRaw[size].total++;
      sizeGenderRaw[size].revenue += (o.revenue || 0);
    });

    const topSizes = Object.entries(sizeGenderRaw)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([size, data]) => ({
        size,
        male: data.male,
        female: data.female,
        total: data.total,
        revenue: Math.round(data.revenue),
        malePercent: Math.round(data.male / data.total * 100),
        femalePercent: Math.round(data.female / data.total * 100),
        avgOrder: Math.round(data.revenue / data.total)
      }));

    // 3. Global gender split
    const genderTotals = { male: 0, female: 0, unknown: 0 };
    orders.forEach(o => { genderTotals[o.gender || 'unknown']++; });

    res.json({
      success: true,
      data: {
        stateGender,
        topSizes,
        genderTotals,
        totalCustomers: orders.length
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

    // Build per-ad product map
    const adProductMap = {};
    for (const row of productBreakdown) {
      const adId = row._id.adId;
      if (!adProductMap[adId]) adProductMap[adId] = [];
      // Extract size from title
      const title = row._id.item || '';
      const sizeMatch = title.match(/(\d+)\s*m?\s*[xX×]\s*(\d+)\s*m/);
      const shortName = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}m` : title.slice(0, 30);
      adProductMap[adId].push({ product: shortName, count: row.count, revenue: Math.round(row.revenue) });
    }

    // Get ad target product from Ad model (convoFlowRef + promoId)
    const Ad = require('../models/Ad');
    require('../models/Promo');
    const adDocs = await Ad.find({}, 'fbAdId name convoFlowRef promoId').populate('promoId', 'name promoProductIds').lean();
    const adTargetMap = {};
    adDocs.forEach(a => {
      let target = null;
      if (a.promoId?.name) target = a.promoId.name;
      else if (a.convoFlowRef) target = a.convoFlowRef.replace('convo_', '').replace(/([A-Z])/g, ' $1').trim();
      adTargetMap[a.fbAdId] = target;
    });

    // Merge and analyze
    const ads = (fbData.data || []).map(row => {
      const spend = parseFloat(row.spend || 0);
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

      // Determine on-target vs cross-sell
      let onTarget = 0;
      let crossSell = [];
      if (targetProduct && products.length > 0) {
        // Match target by checking if product name contains the target keyword
        const targetLower = (targetProduct || '').toLowerCase();
        products.forEach(p => {
          const pLower = (p.product || '').toLowerCase();
          // Simple match: if target mentions a size, match by size; otherwise match by keyword
          const sizeMatch = targetLower.match(/(\d+)\s*x\s*(\d+)/);
          const isOnTarget = sizeMatch
            ? pLower.includes(`${sizeMatch[1]}x${sizeMatch[2]}`)
            : pLower.includes(targetLower.split(' ')[0]);
          if (isOnTarget) onTarget += p.count;
          else crossSell.push(p);
        });
      }

      return {
        adId: row.ad_id,
        name: row.ad_name,
        spend: Math.round(spend),
        impressions: parseInt(row.impressions || 0),
        fbClicks: parseInt(row.clicks || 0),
        conversions: conv.conversions,
        revenue: Math.round(conv.revenue),
        cpa: cpa !== null ? Math.round(cpa) : null,
        roi: +roi.toFixed(1),
        efficiency,
        recommendation,
        targetProduct,
        products: products.slice(0, 5),
        onTarget,
        crossSellCount: totalOrders - onTarget,
        crossSellPct: totalOrders > 0 ? Math.round((totalOrders - onTarget) / totalOrders * 100) : 0
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
