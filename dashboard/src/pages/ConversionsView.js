import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import API from '../api';
import { useTranslation } from '../i18n';
import MatchDataCompare from '../components/MatchDataCompare';
import ConversationTranscript from '../components/ConversationTranscript';
import CorrelationControl from '../components/CorrelationControl';
import { useAuth } from '../contexts/AuthContext';
import {
  ComposedChart,
  Bar,
  Line,
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

// Get start of current month in YYYY-MM-DD format for date input
function getStartOfMonthStr() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return start.toISOString().split('T')[0];
}

// Get today's date in YYYY-MM-DD format for date input
function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

// Turn a reason like "producto distinto · ciudad · 6min (50%)" into the elements
// summed with the % as the result: "Producto distinto + ciudad + 6min = 50%",
// plus the tier color used elsewhere. Returns { sum, pct, color }.
function parseReason(reason) {
  if (!reason) return null;
  const m = reason.match(/\((\d+)%\)\s*$/);
  const pct = m ? Number(m[1]) : null;
  const body = m ? reason.slice(0, m.index).trim() : reason;
  const parts = body.split(/\s*[·+]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length) parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const color = pct == null ? '#9ca3af'
    : pct >= 90 ? '#34d399' : pct >= 70 ? '#fbbf24' : pct >= 50 ? '#fb923c' : '#9ca3af';
  return { sum: parts.join(' + '), pct, color };
}

