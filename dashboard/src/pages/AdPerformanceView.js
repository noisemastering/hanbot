import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { correlateAndWait } from '../utils/correlate';
import FeatureTip from '../components/FeatureTip';
import PeriodSelector from '../components/PeriodSelector';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const AD_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

const tooltipStyle = {
  backgroundColor: '#1F2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#F3F4F6',
};


function AdPerformanceView() {
  const navigate = useNavigate();
  const canSeeSales = true;
  const todayISO = () => new Date().toISOString().split('T')[0];
  const daysAgoISO = (n) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - n);
    return dt.toISOString().split('T')[0];
  };
  const [dateFrom, setDateFrom] = useState(daysAgoISO(30));
  const [dateTo, setDateTo] = useState(todayISO());
  // Minimum correlation confidence to count a conversion (0 = todas las ventas).
  const [minConfidence, setMinConfidence] = useState(50);
  // Days span derived from the selected range (used by legacy endpoints expecting ?days=N)
  const range = useMemo(() => {
    const ms = new Date(dateTo).getTime() - new Date(dateFrom).getTime();
    return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  }, [dateFrom, dateTo]);
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState([]);
  const [directDaily, setDirectDaily] = useState([]);
  const [directByAd, setDirectByAd] = useState([]);
  const [directTotals, setDirectTotals] = useState({ totalClicks: 0, totalConversions: 0, totalRevenue: 0 });
  const [handoffData, setHandoffData] = useState([]);
  const [handoffTotals, setHandoffTotals] = useState({ totalHandoffs: 0, totalSales: 0, totalRevenue: 0 });
  const [deviceBreakdown, setDeviceBreakdown] = useState([]);
  const [fbSpend, setFbSpend] = useState([]);
  const [fbSpendTotals, setFbSpendTotals] = useState({ spend: 0, impressions: 0, clicks: 0 });
  const [correlating, setCorrelating] = useState(false);
  const [correlationProgress, setCorrelationProgress] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;
      const [res, directDailyRes, directByAdRes, handoffRes, deviceRes, spendRes] = await Promise.all([
        API.get(`/analytics/ad-performance?dateFrom=${dateFromISO}&dateTo=${dateToISO}&minConfidence=${minConfidence}`),
        API.get(`/click-logs/direct-ad/daily?days=${range}`),
        API.get(`/click-logs/direct-ad/by-ad?days=${range}`),
        API.get(`/analytics/daily-handoffs-sales?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
        API.get(`/analytics/device-breakdown?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
        API.get(`/analytics/fb-spend?dateFrom=${dateFrom}&dateTo=${dateTo}&level=ad`)
      ]);
      setAds(res.data?.ads || []);
      setDirectDaily(directDailyRes.data?.data?.daily || []);
      setDirectTotals(directDailyRes.data?.data?.totals || { totalClicks: 0, totalConversions: 0, totalRevenue: 0 });
      setDirectByAd(directByAdRes.data?.data || []);
      const hd = handoffRes.data?.data || {};
      setHandoffData(hd.daily || []);
      setHandoffTotals({ totalHandoffs: hd.totalHandoffs || 0, totalSales: hd.totalSales || 0, totalRevenue: hd.totalRevenue || 0 });
      setDeviceBreakdown(deviceRes.data?.data || []);
      setFbSpend(spendRes.data?.data || []);
      setFbSpendTotals(spendRes.data?.totals || { spend: 0, impressions: 0, clicks: 0 });
    } catch (err) {
      console.error('Error fetching ad performance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, minConfidence]);

  const runCorrelation = async () => {
    setCorrelating(true);
    setCorrelationProgress({ phase: 'starting', ordersTotal: 0, ordersProcessed: 0 });
    try {
      // Background job + progress polling (the POST returns 202 immediately).
      await correlateAndWait({ dateFrom, dateTo }, { onProgress: setCorrelationProgress });
      await fetchData();
    } catch (err) {
      console.error('Correlation failed:', err);
    } finally {
      setCorrelating(false);
      // Keep progress visible briefly so user sees the completion
      setTimeout(() => setCorrelationProgress(null), 2500);
    }
  };

  const CorrelateButton = () => {
    const p = correlationProgress;
    const isDone = p?.status === 'completed';
    const isError = p?.status === 'error';
    const total = p?.ordersTotal || 0;
    const processed = p?.ordersProcessed || 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    const phaseLabel = {
      fetching_orders: 'Obteniendo órdenes de ML',
      correlating: 'Correlacionando órdenes',
      done: 'Completado',
      starting: 'Iniciando…'
    }[p?.phase] || 'Procesando';

    return (
      <div className="flex flex-col items-end gap-2 mt-3">
        <button
          onClick={runCorrelation}
          disabled={correlating}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-all"
        >
          {correlating ? "Correlacionando..." : "Correlacionar"}
        </button>

        {p && (
          <div className="w-full max-w-md bg-gray-800/60 border border-gray-700/50 rounded-lg p-3">
            <div className="flex justify-between items-center mb-2">
              <span className={`text-xs font-medium ${isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-purple-300'}`}>
                {isError ? '❌ Error' : isDone ? '✅ ' + phaseLabel : '⏳ ' + phaseLabel}
              </span>
              <span className="text-xs text-gray-400">
                {p.phase === 'correlating' ? `${processed} / ${total}` : (p.ordersTotal ? `${p.ordersTotal} órdenes` : '')}
                {p.matched > 0 && ` · ${p.matched} match${p.matched !== 1 ? 'es' : ''}`}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-900/60 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-purple-500'}`}
                style={{
                  width: p.phase === 'fetching_orders' ? '15%' : isDone ? '100%' : `${pct}%`,
                  animation: p.phase === 'fetching_orders' && !isDone ? 'pulse 1.5s ease-in-out infinite' : 'none'
                }}
              />
            </div>
            {isError && p.error && <p className="text-xs text-red-400 mt-1">{p.error}</p>}
          </div>
        )}
      </div>
    );
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Build aggregated chart data: one total per date
  const chartData = useMemo(() => {
    const dateMap = {};
    ads.forEach(ad => {
      ad.daily.forEach(day => {
        if (!dateMap[day.date]) {
          dateMap[day.date] = { date: day.date, dateLabel: day.dateLabel, clicks: 0, links: 0, conversions: 0 };
        }
        dateMap[day.date].clicks += day.clicks || 0;
        dateMap[day.date].links += day.links || 0;
        dateMap[day.date].conversions += day.conversions || 0;
      });
    });
    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [ads]);

  // Spend lookup by ad_id
  const spendByAd = useMemo(() => {
    const map = {};
    fbSpend.forEach(r => { if (r.adId) map[r.adId] = r; });
    return map;
  }, [fbSpend]);

  // Direct-ad chart data
  const directChartData = useMemo(() => {
    return directDaily.map(d => {
      const dateObj = new Date(d.date + 'T12:00:00');
      const label = dateObj.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      return { date: d.date, dateLabel: label, clicks: d.clicks, conversions: d.conversions, revenue: d.revenue };
    });
  }, [directDaily]);

  // Totals row
  const grandTotals = useMemo(() => {
    return ads.reduce((acc, ad) => ({
      links: acc.links + ad.totals.links,
      clicks: acc.clicks + ad.totals.clicks,
      conversions: acc.conversions + ad.totals.conversions,
      revenue: acc.revenue + ad.totals.revenue,
    }), { links: 0, clicks: 0, conversions: 0, revenue: 0 });
  }, [ads]);

  // Puntuación vs. mercado mexicano (benchmarks de anuncios de Facebook, ecommerce/retail MX, MXN).
  // Ajustables aquí si tienes metas propias. reliable=true → dato directo de Facebook;
  // reliable=false → depende de la atribución (sesgado por el subconteo de ventas).
  const marketScore = useMemo(() => {
    const { spend, impressions } = fbSpendTotals;
    const { clicks, conversions, revenue } = grandTotals;
    const B = [
      { key: 'ctr',  label: 'CTR',        benchmark: 1.0, unit: '%', higher: true,  reliable: true,  value: impressions ? (clicks / impressions) * 100 : null, hint: 'clicks ÷ impresiones',
        tip: 'CTR (Click-Through Rate): de cada 100 personas que vieron el anuncio, cuántas hicieron clic. Más alto = el anuncio atrae mejor. Fórmula: clicks ÷ impresiones.' },
      { key: 'cpc',  label: 'CPC',        benchmark: 5,   unit: '$', higher: false, reliable: true,  value: clicks ? spend / clicks : null,                   hint: 'gasto ÷ clicks',
        tip: 'CPC (Costo Por Clic): cuánto pagas, en promedio, por cada clic. Más bajo = más eficiente. Fórmula: gasto ÷ clicks.' },
      { key: 'cpm',  label: 'CPM',        benchmark: 70,  unit: '$', higher: false, reliable: true,  value: impressions ? (spend / impressions) * 1000 : null, hint: 'gasto ÷ mil impresiones',
        tip: 'CPM (Costo Por Mil impresiones): cuánto cuesta que mil personas vean el anuncio. Más bajo = mejor alcance por peso. Fórmula: gasto ÷ impresiones × 1000.' },
      { key: 'conv', label: 'Conversión', benchmark: 1.5, unit: '%', higher: true,  reliable: false, value: clicks ? (conversions / clicks) * 100 : null,     hint: 'conversiones ÷ clicks',
        tip: 'Tasa de conversión: de quienes hicieron clic, qué porcentaje terminó comprando. Más alto = mejor. Fórmula: conversiones ÷ clicks. (Depende de la atribución: se ve más baja de lo real.)' },
      { key: 'cpa',  label: 'CPA',        benchmark: 300, unit: '$', higher: false, reliable: false, value: conversions ? spend / conversions : null,          hint: 'gasto ÷ conversiones',
        tip: 'CPA (Costo Por Adquisición): cuánto gastas en publicidad por cada venta. Más bajo = mejor. Fórmula: gasto ÷ conversiones. (Depende de la atribución: se ve más alto de lo real.)' },
      { key: 'roas', label: 'ROAS',       benchmark: 2.5, unit: 'x', higher: true,  reliable: false, value: spend ? revenue / spend : null,                    hint: 'ingresos ÷ gasto',
        tip: 'ROAS (Return On Ad Spend): pesos de ingreso por cada peso gastado en anuncios. 2.5x = ganas $2.50 por cada $1. Más alto = mejor. Fórmula: ingresos ÷ gasto. (Depende de la atribución: se ve más bajo de lo real.)' },
    ];
    return B.map((m) => {
      if (m.value == null) return { ...m, rating: null, delta: null };
      const ratio = m.higher ? m.value / m.benchmark : m.benchmark / m.value;
      const rating = ratio >= 1.15 ? 'bueno' : ratio >= 0.85 ? 'promedio' : 'bajo';
      const delta = Math.round((ratio - 1) * 100); // % mejor/peor que el mercado
      return { ...m, rating, delta };
    });
  }, [fbSpendTotals, grandTotals]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando rendimiento de anuncios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white transition-colors"
            title="Volver"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <FeatureTip id="perf-overview" title="Desempeño de anuncios" text="Aquí ves el rendimiento de TODOS tus anuncios: cuánto invertiste, cuántos clicks, conversiones e ingresos generó cada uno. Los datos de inversión vienen de Facebook y las ventas de Mercado Libre." position="bottom" step="Nuevo">
            <h1 className="text-2xl font-bold text-white">Rendimiento de Anuncios</h1>
          </FeatureTip>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400" title="Confianza mínima de correlación para contar una venta como conversión">
            <span>Confianza ≥</span>
            <select
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="bg-gray-800 border border-gray-600/50 rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
            >
              <option value={0}>Todas (&gt;0%)</option>
              <option value={25}>25%</option>
              <option value={50}>50%</option>
              <option value={70}>70%</option>
              <option value={90}>90%</option>
            </select>
          </label>
          <PeriodSelector
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-4" title="Gasto total en Facebook Ads">
          <p className="text-sm text-gray-400">Inversión FB</p>
          <p className="text-2xl font-bold text-red-400">${fbSpendTotals.spend.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-gray-500 mt-0.5">CPA: ${grandTotals.conversions > 0 ? (fbSpendTotals.spend / grandTotals.conversions).toFixed(0) : '—'}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title="Personas que vieron el anuncio">
          <p className="text-sm text-gray-400">Impresiones</p>
          <p className="text-2xl font-bold text-gray-300">{fbSpendTotals.impressions.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title="Links de compra enviados por el bot">
          <p className="text-sm text-gray-400">Links generados</p>
          <p className="text-2xl font-bold text-blue-400">{grandTotals.links.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title="Clicks en los links de compra">
          <p className="text-sm text-gray-400">Clicks</p>
          <p className="text-2xl font-bold text-purple-400">{grandTotals.clicks.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title="Compras realizadas en Mercado Libre">
          <p className="text-sm text-gray-400">Conversiones</p>
          <p className="text-2xl font-bold text-green-400">{grandTotals.conversions.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title="Ingresos por ventas atribuidas a anuncios">
          <p className="text-sm text-gray-400">Ingresos</p>
          <p className="text-2xl font-bold text-green-400">{formatCurrency(grandTotals.revenue)}</p>
        </div>
      </div>

      {/* Puntuación vs. mercado mexicano */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">Puntuación vs. mercado</h2>
          <span className="text-xs text-gray-500">benchmarks de anuncios · ecommerce México</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">Cómo se compara tu desempeño en el periodo contra el promedio del mercado mexicano.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {marketScore.map((m) => {
            const badge = { bueno: 'bg-green-500/20 text-green-400', promedio: 'bg-amber-500/20 text-amber-400', bajo: 'bg-red-500/20 text-red-400' };
            const label = { bueno: 'Bueno', promedio: 'Promedio', bajo: 'Bajo' };
            const fmtVal = (v) => m.unit === '$' ? `$${Math.round(v).toLocaleString('es-MX')}` : m.unit === 'x' ? `${v.toFixed(1)}x` : `${v.toFixed(1)}%`;
            const fmtBench = m.unit === '$' ? `$${m.benchmark.toLocaleString('es-MX')}` : m.unit === 'x' ? `${m.benchmark}x` : `${m.benchmark}%`;
            return (
              <div key={m.key} className={`rounded-lg p-4 border ${m.reliable ? 'bg-gray-900/40 border-gray-700/50' : 'bg-gray-900/20 border-gray-700/30'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    {m.label}
                    <span className="relative group inline-flex">
                      <svg className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-20 w-56 rounded-lg bg-gray-900 border border-gray-700 p-2.5 text-[11px] leading-snug text-gray-200 shadow-xl">
                        {m.tip}
                      </span>
                    </span>
                    {!m.reliable && <span className="text-[10px] text-gray-600">atribuido</span>}
                  </span>
                  {m.rating && <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${badge[m.rating]}`}>{label[m.rating]}</span>}
                </div>
                <p className={`text-2xl font-bold ${m.reliable ? 'text-white' : 'text-gray-400'}`}>{m.value != null ? fmtVal(m.value) : '—'}</p>
                <p className="text-xs text-gray-500 mt-1">
                  mercado: {fmtBench}
                  {m.delta != null && <span className={`ml-2 font-medium ${m.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>{m.delta >= 0 ? '+' : ''}{m.delta}%</span>}
                </p>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-600 mt-4">CTR, CPC y CPM vienen directo de Facebook (confiables). Conversión, CPA y ROAS dependen de la atribución (marcados “atribuido”) — al subcontar ventas, se ven peor de lo real; tómalos como piso.</p>
      </div>

      {/* Device Breakdown */}
      {deviceBreakdown.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Dispositivos</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {deviceBreakdown.filter(d => d.device !== 'bot').map(d => {
              const labels = { mobile: '📱 Móvil', tablet: '📱 Tablet', desktop: '💻 Escritorio', unknown: '❓ Desconocido' };
              const colors = { mobile: 'text-purple-400', tablet: 'text-cyan-400', desktop: 'text-blue-400', unknown: 'text-gray-400' };
              return (
                <div key={d.device} className="bg-gray-900/50 border border-gray-700/30 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{labels[d.device] || d.device}</p>
                  <p className={`text-xl font-bold ${colors[d.device] || 'text-white'}`}>{d.count.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d.percentage}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart */}
      {ads.length > 0 && chartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Actividad diaria</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Links</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Clicks</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Conversiones</span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="conversions" name="Conversiones" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="links" name="Links" stroke="#8B5CF6" strokeWidth={2} dot={{ fill: '#8B5CF6', r: 2 }} />
                <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <CorrelateButton />
        </div>
      )}

      {/* Direct Links Chart — right below main chart */}
      {directChartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Links Directos</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Clicks</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Conversiones</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={directChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="conversions" name="Conversiones" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <CorrelateButton />
        </div>
      )}

      {/* Handoffs & Sales Chart */}
      {handoffData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Atención Humana</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Handoffs ({handoffTotals.totalHandoffs})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block"></span> Ventas ({handoffTotals.totalSales})</span>
              {canSeeSales && (
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span> Ingresos ({formatCurrency(handoffTotals.totalRevenue)})</span>
              )}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={handoffData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                {canSeeSales && (
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                )}
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} formatter={(value, name) => name === 'Ingresos' ? formatCurrency(value) : value} />
                <Bar yAxisId="left" dataKey="sales" name="Ventas" fill="#F59E0B" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="left" type="monotone" dataKey="handoffs" name="Handoffs" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
                {canSeeSales && (
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Ingresos" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 2 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <CorrelateButton />
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Detalle por anuncio</h2>
        </div>
        <div className="overflow-x-auto">
          {ads.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No hay datos de anuncios en este periodo</p>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Anuncio</th>
                  <th className="px-4 py-3 text-right">Inversión</th>
                  <th className="px-4 py-3 text-right">Impresiones</th>
                  <th className="px-4 py-3 text-right">Links</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Click Rate</th>
                  <th className="px-4 py-3 text-right">Conv.</th>
                  <th className="px-4 py-3 text-right">Conv. Rate</th>
                  <th className="px-4 py-3 text-right" title="Conversaciones con el click ID de Meta (CTWA) capturado — clave para atribución vía Conversions API">ctwa_clid</th>
                  {canSeeSales && <th className="px-4 py-3 text-right">Ingresos</th>}
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {ads.map((ad, i) => (
                  <tr key={ad.adId} className="hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: AD_COLORS[i % AD_COLORS.length] }}
                        />
                        <div>
                          <p className="text-sm text-white font-medium">{ad.name}</p>
                          <p className="text-xs text-gray-500 font-mono">{ad.adId.substring(0, 16)}...</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-red-400">${(spendByAd[ad.adId]?.spend || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-4 text-right text-sm text-gray-300">{(spendByAd[ad.adId]?.impressions || 0).toLocaleString()}</td>
                    <td className="px-4 py-4 text-right text-sm text-gray-300">{ad.totals.links.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right text-sm text-white font-medium">{ad.totals.clicks.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-300">{ad.totals.clickRate}%</td>
                    <td className="px-6 py-4 text-right text-sm text-green-400 font-medium">{ad.totals.conversions}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-300">{ad.totals.conversionRate}%</td>
                    <td className="px-4 py-4 text-right text-sm" style={{ color: (ad.totals.ctwaClids || 0) > 0 ? '#c4b5fd' : '#4b5563' }}>{ad.totals.ctwaClids || 0}</td>
                    {canSeeSales && <td className="px-6 py-4 text-right text-sm text-green-400 font-semibold">{formatCurrency(ad.totals.revenue)}</td>}
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/ad-performance/${ad.adId}`)}
                        className="px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
                      >
                        Detalle
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-gray-900/30 font-semibold">
                  <td className="px-6 py-4 text-sm text-white">Total</td>
                  <td className="px-4 py-4 text-right text-sm text-red-400">${fbSpendTotals.spend.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-4 text-right text-sm text-white">{fbSpendTotals.impressions.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right text-sm text-white">{grandTotals.links.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right text-sm text-white">{grandTotals.clicks.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-sm text-white">
                    {grandTotals.links > 0 ? ((grandTotals.clicks / grandTotals.links) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-green-400">{grandTotals.conversions}</td>
                  <td className="px-6 py-4 text-right text-sm text-white">
                    {grandTotals.clicks > 0 ? ((grandTotals.conversions / grandTotals.clicks) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="px-4 py-4 text-right text-sm text-white">{ads.reduce((s, a) => s + (a.totals.ctwaClids || 0), 0)}</td>
                  {canSeeSales && <td className="px-6 py-4 text-right text-sm text-green-400">{formatCurrency(grandTotals.revenue)}</td>}
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── DIRECT AD LINKS SECTION ── */}
      {(directChartData.length > 0 || directByAd.length > 0) && (
        <>
          <div className="border-t border-gray-700/50 pt-6">
            <h2 className="text-xl font-bold text-white mb-4">Links Directos</h2>
            <p className="text-sm text-gray-400 mb-4">Clicks desde links directos (sin conversación). Correlación por tiempo.</p>
          </div>

          {/* Direct-ad summary cards */}
          <div className={`grid ${canSeeSales ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
            <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm text-gray-400">Clicks directos</p>
              <p className="text-2xl font-bold text-cyan-400">{directTotals.totalClicks.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm text-gray-400">Conversiones</p>
              <p className="text-2xl font-bold text-green-400">{directTotals.totalConversions}</p>
            </div>
            {canSeeSales && (
              <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
                <p className="text-sm text-gray-400">Ingresos</p>
                <p className="text-2xl font-bold text-green-400">{formatCurrency(directTotals.totalRevenue)}</p>
              </div>
            )}
          </div>

          {/* Direct-ad table */}
          {directByAd.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
              <div className="px-6 py-4 border-b border-gray-700/50">
                <h3 className="text-lg font-semibold text-white">Detalle por anuncio (links directos)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="px-6 py-3">Anuncio</th>
                      <th className="px-6 py-3 text-right">Clicks</th>
                      <th className="px-6 py-3 text-right">Conversiones</th>
                      <th className="px-6 py-3 text-right">Conv. Rate</th>
                      {canSeeSales && <th className="px-6 py-3 text-right">Ingresos</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {directByAd.map((row) => (
                      <tr key={row.fbAdId} className="hover:bg-gray-700/20">
                        <td className="px-6 py-4">
                          <p className="text-sm text-white font-medium">{row.adName}</p>
                          {row.directLinkUrl && (
                            <p className="text-xs text-cyan-400 truncate max-w-xs" title={row.directLinkUrl}>{row.directLinkUrl}</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-white font-medium">{row.clicks.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right text-sm text-green-400 font-medium">{row.conversions}</td>
                        <td className="px-6 py-4 text-right text-sm text-gray-300">{row.conversionRate}%</td>
                        {canSeeSales && <td className="px-6 py-4 text-right text-sm text-green-400 font-semibold">{formatCurrency(row.revenue)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AdPerformanceView;
