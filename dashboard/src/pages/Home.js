import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";
import { useTranslation } from "../i18n";
import { useAuth } from "../contexts/AuthContext";
import {
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

const COLORS = {
  blue: "#3B82F6",
  green: "#10B981",
  purple: "#8B5CF6",
  amber: "#F59E0B",
  red: "#EF4444",
  cyan: "#06B6D4",
};

// Benchmarks for Facebook Messenger e-commerce
// Click rate: % of purchase links generated that get clicked
// Conversion rate: % of link clicks that result in a purchase
const BENCHMARKS = {
  clickRate:      { green: 35, yellow: 20 },
  conversionRate: { green: 10, yellow: 5 },
};


const CONFIDENCE_COLORS = {
  high: COLORS.green,
  medium: COLORS.amber,
  low: COLORS.red,
};

const PRODUCT_COLORS = ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#065F46"];
const REGION_COLORS = ["#06B6D4", "#22D3EE", "#67E8F9", "#A5F3FC", "#0E7490"];
const AD_COLORS = ["#8B5CF6", "#A78BFA", "#C4B5FD", "#7C3AED", "#6D28D9"];

const STATE_ABBR = {
  "aguascalientes": "Ags.", "baja california": "B.C.", "baja california sur": "B.C.S.",
  "campeche": "Camp.", "chiapas": "Chis.", "chihuahua": "Chih.",
  "ciudad de méxico": "CDMX", "ciudad de mexico": "CDMX", "cdmx": "CDMX",
  "coahuila": "Coah.", "coahuila de zaragoza": "Coah.", "colima": "Col.",
  "durango": "Dgo.", "guanajuato": "Gto.", "guerrero": "Gro.",
  "hidalgo": "Hgo.", "jalisco": "Jal.",
  "méxico": "Edoméx", "mexico": "Edoméx", "estado de méxico": "Edoméx",
  "michoacán": "Mich.", "michoacan": "Mich.", "michoacán de ocampo": "Mich.",
  "morelos": "Mor.", "nayarit": "Nay.", "nuevo león": "N.L.", "nuevo leon": "N.L.",
  "oaxaca": "Oax.", "puebla": "Pue.", "querétaro": "Qro.", "queretaro": "Qro.",
  "quintana roo": "Q. Roo", "san luis potosí": "S.L.P.", "san luis potosi": "S.L.P.",
  "sinaloa": "Sin.", "sonora": "Son.", "tabasco": "Tab.",
  "tamaulipas": "Tamps.", "tlaxcala": "Tlax.",
  "veracruz": "Ver.", "veracruz de ignacio de la llave": "Ver.",
  "yucatán": "Yuc.", "yucatan": "Yuc.", "zacatecas": "Zac.",
};

function abbrState(name) {
  if (!name) return name;
  return STATE_ABBR[name.toLowerCase().trim()] || name;
}

const tooltipStyle = {
  backgroundColor: "#1F2937",
  border: "1px solid #374151",
  borderRadius: "8px",
  color: "#F3F4F6",
};

function getDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function Home() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { user, simulationMode } = useAuth();
  const effectiveRole = simulationMode?.role || user?.role;
  const showSegmentation = effectiveRole === 'super_admin' || effectiveRole === 'admin' || ['sales', 'accounting'].includes(simulationMode?.profile || user?.profile);
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [correlating, setCorrelating] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const progressRef = useRef(null);

  // Data states
  const [analytics, setAnalytics] = useState(null);
  const [conversionStats, setConversionStats] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topRegions, setTopRegions] = useState([]);
  const [adData, setAdData] = useState([]);
  const [manualSalesData, setManualSalesData] = useState([]);
  const [manualTotals, setManualTotals] = useState({ totalSales: 0, totalRevenue: 0 });
  const [segData, setSegData] = useState(null);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  // "7 feb – 9 mar" style label for KPI cards
  const periodLabel = useMemo(() => {
    const fmt = (iso) => {
      const d = new Date(iso + "T12:00:00");
      return `${d.getDate()} ${d.toLocaleString("es-MX", { month: "short" })}`;
    };
    return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
  }, [dateFrom, dateTo]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;

      const [analyticsRes, convRes, clicksRes, productsRes, regionsRes, adsRes, manualRes] =
        await Promise.all([
          API.get(`/analytics/?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/analytics/conversions?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/click-logs/daily?startDate=${dateFrom}&endDate=${dateTo}`),
          API.get(`/analytics/top-products?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/analytics/top-region?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/analytics/clicks-by-ad?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/click-logs/daily-manual?startDate=${dateFrom}&endDate=${dateTo}`),
        ]);

      setAnalytics(analyticsRes.data);
      setConversionStats(convRes.data.stats);
      setDailyData(clicksRes.data?.chartData || []);
      setTopProducts((productsRes.data?.allProducts || []).slice(0, 5));
      setTopRegions((regionsRes.data?.allRegions || []).slice(0, 5));
      setAdData(
        (adsRes.data?.allAds || [])
          .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
          .slice(0, 3)
      );
      setManualSalesData(manualRes.data?.chartData || []);
      setManualTotals({ totalSales: manualRes.data?.totalSales || 0, totalRevenue: manualRes.data?.totalRevenue || 0 });

      // Fetch segmentation data for higher-level users
      if (showSegmentation) {
        try {
          const segRes = await API.get(`/ml/segments?dateFrom=${dateFromISO}&dateTo=${dateToISO}`);
          setSegData(segRes.data?.data || null);
        } catch (e) { console.error('Seg fetch failed:', e); }
      }
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Show cached data immediately, sync in background, then refresh
    fetchAll();
    API.post('/analytics/correlate-conversions', {
      sellerId: '482595248',
      dateFrom,
      dateTo
    }).then(() => { setLastSync(new Date()); return fetchAll(); }).catch(err => console.error('Auto-sync failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return "$0";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Chart data
  const chartData = useMemo(
    () =>
      dailyData.map((day) => ({
        dateLabel: day.dateLabel,
        clicks: day.clicks || 0,
        conversions: day.conversions || 0,
        links: day.links || 0,
      })),
    [dailyData]
  );

  // Confidence donut data
  const confidenceData = useMemo(() => {
    const bd = conversionStats?.confidenceBreakdown;
    if (!bd) return [];
    return [
      { name: t("home.high"), value: bd.high || 0, key: "high" },
      { name: t("home.medium"), value: bd.medium || 0, key: "medium" },
      { name: t("home.low"), value: bd.low || 0, key: "low" },
    ].filter((d) => d.value > 0);
  }, [conversionStats, t]);

  // Funnel data
  const funnelSteps = useMemo(() => {
    if (!conversionStats) return [];
    return [
      { label: t("home.funnelLinks"), value: conversionStats.totalLinks || 0, color: COLORS.blue },
      { label: t("home.funnelClicks"), value: conversionStats.clickedLinks || 0, color: COLORS.purple },
      { label: t("home.funnelConversions"), value: conversionStats.conversions || 0, color: COLORS.green },
      { label: t("home.funnelRevenue"), value: formatCurrency(conversionStats.totalRevenue), color: COLORS.amber, isRevenue: true },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionStats, t, locale]);

  const startProgress = useCallback(() => {
    setSyncProgress(0);
    let progress = 0;
    progressRef.current = setInterval(() => {
      // Fast to 30%, slow crawl to 90%, never reaches 100% on its own
      const remaining = 90 - progress;
      progress += remaining * 0.08;
      setSyncProgress(Math.min(Math.round(progress), 90));
    }, 300);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
    setSyncProgress(100);
    setTimeout(() => setSyncProgress(0), 800);
  }, []);

  const runCorrelation = async () => {
    setCorrelating(true);
    startProgress();
    try {
      await API.post('/analytics/correlate-conversions', {
        sellerId: '482595248',
        dateFrom,
        dateTo
      });
      setLastSync(new Date());
      stopProgress();
      await fetchAll();
    } catch (err) {
      console.error('Correlation failed:', err);
      stopProgress();
    } finally {
      setCorrelating(false);
    }
  };

  if (loading || !analytics) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">{t("home.loadingDashboard")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Row 1: Date range + KPI Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <h1 className="text-2xl font-bold text-white">{t("home.pageTitle")}</h1>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                range === d
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
              }`}
            >
              {t(`home.last${d}d`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Revenue + confidence semaphore */}
        {(() => {
          const bd = conversionStats?.confidenceBreakdown;
          const total = (bd?.high || 0) + (bd?.medium || 0) + (bd?.low || 0);
          const pct = (v) => total > 0 ? Math.round((v / total) * 100) : 0;
          const tiers = [
            { key: "high", count: bd?.high || 0, pct: pct(bd?.high || 0), color: "#10B981", label: t("home.high") },
            { key: "medium", count: bd?.medium || 0, pct: pct(bd?.medium || 0), color: "#F59E0B", label: t("home.medium") },
            { key: "low", count: bd?.low || 0, pct: pct(bd?.low || 0), color: "#EF4444", label: t("home.low") },
          ];
          return (
            <div onClick={() => navigate('/conversions')} className="bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-lg border border-green-500/20 rounded-xl p-6 cursor-pointer hover:border-green-500/40 hover:scale-[1.02] transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">{t("home.totalRevenue")}</p>
                  <h3 className="text-3xl font-bold text-white">
                    {formatCurrency(conversionStats?.totalRevenue)}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
                </div>
                <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              {total > 0 && (
                <div className="mt-3 pt-3 border-t border-green-500/10">
                  <p className="text-xs text-gray-500 mb-1.5">{t("home.confidenceBreakdown")}</p>
                  <div className="flex flex-col gap-1">
                    {tiers.map((tier) => (
                      <div key={tier.key} className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tier.color }} />
                        <span className="text-[11px] text-gray-400">{tier.label}</span>
                        <span className="text-[11px] font-semibold" style={{ color: tier.color }}>{tier.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Conversions + click rate semaphore */}
        {(() => {
          const cr = parseFloat(conversionStats?.clickRate) || 0;
          const b = BENCHMARKS.clickRate;
          return (
            <div onClick={() => navigate('/conversions')} className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-lg border border-blue-500/20 rounded-xl p-6 cursor-pointer hover:border-blue-500/40 hover:scale-[1.02] transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">{t("home.totalConversions")}</p>
                  <h3 className="text-3xl font-bold text-white">{conversionStats?.conversions || 0}</h3>
                  <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
                </div>
                <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-blue-500/10">
                <p className="text-xs text-gray-500 mb-1.5">{t("home.clickRate")}: <span className="text-white font-semibold">{cr}%</span></p>
                <div className="flex flex-col gap-1">
                  {[
                    { min: b.green, color: "#10B981", label: `>= ${b.green}%` },
                    { min: b.yellow, max: b.green, color: "#F59E0B", label: `${b.yellow}–${b.green - 1}%` },
                    { max: b.yellow, color: "#EF4444", label: `< ${b.yellow}%` },
                  ].map((tier) => {
                    const active = tier.min != null && tier.max != null
                      ? cr >= tier.min && cr < tier.max
                      : tier.min != null ? cr >= tier.min : cr < tier.max;
                    return (
                      <div key={tier.label} className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tier.color, opacity: active ? 1 : 0.3 }} />
                        <span className="text-[11px]" style={{ color: active ? tier.color : "#6B7280" }}>{tier.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Unique Users + sub-metrics */}
        <div onClick={() => navigate('/conversations')} className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-lg border border-purple-500/20 rounded-xl p-6 cursor-pointer hover:border-purple-500/40 hover:scale-[1.02] transition-all">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-1">{t("home.uniqueUsers")}</p>
              <h3 className="text-3xl font-bold text-white">{analytics?.totalUsers || 0}</h3>
              <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
            </div>
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-purple-500/10 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{t("home.totalMessages")}</span>
              <span className="text-[11px] text-white font-semibold">{(analytics?.totalMessages || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{t("home.botResponseRate")}</span>
              <span className="text-[11px] text-white font-semibold">{analytics?.botResponseRate || 0}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{t("home.unanswered")}</span>
              <span className="text-[11px] text-white font-semibold">{analytics?.unanswered || 0}</span>
            </div>
            {analytics?.topRegion && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{t("home.topRegion")}</span>
                <span className="text-[11px] text-white font-semibold">{analytics.topRegion.state}</span>
              </div>
            )}
          </div>
        </div>

        {/* Conversion Rate + semaphore */}
        {(() => {
          const cvr = parseFloat(conversionStats?.conversionRate) || 0;
          const b = BENCHMARKS.conversionRate;
          return (
            <div onClick={() => navigate('/click-logs')} className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 backdrop-blur-lg border border-amber-500/20 rounded-xl p-6 cursor-pointer hover:border-amber-500/40 hover:scale-[1.02] transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">{t("home.conversionRate")}</p>
                  <h3 className="text-3xl font-bold text-white">{cvr}%</h3>
                  <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
                </div>
                <div className="w-12 h-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-amber-500/10">
                <p className="text-xs text-gray-500 mb-1.5">{t("home.conversionRate")}</p>
                <div className="flex flex-col gap-1">
                  {[
                    { min: b.green, color: "#10B981", label: `>= ${b.green}%` },
                    { min: b.yellow, max: b.green, color: "#F59E0B", label: `${b.yellow}–${b.green - 1}%` },
                    { max: b.yellow, color: "#EF4444", label: `< ${b.yellow}%` },
                  ].map((tier) => {
                    const active = tier.min != null && tier.max != null
                      ? cvr >= tier.min && cvr < tier.max
                      : tier.min != null ? cvr >= tier.min : cvr < tier.max;
                    return (
                      <div key={tier.label} className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tier.color, opacity: active ? 1 : 0.3 }} />
                        <span className="text-[11px]" style={{ color: active ? tier.color : "#6B7280" }}>{tier.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Row 2: Main ComposedChart */}
      {chartData.length > 0 && (
        <div onClick={() => navigate('/click-logs')} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.005] transition-all">
          <h2 className="text-lg font-semibold text-white mb-4">{t("home.revenueOverTime")}</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#9CA3AF" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const clicks = payload.find(p => p.dataKey === "clicks")?.value || 0;
                    const conversions = payload.find(p => p.dataKey === "conversions")?.value || 0;
                    const links = payload.find(p => p.dataKey === "links")?.value || 0;
                    const clickRate = links > 0 ? ((clicks / links) * 100).toFixed(1) : "0";
                    const convRate = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : "0";
                    return (
                      <div style={tooltipStyle} className="p-3 text-sm">
                        <p style={{ color: "#9CA3AF" }} className="mb-1">{label}</p>
                        {payload.map(p => (
                          <p key={p.dataKey} style={{ color: p.color }}>{p.name} : {p.value}</p>
                        ))}
                        <div className="mt-1 pt-1 border-t border-gray-600">
                          <p style={{ color: "#9CA3AF" }}>{t("home.clickRate")}: {clickRate}%</p>
                          <p style={{ color: "#9CA3AF" }}>{t("home.conversionRate")}: {convRate}%</p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                <Bar
                  dataKey="clicks"
                  name={t("home.clicks")}
                  fill={COLORS.blue}
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="conversions"
                  name={t("home.conversions")}
                  fill={COLORS.green}
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="links"
                  name={t("home.linksGenerated")}
                  stroke={COLORS.purple}
                  strokeWidth={2}
                  dot={{ fill: COLORS.purple, strokeWidth: 2, r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Row 2b: Manual Sales Chart */}
      {manualSalesData.length > 0 && (
        <div onClick={() => navigate('/crm/sales')} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.005] transition-all">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Ventas registradas manualmente</h2>
            <div className="flex gap-4 text-sm">
              <span className="text-gray-400">{manualTotals.totalSales} ventas</span>
              <span className="text-green-400 font-medium">{formatCurrency(manualTotals.totalRevenue)}</span>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={manualSalesData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#9CA3AF" }}
                  formatter={(value, name) => name === 'Ingreso' ? formatCurrency(value) : value}
                />
                <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                <Bar
                  yAxisId="left"
                  dataKey="sales"
                  name="Ventas"
                  fill={COLORS.amber}
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenue"
                  name="Ingreso"
                  stroke={COLORS.green}
                  strokeWidth={2}
                  dot={{ fill: COLORS.green, strokeWidth: 2, r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Correlate button + progress */}
      <div className="flex items-center justify-end gap-3">
        {lastSync && (
          <span className="text-xs text-gray-500">
            Última sync: {lastSync.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {correlating && (
          <div className="w-48 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${syncProgress}%` }}
            />
          </div>
        )}
        <button
          onClick={runCorrelation}
          disabled={correlating}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-all"
        >
          {correlating ? `${syncProgress}%` : "Correlacionar"}
        </button>
      </div>

      {/* Row 3: Sales Funnel (full width) */}
      <div onClick={() => navigate('/conversions')} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.005] transition-all">
        <h2 className="text-lg font-semibold text-white mb-4">{t("home.salesFunnel")}</h2>
        {funnelSteps.length > 0 ? (
          <div className="flex items-center justify-around">
            {funnelSteps.map((step, i) => (
              <React.Fragment key={step.label}>
                <div className="text-center flex-1">
                  <div
                    className="w-28 h-28 mx-auto rounded-full flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${step.color}20` }}
                  >
                    <span
                      className="text-xl font-bold"
                      style={{ color: step.color }}
                    >
                      {step.isRevenue ? step.value : step.value.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{step.label}</p>
                </div>
                {i < funnelSteps.length - 1 && (
                  <div className="text-gray-600 text-2xl shrink-0">&#8594;</div>
                )}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
        )}
      </div>

      {/* Row 4: Top Products + Ad Performance Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Top Products */}
        <div onClick={() => navigate('/conversions')} className="lg:col-span-2 bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.01] transition-all">
          <h2 className="text-lg font-semibold text-white mb-1">{t("home.topProducts")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("home.byRevenue")}</p>
          {topProducts.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topProducts.map((p) => ({
                      name: p._id?.length > 20 ? p._id.substring(0, 20) + "..." : p._id,
                      value: p.totalRevenue || 0,
                    }))}
                    cx="50%"
                    cy="55%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                  >
                    {topProducts.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => formatCurrency(v)}
                  />
                  <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
          )}
        </div>

        {/* Ad Performance Donut */}
        <div onClick={() => navigate('/ad-performance')} className="lg:col-span-3 bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.01] transition-all">
          <h2 className="text-lg font-semibold text-white mb-1">{t("home.adPerformance")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("home.byClicks")}</p>
          {adData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={adData.map((ad) => ({
                      name: (ad.name || ad.adId).length > 18 ? (ad.name || ad.adId).substring(0, 18) + '...' : (ad.name || ad.adId),
                      value: ad.clicks || 0,
                      conversions: ad.conversions || 0,
                    }))}
                    cx="40%"
                    cy="55%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {adData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={AD_COLORS[i % AD_COLORS.length]}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name, props) => [
                      `${value} clics / ${props.payload.conversions} conv.`,
                      props.payload.name
                    ]}
                  />
                  <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
          )}
        </div>
      </div>

      {/* Row 5: Geographic Distribution + Confidence Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Geographic Distribution */}
        <div onClick={() => navigate('/geo')} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.01] transition-all">
          <h2 className="text-lg font-semibold text-white mb-1">{t("home.geoDistribution")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("home.byConversations")}</p>
          {topRegions.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topRegions.map((r) => ({
                      name: abbrState(r.state),
                      value: r.conversations || 0,
                    }))}
                    cx="50%"
                    cy="55%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {topRegions.map((_, i) => (
                      <Cell
                        key={i}
                        fill={REGION_COLORS[i % REGION_COLORS.length]}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
          )}
        </div>

        {/* Confidence Donut */}
        <div onClick={() => navigate('/conversions')} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.01] transition-all">
          <h2 className="text-lg font-semibold text-white mb-4">{t("home.confidenceBreakdown")}</h2>
          {confidenceData.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={confidenceData}
                    cx="50%"
                    cy="55%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {confidenceData.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={CONFIDENCE_COLORS[entry.key]}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
          )}
        </div>
      </div>

      {/* Segmentation — State × Gender (higher-level users only) */}
      {showSegmentation && segData?.stateGender?.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 cursor-pointer hover:border-gray-600/70 hover:scale-[1.005] transition-all" onClick={() => navigate('/segmentacion')}>
          <h2 className="text-lg font-semibold text-white mb-1">Compradores por estado y género</h2>
          <p className="text-sm text-gray-500 mb-4">Top 10 estados — click para ver detalle completo</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={segData.stateGender.slice(0, 10).map(s => ({ ...s, state: abbrState(s.state) }))} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="state" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#F3F4F6' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={tooltipStyle} className="p-3 text-sm">
                        <p className="text-white font-medium mb-1">{label}</p>
                        <p style={{ color: '#3B82F6' }}>Hombres: {d.male} ({d.malePercent}%)</p>
                        <p style={{ color: '#EC4899' }}>Mujeres: {d.female} ({d.femalePercent}%)</p>
                        <p style={{ color: '#9CA3AF' }}>Total: {d.total}</p>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="male" name="Hombres" stackId="gender" fill="#3B82F6" />
                <Bar dataKey="female" name="Mujeres" stackId="gender" fill="#EC4899" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
