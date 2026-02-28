import React, { useState, useEffect, useMemo } from "react";
import API from "../api";
import { useTranslation } from "../i18n";
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

const CONFIDENCE_COLORS = {
  high: COLORS.green,
  medium: COLORS.amber,
  low: COLORS.red,
};

const PRODUCT_COLORS = ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#065F46"];
const REGION_COLORS = ["#06B6D4", "#22D3EE", "#67E8F9", "#A5F3FC", "#0E7490"];

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
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);

  // Data states
  const [analytics, setAnalytics] = useState(null);
  const [conversionStats, setConversionStats] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topRegions, setTopRegions] = useState([]);
  const [adData, setAdData] = useState([]);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;

      const [analyticsRes, convRes, clicksRes, productsRes, regionsRes, adsRes] =
        await Promise.all([
          API.get("/analytics/"),
          API.get(`/analytics/conversions?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/click-logs/daily?startDate=${dateFrom}&endDate=${dateTo}`),
          API.get("/analytics/top-products"),
          API.get("/analytics/top-region"),
          API.get(`/analytics/clicks-by-ad?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
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
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
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

  if (loading) {
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
        {/* Revenue */}
        <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-lg border border-green-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-1">{t("home.totalRevenue")}</p>
              <h3 className="text-3xl font-bold text-white">
                {formatCurrency(conversionStats?.totalRevenue)}
              </h3>
            </div>
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Conversions */}
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-lg border border-blue-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-1">{t("home.totalConversions")}</p>
              <h3 className="text-3xl font-bold text-white">{conversionStats?.conversions || 0}</h3>
            </div>
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Active Conversations */}
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-lg border border-purple-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-1">{t("home.activeConversations")}</p>
              <h3 className="text-3xl font-bold text-white">{analytics?.totalUsers || 0}</h3>
            </div>
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 backdrop-blur-lg border border-amber-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-1">{t("home.conversionRate")}</p>
              <h3 className="text-3xl font-bold text-white">
                {conversionStats?.conversionRate || 0}%
              </h3>
            </div>
            <div className="w-12 h-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Main ComposedChart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
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
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#9CA3AF" }} />
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

      {/* Row 3: Top Products + Sales Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">{t("home.topProducts")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("home.byRevenue")}</p>
          {topProducts.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topProducts.map((p) => ({
                      name: p._id?.length > 20 ? p._id.substring(0, 20) + "..." : p._id,
                      value: p.totalRevenue || 0,
                    }))}
                    cx="50%"
                    cy="50%"
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

        {/* Sales Funnel */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">{t("home.salesFunnel")}</h2>
          {funnelSteps.length > 0 ? (
            <div className="flex items-center justify-between h-64">
              {funnelSteps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div className="text-center flex-1">
                    <div
                      className="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-3"
                      style={{ backgroundColor: `${step.color}20` }}
                    >
                      <span
                        className="text-lg font-bold"
                        style={{ color: step.color }}
                      >
                        {step.isRevenue ? step.value : step.value.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{step.label}</p>
                  </div>
                  {i < funnelSteps.length - 1 && (
                    <div className="text-gray-600 text-xl shrink-0">&#8594;</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t("home.noData")}</p>
          )}
        </div>
      </div>

      {/* Row 4: Geographic Distribution + Confidence Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Geographic Distribution */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">{t("home.geoDistribution")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("home.byConversations")}</p>
          {topRegions.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topRegions.map((r) => ({
                      name: r.state,
                      value: r.conversations || 0,
                    }))}
                    cx="50%"
                    cy="50%"
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
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">{t("home.confidenceBreakdown")}</h2>
          {confidenceData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={confidenceData}
                    cx="50%"
                    cy="50%"
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

      {/* Row 5: Top Ads */}
      {adData.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">{t("home.adPerformance")}</h2>
          </div>
          <div className="divide-y divide-gray-700/50">
            {adData.map((ad) => (
              <div key={ad.adId} className="px-6 py-3 flex items-center justify-between hover:bg-gray-700/20">
                <span className="text-sm text-white truncate mr-4">{ad.name || ad.adId}</span>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm text-gray-300">{(ad.clicks || 0).toLocaleString()} {t("home.adClicks").toLowerCase()}</span>
                  <span className="text-sm text-green-400">{ad.conversions || 0} conv.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