function ConversionsView() {
  const { t, locale } = useTranslation();
  const { user, simulationMode } = useAuth();
  // Confidence filter is available to super_admin and admin.
  const effectiveRole = simulationMode?.role || user?.role;
  const canFilterConfidence = effectiveRole === 'super_admin' || effectiveRole === 'admin';

  const [summaryRaw, setSummaryRaw] = useState(null); // raw /summary (byTier + tiered topProducts)
  const [recentConversions, setRecentConversions] = useState([]);
  const [detailRow, setDetailRow] = useState(null); // conversion shown in the detail modal
  const [detailView, setDetailView] = useState('match'); // 'match' | 'chat' toggle
  const [dailyClicks, setDailyClicks] = useState([]); // /chart rows (now carry per-day byCert)
  const [loading, setLoading] = useState(true);
  const [autoCorrelating, setAutoCorrelating] = useState(false); // >3h freshness rebuild
  const [error, setError] = useState(null);

  // Minimum-confidence filter (admin/super_admin): show only sales with certainty ≥ this.
  // All certainties are multiples of 10, so a 10-step slider is exact.
  const [minConfidence, setMinConfidence] = useState(0);
  // Human-confirmed matches have null certainty but are the HIGHEST trust → treat as 100.
  const passCert = (c) => (c == null ? 100 : c) >= minConfidence;
  // Server-side sales-reporting floor (the min % that counts as a reported sale). It's
  // the slider's hard minimum — the reports already exclude sub-floor matches, so the
  // slider starts at the floor and can't go below it.
  const reportingFloor = summaryRaw?.reportingFloor ?? 0;
  useEffect(() => {
    if (summaryRaw?.reportingFloor != null) setMinConfidence((m) => Math.max(m, summaryRaw.reportingFloor));
  }, [summaryRaw]);

  // Date range for the chart (defaults to this month → today)
  const [dateFrom] = useState(getStartOfMonthStr());
  const [dateTo] = useState(getTodayStr());

  // Pagination for conversions table
  const [pageSize, setPageSize] = useState(30);
  const [currentPage, setCurrentPage] = useState(1);

  // Map a ConvoSaleMatch (our own-DB correlation) to the shape the table expects.
  const mapMatch = (m) => ({
    clickId: m._id,
    psid: m.psid,
    productName: m.sale?.itemTitle,
    mlItemId: (m.matchDetails?.saleItemIds || [])[0],
    conversionData: {
      buyerFirstName: m.matchDetails?.saleReceiverName || '',
      buyerLastName: '',
      buyerNickname: m.sale?.buyerNickname || '-',
      shippingCity: m.sale?.shippingCity,
      orderId: m.orderId,
      totalAmount: m.sale?.totalAmount,
    },
    city: m.matchDetails?.convoCity,
    clickedAt: m.sale?.dateCreated,
    correlationMethod: m.method,
    // Method label from the ACTUAL signals that matched (not the old click-method names).
    methodLabel: (() => {
      const s = m.signals || {};
      const parts = [];
      if (s.zip) parts.push('📍 CP');
      else if (s.city) parts.push('🏙️ Ciudad');
      if (s.name || s.nickname) parts.push('👤 Nombre');
      if (s.item) parts.push('🎯 Item');
      return parts.length ? parts.join(' + ') : '⏱️ Tiempo';
    })(),
    certainty: m.certainty,
    attributionReason: m.reason,
    undisputed: m.undisputed,
    ventaIndirecta: m.ventaIndirecta,
    correlationConfidence: m.confidence,
    mismatch: m.linkAudit?.mismatch, // safety-net flag
    humanVerdict: m.humanVerdict || null, // "confirmed" | "rejected" | null
    human: !!m.human, // synthetic human-affirmed sale (no system order)
    matchDetails: m.matchDetails || null, // convo-vs-ML comparison (data column)
    saleItemTitle: m.sale?.itemTitle || null,
    signals: m.signals || null,
  });

  // Human override on a listed sale (deem it not-a-sale, or restore it).
  const setRowVerdict = async (psid, verdict) => {
    if (!psid) return;
    try {
      await API.post(`/correlation/override/${psid}`, { verdict });
      await fetchData();
      toast.success(verdict === 'no_sale' ? 'Marcada como NO venta' : 'Restaurada');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo guardar el veredicto');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
      const dateToISO = dateTo ? `${dateTo}T23:59:59.999Z` : undefined;
      const cp = new URLSearchParams();
      if (dateFromISO) cp.append('dateFrom', dateFromISO);
      if (dateToISO) cp.append('dateTo', dateToISO);

      // EVERYTHING from OUR-DB correlation (convo_sale_matches) — one source, all criteria.
      const [summaryRes, chartRes, matchesRes] = await Promise.all([
        API.get('/correlation/summary'),
        API.get(`/correlation/chart?${cp.toString()}`),
        API.get('/correlation/matches?limit=500'),
      ]);

      // Store the raw responses; stats/chart/topProducts/table are all DERIVED from
      // these + the confidence threshold (below) so the slider filters instantly.
      setSummaryRaw(summaryRes.data || {});
      setDailyClicks(chartRes.data?.chartData || []);
      setRecentConversions((matchesRes.data?.matches || []).map(mapMatch));
    } catch (err) {
      console.error('Error fetching conversion data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Freshness gate: the data is in our DB, so we don't re-correlate on every load.
  // If the last correlation is >3h stale (or already running), trigger a rebuild in
  // the background, show a non-blocking indicator, poll until done, then refresh.
  const ensureFreshCorrelation = async () => {
    try {
      const { data } = await API.get('/correlation/status');
      if (!data.stale && !data.running) return;
      setAutoCorrelating(true);
      if (data.stale && !data.running) await API.post('/correlation/run');
      for (let i = 0; i < 150; i++) { // up to ~12.5 min
        await new Promise((r) => setTimeout(r, 5000));
        const s = await API.get('/correlation/status');
        if (!s.data.running) break;
      }
      await fetchData();
    } catch (e) {
      console.error('freshness check failed:', e.message);
    } finally {
      setAutoCorrelating(false);
    }
  };


  useEffect(() => {
    // Show cached correlation immediately, then auto-rebuild only if >3h stale
    // (our own DB → no need to correlate every load; a loading indicator shows
    // while a stale rebuild runs in the background).
    (async () => {
      await fetchData();
      await ensureFreshCorrelation();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Fetch on mount

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return 'N/A';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'MXN'
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  // ── Derived views (all react to the confidence threshold, no refetch) ──────────
  // Chart: conversions/revenue per day = sum of the per-certainty buckets ≥ threshold.
  // Clicks/sales/links are threshold-independent (they aren't conversions).
  const chartData = useMemo(() => {
    return (dailyClicks || []).map((day) => {
      let conversions = 0, revenue = 0;
      const bc = day.byCert || {};
      for (const k of Object.keys(bc)) {
        if (Number(k) >= minConfidence) { conversions += bc[k].conversions; revenue += bc[k].revenue || 0; }
      }
      return { date: day.date, dateLabel: day.dateLabel, clicks: day.clicks || 0, sales: day.sales || 0, conversions, revenue: Math.round(revenue) };
    });
  }, [dailyClicks, minConfidence]);

  // Stat cards / donut / funnel: recomputed from the per-tier summary ≥ threshold.
  const stats = useMemo(() => {
    if (!summaryRaw) return null;
    const chart = dailyClicks || [];
    const totalLinks = chart.reduce((s, d) => s + (d.links || 0), 0);
    const totalClicks = chart.reduce((s, d) => s + (d.clicks || 0), 0);
    let conversions = 0, revenue = 0;
    const cb = { high: 0, medium: 0, low: 0 };
    for (const tr of (summaryRaw.byTier || [])) {
      if (!passCert(tr.certainty)) continue;
      conversions += tr.count; revenue += tr.revenue || 0;
      const c = tr.certainty == null ? 100 : tr.certainty;
      if (c >= 70) cb.high += tr.count; else if (c >= 50) cb.medium += tr.count; else cb.low += tr.count;
    }
    return {
      conversions,
      totalRevenue: revenue,
      totalLinks,
      clickedLinks: totalClicks,
      clickRate: totalLinks ? Math.round((totalClicks / totalLinks) * 100) : 0,
      confidenceBreakdown: cb,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryRaw, dailyClicks, minConfidence]);

  // Top products: re-filter + re-rank each product by its per-tier breakdown ≥ threshold.
  const topProducts = useMemo(() => {
    return (summaryRaw?.topProducts || [])
      .map((p) => {
        let conversions = 0, revenue = 0;
        const t = p.tiers || {};
        for (const k of Object.keys(t)) if (Number(k) >= minConfidence) { conversions += t[k].conversions; revenue += t[k].revenue || 0; }
        return { _id: p.name, conversions, totalRevenue: Math.round(revenue) };
      })
      .filter((p) => p.conversions > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 8);
  }, [summaryRaw, minConfidence]);

  // Table: only the sales meeting the threshold.
  const filteredConversions = useMemo(
    () => recentConversions.filter((c) => passCert(c.certainty)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentConversions, minConfidence]
  );

  // Moving the slider can shrink the list below the current page → snap back to page 1.
  useEffect(() => { setCurrentPage(1); }, [minConfidence]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">{t('conversions.loadingData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t('conversions.pageTitle')}</h1>
        <p className="text-gray-400 mt-1">{t('conversions.pageSubtitle')}</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-3 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Auto-correlation indicator (data was >3h stale → rebuilding in background) */}
      {autoCorrelating && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-800 border border-blue-500/40 rounded-lg px-4 py-3 shadow-lg flex items-center gap-3">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          <span className="text-sm text-gray-200">Actualizando correlación… (datos con &gt;3h)</span>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* Total Conversions */}
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{t('conversions.conversions')}</p>
                <p className="text-2xl font-bold text-green-400">{stats.conversions}</p>
                <p className="text-xs text-gray-500 mt-1">ventas ligadas a conversaciones</p>
              </div>
              <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Attributed Revenue */}
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{t('conversions.attributedRevenue')}</p>
                <p className="text-2xl font-bold text-blue-400">{formatCurrency(stats.totalRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('conversions.correlatedOrders', { count: stats.conversions })}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Click Rate */}
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{t('conversions.clickedLinks')}</p>
                <p className="text-2xl font-bold text-white">{stats.clickedLinks}</p>
                <p className="text-xs text-gray-500 mt-1">{t('conversions.clickRate', { rate: stats.clickRate })}</p>
              </div>
              <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
              </div>
            </div>
          </div>

          {/* Confidence Breakdown */}
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div>
              <p className="text-sm text-gray-400 mb-2">{t('conversions.attributionConfidence')}</p>
              <div className="flex gap-2">
                <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">
                  {t('conversions.high')}: {stats.confidenceBreakdown?.high || 0}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                  {t('conversions.medium')}: {stats.confidenceBreakdown?.medium || 0}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">
                  {t('conversions.low')}: {stats.confidenceBreakdown?.low || 0}
                </span>
              </div>
              <details className="mt-3 text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-gray-300">Scoring criteria</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="text-gray-400 font-medium mb-1">Señales (puntos):</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span>ML Item ID</span><span className="text-white">+100</span>
                      <span>Código postal</span><span className="text-white">+45</span>
                      <span>Nombre (receptor)</span><span className="text-white">+40</span>
                      <span>Ciudad</span><span className="text-white">+35</span>
                      <span>Nombre en nickname</span><span className="text-white">+35</span>
                      <span>POI del producto</span><span className="text-white">+30</span>
                      <span>Estado</span><span className="text-white">+25</span>
                      <span>Proximidad temporal</span><span className="text-white">+5–20</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium mb-1">Umbrales:</p>
                    <p><span className="text-green-400">Alta:</span> ML Item ID match, o score ≥ 100</p>
                    <p><span className="text-yellow-400">Media:</span> Señales adicionales (nombre, ciudad, CP) con score &lt; 100</p>
                    <p><span className="text-red-400">Baja:</span> Solo ventana de tiempo, sin señales</p>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Confidence filter — super_admin + admin. Filters every conversion surface
          (chart, cards, donut, table, top products) to certainty ≥ N, live. */}
      {canFilterConfidence && (
        <div className="bg-gray-800/30 rounded-lg border border-purple-500/30 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-gray-200">
                Filtro de confianza
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {minConfidence <= reportingFloor
                  ? `Mostrando todas las ventas reportadas (piso ${reportingFloor}%)`
                  : `Mostrando solo ventas con certeza ≥ ${minConfidence}%`}
                {stats && <span className="text-gray-400"> · {stats.conversions} ventas</span>}
              </p>
            </div>
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: minConfidence >= 90 ? '#34d399' : minConfidence >= 70 ? '#fbbf24' : minConfidence >= 50 ? '#fb923c' : '#9ca3af' }}
            >
              {minConfidence <= reportingFloor ? 'Todas' : `≥ ${minConfidence}%`}
            </span>
          </div>
          <input
            type="range"
            min={reportingFloor}
            max="100"
            step="10"
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            className="w-full accent-purple-500 cursor-pointer"
            aria-label="Filtro de confianza mínima"
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1 tabular-nums select-none">
            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter((v) => v >= reportingFloor).map((v) => (
              <span key={v} className={minConfidence === v ? 'text-purple-300 font-semibold' : ''}>{v === reportingFloor ? 'Todas' : v}</span>
            ))}
          </div>
        </div>
      )}

      {/* Daily Chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">{t('conversions.chartTitle')}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                />
                <YAxis
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F3F4F6'
                  }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                <Bar
                  dataKey="conversions"
                  name={t('conversions.chartConversions')}
                  fill="#10B981"
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  name="Ventas (total)"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  dot={{ fill: '#F59E0B', strokeWidth: 2, r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  name={t('conversions.chartClicks')}
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', strokeWidth: 2, r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Confidence Donut + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Confidence Donut */}
        {stats?.confidenceBreakdown && (
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <h2 className="text-lg font-semibold text-white mb-4">{t('conversions.confidenceChart')}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: t('conversions.high'), value: stats.confidenceBreakdown.high || 0, key: 'high' },
                      { name: t('conversions.medium'), value: stats.confidenceBreakdown.medium || 0, key: 'medium' },
                      { name: t('conversions.low'), value: stats.confidenceBreakdown.low || 0, key: 'low' },
                    ].filter(d => d.value > 0)}
                    cx="50%"
                    cy="55%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    <Cell fill="#10B981" stroke="transparent" />
                    <Cell fill="#F59E0B" stroke="transparent" />
                    <Cell fill="#EF4444" stroke="transparent" />
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' }} />
                  <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Products Bar Chart */}
        {topProducts.length > 0 && (
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <h2 className="text-lg font-semibold text-white mb-4">{t('conversions.topProductsChart')}</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topProducts.map(p => ({
                    name: p._id?.length > 20 ? p._id.substring(0, 20) + '...' : p._id,
                    revenue: p.totalRevenue || 0,
                  }))}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    type="number"
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    axisLine={{ stroke: '#374151' }}
                    tickFormatter={(v) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    axisLine={{ stroke: '#374151' }}
                    width={120}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' }}
                    formatter={(v) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)}
                  />
                  <Bar dataKey="revenue" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>


      {/* Recent Conversions - Table */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50">
        <div className="px-4 py-3 border-b border-gray-700/50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">{t('conversions.recentConversions')}</h2>
          <div className="flex items-center gap-3">
            <CorrelationControl onCorrelated={fetchData} />
            <span className="text-sm text-gray-400">{t('conversions.show')}</span>
            {[30, 50, 100].map((size) => (
              <button
                key={size}
                onClick={() => { setPageSize(size); setCurrentPage(1); }}
                className={`px-2 py-1 text-sm rounded ${
                  pageSize === size
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredConversions.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('conversions.noConversionsRecorded')}</p>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="px-4 py-3">{t('conversions.colProduct')}</th>
                    <th className="px-4 py-3">{t('conversions.colBuyer')}</th>
                    <th className="px-4 py-3">{t('conversions.colCity')}</th>
                    <th className="px-4 py-3">{t('conversions.colClick')}</th>
                    <th className="px-4 py-3">{t('conversions.colOrder')}</th>
                    <th className="px-4 py-3">{t('conversions.colMethod')}</th>
                    <th className="px-4 py-3">{t('conversions.colDetail')}</th>
                    <th className="px-4 py-3 text-right">{t('conversions.colAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {filteredConversions
                    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                    .map((conversion) => (
                    <tr key={conversion.clickId || conversion.conversionData?.orderId} className={`hover:bg-gray-700/20 ${conversion.humanVerdict === 'rejected' ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="max-w-[200px]">
                          <p className="text-sm text-white truncate" title={conversion.productName}>
                            {conversion.productName || 'Producto'}
                          </p>
                          {conversion.mlItemId && (
                            <span className="text-xs text-blue-400 font-mono">
                              {conversion.mlItemId}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-300">
                          {conversion.conversionData?.buyerFirstName || ''} {conversion.conversionData?.buyerLastName || ''}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          {conversion.conversionData?.buyerNickname || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {conversion.conversionData?.shippingCity || conversion.city || '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {conversion.clickedAt ? formatDate(conversion.clickedAt) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-400 font-mono">
                          {conversion.conversionData?.orderId || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">
                          {conversion.methodLabel || '⏱️ Tiempo'}
                        </span>
                        {conversion.certainty != null && (
                          <span
                            className="ml-1 text-xs font-semibold"
                            style={{ color: conversion.certainty >= 90 ? '#34d399' : conversion.certainty >= 70 ? '#fbbf24' : conversion.certainty >= 50 ? '#fb923c' : '#9ca3af' }}
                          >
                            · {conversion.certainty}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {conversion.psid || conversion.matchDetails ? (
                          <button
                            onClick={() => { setDetailRow(conversion); setDetailView(conversion.matchDetails ? 'match' : 'chat'); }}
                            title="Ver detalle (match y chat)"
                            className="w-8 h-8 flex items-center justify-center rounded border border-blue-600/60 text-blue-300 hover:bg-blue-600/20"
                          >
                            🔍
                          </button>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold ${conversion.humanVerdict === 'rejected' ? 'text-gray-500 line-through' : 'text-green-400'}`}>
                          {formatCurrency(conversion.conversionData?.totalAmount)}
                        </span>
                        {conversion.human && <div className="text-[10px] text-emerald-400">✓ confirmada por humano</div>}
                        <div className="mt-1">
                          {conversion.humanVerdict === 'rejected' ? (
                            <button
                              onClick={() => setRowVerdict(conversion.psid, null)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-500/60 text-gray-300 hover:bg-gray-600/30"
                            >
                              Restaurar
                            </button>
                          ) : (
                            <button
                              onClick={() => setRowVerdict(conversion.psid, 'no_sale')}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-red-600/60 text-red-300 hover:bg-red-600/20"
                            >
                              No es venta
                            </button>
                          )}
                        </div>
                      </td>
                      {/* Confianza column hidden for now (data still fetched). */}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {filteredConversions.length > pageSize && (
                <div className="px-4 py-3 border-t border-gray-700/50 flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    {t('conversions.showingRange', { from: ((currentPage - 1) * pageSize) + 1, to: Math.min(currentPage * pageSize, filteredConversions.length), total: filteredConversions.length })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('common.previous')}
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-400">
                      {t('conversions.pageOf', { current: currentPage, total: Math.ceil(filteredConversions.length / pageSize) })}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredConversions.length / pageSize), p + 1))}
                      disabled={currentPage >= Math.ceil(filteredConversions.length / pageSize)}
                      className="px-3 py-1 text-sm bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('common.next')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Attribution Funnel */}
      {stats && (
        <div className="mt-6 bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <h2 className="text-lg font-semibold text-white mb-4">{t('conversions.funnelTitle')}</h2>
          <div className="flex items-center justify-between">
            {/* Links Generated */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-blue-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-blue-400">{stats.totalLinks}</span>
              </div>
              <p className="text-sm text-gray-400">{t('conversions.linksGenerated')}</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Clicked */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-purple-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-purple-400">{stats.clickedLinks}</span>
              </div>
              <p className="text-sm text-gray-400">{t('conversions.clicks')}</p>
              <p className="text-xs text-gray-500">{stats.clickRate}%</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Conversions */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-green-400">{stats.conversions}</span>
              </div>
              <p className="text-sm text-gray-400">{t('conversions.funnelConversions')}</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Attributed Revenue */}
            <div className="text-center flex-1">
              <div className="w-24 h-20 mx-auto bg-yellow-500/20 rounded-lg flex items-center justify-center mb-2">
                <span className="text-lg font-bold text-yellow-400">{formatCurrency(stats.totalRevenue)}</span>
              </div>
              <p className="text-sm text-gray-400">{t('conversions.fbRevenue')}</p>
              <p className="text-xs text-gray-500">{t('conversions.orders', { count: stats.conversions })}</p>
            </div>
          </div>
        </div>
      )}

      {/* One detail modal, switchable between the match data and the chat transcript. */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className="bg-gray-800 rounded-lg w-full max-w-2xl border border-gray-700 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
              <div className="inline-flex rounded-md overflow-hidden border border-gray-600">
                {['match', 'chat'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setDetailView(v)}
                    className={`px-4 py-1 text-sm ${detailView === v ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                  >
                    {v === 'match' ? 'Match' : 'Chat'}
                  </button>
                ))}
              </div>
              <button onClick={() => setDetailRow(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 overflow-x-auto">
              {detailView === 'match' ? (
                <>
                  <MatchDataCompare md={detailRow.matchDetails} saleItemTitle={detailRow.saleItemTitle} signals={detailRow.signals} large />
                  {detailRow.attributionReason && (() => {
                    const r = parseReason(detailRow.attributionReason);
                    return (
                      <p className="mt-5 pt-4 border-t border-gray-700/60 text-lg" style={{ color: r.color }}>
                        {r.sum}{r.pct != null && <> = <span className="font-semibold">{r.pct}%</span></>}
                      </p>
                    );
                  })()}
                </>
              ) : (
                <ConversationTranscript psid={detailRow.psid} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConversionsView;
