import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

  const [correlating, setCorrelating] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const progressRef = useRef(null);

  const [analytics, setAnalytics] = useState(null);
  const [adPerf, setAdPerf] = useState([]);
  const [dailyData, setDailyData] = useState([]);
  const [sourceBreakdown, setSourceBreakdown] = useState([]);

  // Link generator state
  const [showLinkGen, setShowLinkGen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkProductName, setLinkProductName] = useState("");
  const [selectedAdId, setSelectedAdId] = useState("");
  const [adsList, setAdsList] = useState([]);
  const [generatedLink, setGeneratedLink] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split("T")[0], []);

  const periodLabel = useMemo(() => {
    const fmt = (iso) => {
      const d = new Date(iso + "T12:00:00");
      return `${d.getDate()} ${d.toLocaleString("es-MX", { month: "short" })}`;
    };
    return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
  }, [dateFrom, dateTo]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;

      const [analyticsRes, adPerfRes, clicksRes, sourceRes] = await Promise.all([
        API.get(`/analytics/?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
        API.get(`/analytics/ad-performance?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
        API.get(`/click-logs/daily?startDate=${dateFrom}&endDate=${dateTo}`),
        API.get(`/click-logs/by-source?startDate=${dateFrom}&endDate=${dateTo}`),
      ]);

      setAnalytics(analyticsRes.data);
      setAdPerf(adPerfRes.data?.ads || []);
      setDailyData(clicksRes.data?.chartData || []);
      setSourceBreakdown(sourceRes.data?.sources || []);
    } catch (err) {
      console.error("Error fetching campaign dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const startProgress = useCallback(() => {
    setSyncProgress(0);
    let progress = 0;
    progressRef.current = setInterval(() => {
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
      await API.post('/analytics/correlate-conversions', { sellerId: '482595248', dateFrom, dateTo });
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

  const fetchAds = useCallback(async () => {
    try {
      const res = await API.get("/ads?status=ACTIVE");
      setAdsList(res.data?.data || []);
    } catch (err) {
      console.error("Error fetching ads:", err);
    }
  }, []);

  const generateDirectAdLink = async () => {
    if (!linkUrl) return;
    setGenerating(true);
    try {
      const ad = adsList.find(a => a._id === selectedAdId);
      const res = await API.post("/click-logs/generate", {
        originalUrl: linkUrl,
        productName: linkProductName || null,
        adId: ad?.fbAdId || null,
        adSetId: ad?.adSetId?.fbAdSetId || null,
        campaignId: ad?.adSetId?.campaignId?.ref || null,
        source: "direct_ad"
      });
      setGeneratedLink(res.data.clickLog.trackedUrl);
      setCopySuccess(false);
    } catch (err) {
      console.error("Error generating link:", err);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = generatedLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  useEffect(() => {
    fetchAll();
    API.post('/analytics/correlate-conversions', { sellerId: '482595248', dateFrom, dateTo })
      .then(() => { setLastSync(new Date()); return fetchAll(); })
      .catch(err => console.error('Auto-sync failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

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

      {/* Correlate button */}
      <div className="flex items-center justify-end gap-3">
        {lastSync && (
          <span className="text-xs text-gray-500">
            Última sync: {lastSync.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {correlating && (
          <div className="w-48 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${syncProgress}%` }}
            />
          </div>
        )}
        <button
          onClick={runCorrelation}
          disabled={correlating}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-all"
        >
          {correlating ? `${syncProgress}%` : "Correlacionar"}
        </button>
      </div>

      {/* Link Generator for Direct Ads */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Generar link de seguimiento</h2>
            <p className="text-sm text-gray-500">Para anuncios con CTA directo (sin Messenger)</p>
          </div>
          <button
            onClick={() => {
              const next = !showLinkGen;
              setShowLinkGen(next);
              setGeneratedLink(null);
              if (next && adsList.length === 0) fetchAds();
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-all"
          >
            {showLinkGen ? "Cerrar" : "Nuevo link"}
          </button>
        </div>

        {showLinkGen && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">URL destino *</label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  placeholder="https://articulo.mercadolibre.com.mx/..."
                  className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Producto (opcional)</label>
                <input
                  type="text"
                  value={linkProductName}
                  onChange={e => setLinkProductName(e.target.value)}
                  placeholder="Malla sombra 90%"
                  className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Anuncio (opcional)</label>
                <select
                  value={selectedAdId}
                  onChange={e => setSelectedAdId(e.target.value)}
                  className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Sin anuncio</option>
                  {adsList.map(ad => (
                    <option key={ad._id} value={ad._id}>
                      {ad.name}{ad.adSetId?.campaignId?.name ? ` — ${ad.adSetId.campaignId.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={generateDirectAdLink}
                disabled={!linkUrl || generating}
                className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-all"
              >
                {generating ? "Generando..." : "Generar link"}
              </button>

              {generatedLink && (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={generatedLink}
                    readOnly
                    className="flex-1 bg-gray-900 border border-green-500/50 rounded-lg px-3 py-2 text-green-400 text-sm font-mono"
                  />
                  <button
                    onClick={copyToClipboard}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      copySuccess
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {copySuccess ? "Copiado" : "Copiar"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Source Breakdown */}
      {sourceBreakdown.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Ventas por canal</h2>
            <p className="text-sm text-gray-500">Messenger vs WhatsApp vs Anuncios directos</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Canal</th>
                  <th className="px-4 py-3 text-right">Links</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Click Rate</th>
                  <th className="px-4 py-3 text-right">Conv.</th>
                  <th className="px-4 py-3 text-right">Conv. Rate</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {sourceBreakdown.map(s => (
                  <tr key={s.source} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                          backgroundColor: s.source === "direct_ad" ? COLORS.amber : s.source === "whatsapp" ? COLORS.green : COLORS.blue
                        }} />
                        <span className="text-sm text-white font-medium">{s.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.links.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-white font-medium">{s.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.clickRate}%</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400 font-medium">{s.conversions}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.conversionRate}%</td>
                    <td className="px-4 py-3 text-right text-sm text-white">${s.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
