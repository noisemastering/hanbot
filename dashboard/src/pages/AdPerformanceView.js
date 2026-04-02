import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const AD_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

const tooltipStyle = {
  backgroundColor: '#1F2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#F3F4F6',
};

function getDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function AdPerformanceView() {
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState([]);
  const [metric, setMetric] = useState('clicks'); // clicks | links | conversions
  const [directDaily, setDirectDaily] = useState([]);
  const [directByAd, setDirectByAd] = useState([]);
  const [directTotals, setDirectTotals] = useState({ totalClicks: 0, totalConversions: 0, totalRevenue: 0 });

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split('T')[0], []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;
      const [res, directDailyRes, directByAdRes] = await Promise.all([
        API.get(`/analytics/ad-performance?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
        API.get(`/click-logs/direct-ad/daily?days=${range}`),
        API.get(`/click-logs/direct-ad/by-ad?days=${range}`)
      ]);
      setAds(res.data?.ads || []);
      setDirectDaily(directDailyRes.data?.data?.daily || []);
      setDirectTotals(directDailyRes.data?.data?.totals || { totalClicks: 0, totalConversions: 0, totalRevenue: 0 });
      setDirectByAd(directByAdRes.data?.data || []);
    } catch (err) {
      console.error('Error fetching ad performance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Build unified chart data: one row per date, one column per ad
  const chartData = useMemo(() => {
    const dateMap = {};
    ads.forEach((ad, i) => {
      ad.daily.forEach(day => {
        if (!dateMap[day.date]) {
          dateMap[day.date] = { date: day.date, dateLabel: day.dateLabel };
        }
        dateMap[day.date][`ad_${i}`] = day[metric] || 0;
      });
    });
    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [ads, metric]);

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
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-white">Rendimiento de Anuncios</h1>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                range === d
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Anuncios activos</p>
          <p className="text-2xl font-bold text-white">{ads.length}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Links generados</p>
          <p className="text-2xl font-bold text-blue-400">{grandTotals.links.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Clicks</p>
          <p className="text-2xl font-bold text-purple-400">{grandTotals.clicks.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ingresos atribuidos</p>
          <p className="text-2xl font-bold text-green-400">{formatCurrency(grandTotals.revenue)}</p>
        </div>
      </div>

      {/* Chart */}
      {ads.length > 0 && chartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Actividad diaria por anuncio</h2>
            <div className="flex gap-1">
              {[
                { key: 'clicks', label: 'Clicks' },
                { key: 'links', label: 'Links' },
                { key: 'conversions', label: 'Conversiones' },
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => setMetric(m.key)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    metric === m.key
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-80">
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
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                {ads.map((ad, i) => {
                  const color = AD_COLORS[i % AD_COLORS.length];
                  const shortName = ad.name.length > 25 ? ad.name.substring(0, 25) + '...' : ad.name;
                  return ads.length <= 3 ? (
                    <Bar
                      key={ad.adId}
                      dataKey={`ad_${i}`}
                      name={shortName}
                      fill={color}
                      fillOpacity={0.8}
                      radius={[2, 2, 0, 0]}
                      stackId="stack"
                    />
                  ) : (
                    <Line
                      key={ad.adId}
                      type="monotone"
                      dataKey={`ad_${i}`}
                      name={shortName}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ fill: color, r: 2 }}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
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
                  <th className="px-6 py-3 text-right">Links</th>
                  <th className="px-6 py-3 text-right">Clicks</th>
                  <th className="px-6 py-3 text-right">Click Rate</th>
                  <th className="px-6 py-3 text-right">Conversiones</th>
                  <th className="px-6 py-3 text-right">Conv. Rate</th>
                  <th className="px-6 py-3 text-right">Ingresos</th>
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
                    <td className="px-6 py-4 text-right text-sm text-gray-300">{ad.totals.links.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-sm text-white font-medium">{ad.totals.clicks.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-300">{ad.totals.clickRate}%</td>
                    <td className="px-6 py-4 text-right text-sm text-green-400 font-medium">{ad.totals.conversions}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-300">{ad.totals.conversionRate}%</td>
                    <td className="px-6 py-4 text-right text-sm text-green-400 font-semibold">{formatCurrency(ad.totals.revenue)}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-gray-900/30 font-semibold">
                  <td className="px-6 py-4 text-sm text-white">Total</td>
                  <td className="px-6 py-4 text-right text-sm text-white">{grandTotals.links.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-sm text-white">{grandTotals.clicks.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-sm text-white">
                    {grandTotals.links > 0 ? ((grandTotals.clicks / grandTotals.links) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-green-400">{grandTotals.conversions}</td>
                  <td className="px-6 py-4 text-right text-sm text-white">
                    {grandTotals.clicks > 0 ? ((grandTotals.conversions / grandTotals.clicks) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-green-400">{formatCurrency(grandTotals.revenue)}</td>
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
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm text-gray-400">Clicks directos</p>
              <p className="text-2xl font-bold text-cyan-400">{directTotals.totalClicks.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm text-gray-400">Conversiones</p>
              <p className="text-2xl font-bold text-green-400">{directTotals.totalConversions}</p>
            </div>
            <div className="bg-gray-800/50 border border-cyan-500/20 rounded-xl p-4">
              <p className="text-sm text-gray-400">Ingresos</p>
              <p className="text-2xl font-bold text-green-400">{formatCurrency(directTotals.totalRevenue)}</p>
            </div>
          </div>

          {/* Direct-ad chart */}
          {directChartData.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Clicks directos por día</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={directChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} />
                    <Bar dataKey="clicks" name="Clicks" fill="#06B6D4" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="conversions" name="Conversiones" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

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
                      <th className="px-6 py-3 text-right">Ingresos</th>
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
                        <td className="px-6 py-4 text-right text-sm text-green-400 font-semibold">{formatCurrency(row.revenue)}</td>
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
