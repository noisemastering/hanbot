import React, { useState, useEffect, useMemo } from "react";
import API from "../api";
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

const AD_COLORS = ["#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"];

const BENCHMARKS = {
  clickRate:      { green: 35, yellow: 20 },
  conversionRate: { green: 10, yellow: 5 },
};

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

function CampaignHome() {
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);

  const [analytics, setAnalytics] = useState(null);
  const [adPerf, setAdPerf] = useState([]);
  const [dailyData, setDailyData] = useState([]);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  const periodLabel = useMemo(() => {
    const fmt = (iso) => {
      const d = new Date(iso + "T12:00:00");
      return `${d.getDate()} ${d.toLocaleString("es-MX", { month: "short" })}`;
    };
    return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const dateFromISO = `${dateFrom}T00:00:00.000Z`;
        const dateToISO = `${dateTo}T23:59:59.999Z`;

        const [analyticsRes, adPerfRes, clicksRes] = await Promise.all([
          API.get(`/analytics/?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/analytics/ad-performance?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/click-logs/daily?startDate=${dateFrom}&endDate=${dateTo}`),
        ]);

        setAnalytics(analyticsRes.data);
        setAdPerf(adPerfRes.data?.ads || []);
        setDailyData(clicksRes.data?.chartData || []);
      } catch (err) {
        console.error("Error fetching campaign dashboard:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [range, dateFrom, dateTo]);

  // Aggregated totals from ad performance data
  const totals = useMemo(() => {
    return adPerf.reduce((acc, ad) => ({
      links: acc.links + (ad.totals?.links || 0),
      clicks: acc.clicks + (ad.totals?.clicks || 0),
      conversions: acc.conversions + (ad.totals?.conversions || 0),
    }), { links: 0, clicks: 0, conversions: 0 });
  }, [adPerf]);

  const clickRate = totals.links > 0 ? ((totals.clicks / totals.links) * 100).toFixed(1) : "0";
  const convRate = totals.clicks > 0 ? ((totals.conversions / totals.clicks) * 100).toFixed(1) : "0";

  // Main chart: daily links, clicks, conversions
  const chartData = useMemo(
    () => dailyData.map((day) => ({
      dateLabel: day.dateLabel,
      clicks: day.clicks || 0,
      conversions: day.conversions || 0,
      links: day.links || 0,
    })),
    [dailyData]
  );

  // Ad donut: top 5 by clicks
  const adDonutData = useMemo(() => {
    return adPerf
      .sort((a, b) => (b.totals?.clicks || 0) - (a.totals?.clicks || 0))
      .slice(0, 5)
      .map(ad => ({
        name: ad.name?.length > 22 ? ad.name.substring(0, 22) + "..." : ad.name,
        value: ad.totals?.clicks || 0,
        conversions: ad.totals?.conversions || 0,
      }));
  }, [adPerf]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando panel de campañas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <h1 className="text-2xl font-bold text-white">Panel de Campañas</h1>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                range === d
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Conversations */}
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-lg border border-purple-500/20 rounded-xl p-5">
          <p className="text-sm text-gray-400 mb-1">Conversaciones</p>
          <h3 className="text-2xl font-bold text-white">{analytics?.totalUsers || 0}</h3>
          <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
        </div>

        {/* Links */}
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-lg border border-blue-500/20 rounded-xl p-5">
          <p className="text-sm text-gray-400 mb-1">Links generados</p>
          <h3 className="text-2xl font-bold text-blue-400">{totals.links.toLocaleString()}</h3>
          <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
        </div>

        {/* Clicks */}
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 backdrop-blur-lg border border-amber-500/20 rounded-xl p-5">
          <p className="text-sm text-gray-400 mb-1">Clicks</p>
          <h3 className="text-2xl font-bold text-amber-400">{totals.clicks.toLocaleString()}</h3>
          <p className="text-xs text-gray-500 mt-1">{periodLabel}</p>
        </div>

        {/* Click Rate + semaphore */}
        {(() => {
          const cr = parseFloat(clickRate);
          const b = BENCHMARKS.clickRate;
          return (
            <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 backdrop-blur-lg border border-cyan-500/20 rounded-xl p-5">
              <p className="text-sm text-gray-400 mb-1">Click Rate</p>
              <h3 className="text-2xl font-bold text-white">{clickRate}%</h3>
              <div className="mt-2 flex flex-col gap-0.5">
                {[
                  { min: b.green, color: "#10B981", label: `≥${b.green}%` },
                  { min: b.yellow, max: b.green, color: "#F59E0B", label: `${b.yellow}–${b.green - 1}%` },
                  { max: b.yellow, color: "#EF4444", label: `<${b.yellow}%` },
                ].map((tier) => {
                  const active = tier.min != null && tier.max != null
                    ? cr >= tier.min && cr < tier.max
                    : tier.min != null ? cr >= tier.min : cr < tier.max;
                  return (
                    <div key={tier.label} className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tier.color, opacity: active ? 1 : 0.3 }} />
                      <span className="text-[10px]" style={{ color: active ? tier.color : "#6B7280" }}>{tier.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Conversion Rate + semaphore */}
        {(() => {
          const cvr = parseFloat(convRate);
          const b = BENCHMARKS.conversionRate;
          return (
            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-lg border border-green-500/20 rounded-xl p-5">
              <p className="text-sm text-gray-400 mb-1">Conversiones</p>
              <h3 className="text-2xl font-bold text-green-400">{totals.conversions} <span className="text-lg text-gray-500">({convRate}%)</span></h3>
              <div className="mt-2 flex flex-col gap-0.5">
                {[
                  { min: b.green, color: "#10B981", label: `≥${b.green}%` },
                  { min: b.yellow, max: b.green, color: "#F59E0B", label: `${b.yellow}–${b.green - 1}%` },
                  { max: b.yellow, color: "#EF4444", label: `<${b.yellow}%` },
                ].map((tier) => {
                  const active = tier.min != null && tier.max != null
                    ? cvr >= tier.min && cvr < tier.max
                    : tier.min != null ? cvr >= tier.min : cvr < tier.max;
                  return (
                    <div key={tier.label} className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tier.color, opacity: active ? 1 : 0.3 }} />
                      <span className="text-[10px]" style={{ color: active ? tier.color : "#6B7280" }}>{tier.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Daily Chart: Links, Clicks, Conversions */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Actividad diaria</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={{ stroke: "#374151" }} />
                <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={{ stroke: "#374151" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#9CA3AF" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const clicks = payload.find(p => p.dataKey === "clicks")?.value || 0;
                    const conversions = payload.find(p => p.dataKey === "conversions")?.value || 0;
                    const links = payload.find(p => p.dataKey === "links")?.value || 0;
                    const cr = links > 0 ? ((clicks / links) * 100).toFixed(1) : "0";
                    const cvr = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : "0";
                    return (
                      <div style={tooltipStyle} className="p-3 text-sm">
                        <p style={{ color: "#9CA3AF" }} className="mb-1">{label}</p>
                        {payload.map(p => (
                          <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.value}</p>
                        ))}
                        <div className="mt-1 pt-1 border-t border-gray-600">
                          <p style={{ color: "#9CA3AF" }}>Click rate: {cr}%</p>
                          <p style={{ color: "#9CA3AF" }}>Conv. rate: {cvr}%</p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: "#9CA3AF" }} />
                <Bar dataKey="clicks" name="Clicks" fill={COLORS.blue} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversions" name="Conversiones" fill={COLORS.green} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="links" name="Links" stroke={COLORS.purple} strokeWidth={2} dot={{ fill: COLORS.purple, strokeWidth: 2, r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bottom row: Ad Donut + Ad Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ad Donut */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Top anuncios</h2>
          <p className="text-sm text-gray-500 mb-4">Por clicks</p>
          {adDonutData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={adDonutData}
                    cx="50%"
                    cy="55%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {adDonutData.map((_, i) => (
                      <Cell key={i} fill={AD_COLORS[i % AD_COLORS.length]} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name, props) => [
                      `${value} clicks / ${props.payload.conversions} conv.`,
                      props.payload.name
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Sin datos</p>
          )}
        </div>

        {/* Ad Table */}
        <div className="lg:col-span-2 bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Rendimiento por anuncio</h2>
          </div>
          <div className="overflow-x-auto">
            {adPerf.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No hay datos de anuncios en este periodo</p>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="px-6 py-3">Anuncio</th>
                    <th className="px-4 py-3 text-right">Links</th>
                    <th className="px-4 py-3 text-right">Clicks</th>
                    <th className="px-4 py-3 text-right">Click Rate</th>
                    <th className="px-4 py-3 text-right">Conv.</th>
                    <th className="px-4 py-3 text-right">Conv. Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {adPerf.map((ad, i) => (
                    <tr key={ad.adId} className="hover:bg-gray-700/20">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: AD_COLORS[i % AD_COLORS.length] }} />
                          <span className="text-sm text-white font-medium truncate max-w-[200px]">{ad.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-300">{ad.totals?.links?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-sm text-white font-medium">{ad.totals?.clicks?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-300">{ad.totals?.clickRate}%</td>
                      <td className="px-4 py-3 text-right text-sm text-green-400 font-medium">{ad.totals?.conversions}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-300">{ad.totals?.conversionRate}%</td>
                    </tr>
                  ))}
                  {/* Totals */}
                  <tr className="bg-gray-900/30 font-semibold">
                    <td className="px-6 py-3 text-sm text-white">Total</td>
                    <td className="px-4 py-3 text-right text-sm text-white">{totals.links.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-white">{totals.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-white">{clickRate}%</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{totals.conversions}</td>
                    <td className="px-4 py-3 text-right text-sm text-white">{convRate}%</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CampaignHome;
