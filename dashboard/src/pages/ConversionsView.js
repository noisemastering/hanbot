import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
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

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

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

function ConversionsView() {
  const [stats, setStats] = useState(null);
  const [recentConversions, setRecentConversions] = useState([]);
  const [dailyClicks, setDailyClicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [correlating, setCorrelating] = useState(false);
  const [error, setError] = useState(null);
  const [correlationResult, setCorrelationResult] = useState(null);

  // Date filters
  const [dateFrom, setDateFrom] = useState(getStartOfMonthStr());
  const [dateTo, setDateTo] = useState(getTodayStr());

  // Correlation options
  const [timeWindowHours, setTimeWindowHours] = useState(48);
  const [orderLimit, setOrderLimit] = useState(100);

  // Pagination for conversions table
  const [pageSize, setPageSize] = useState(30);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
      const dateToISO = dateTo ? `${dateTo}T23:59:59.999Z` : undefined;

      const params = new URLSearchParams();
      if (dateFromISO) params.append('dateFrom', dateFromISO);
      if (dateToISO) params.append('dateTo', dateToISO);

      const [statsRes, conversionsRes, clicksRes] = await Promise.all([
        axios.get(`${API_URL}/analytics/conversions?${params.toString()}`),
        axios.get(`${API_URL}/analytics/conversions/recent?limit=500`), // Fetch more for pagination
        API.get(`/click-logs/daily?startDate=${dateFrom}&endDate=${dateTo}`)
      ]);

      setStats(statsRes.data.stats);
      setRecentConversions(conversionsRes.data.conversions || []);
      // API returns chartData with: { date, dateLabel, links, clicks, conversions }
      setDailyClicks(clicksRes.data?.chartData || []);
    } catch (err) {
      console.error('Error fetching conversion data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runCorrelation = async (dryRun = false) => {
    setCorrelating(true);
    setCorrelationResult(null);

    try {
      const response = await API.post('/analytics/correlate-conversions', {
        sellerId: '482595248',
        timeWindowHours,
        orderLimit,
        dryRun
      });

      setCorrelationResult({
        ...response.data,
        dryRun
      });

      // Refresh data if not dry run
      if (!dryRun) {
        await fetchData();
      }
    } catch (err) {
      console.error('Error running correlation:', err);
      setError(err.message);
    } finally {
      setCorrelating(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only fetch on mount, use button to refresh with new dates

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return 'N/A';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-MX', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getConfidenceBadge = (confidence) => {
    const styles = {
      high: 'bg-green-500/20 text-green-300 border border-green-500/30',
      medium: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
      low: 'bg-red-500/20 text-red-300 border border-red-500/30'
    };
    return styles[confidence] || 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
  };

  // Chart data comes directly from the daily API (already has clicks + conversions)
  const chartData = useMemo(() => {
    return dailyClicks.map(day => ({
      date: day.date,
      dateLabel: day.dateLabel,
      clicks: day.clicks || 0,
      conversions: day.conversions || 0
    }));
  }, [dailyClicks]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">Cargando datos de conversiones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Conversiones Meta → Mercado Libre</h1>
        <p className="text-gray-400 mt-1">Atribución de ventas desde Facebook Messenger</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-3 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* Total Conversions */}
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">Conversiones</p>
                <p className="text-2xl font-bold text-green-400">{stats.conversions}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {stats.conversionRate}% de clicks
                </p>
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
                <p className="text-sm text-gray-400">Ingresos Atribuidos a FB</p>
                <p className="text-2xl font-bold text-blue-400">{formatCurrency(stats.totalRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  de {stats.conversions} pedidos correlacionados
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
                <p className="text-sm text-gray-400">Links Clickeados</p>
                <p className="text-2xl font-bold text-white">{stats.clickedLinks}</p>
                <p className="text-xs text-gray-500 mt-1">{stats.clickRate}% click rate</p>
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
              <p className="text-sm text-gray-400 mb-2">Confianza Atribución</p>
              <div className="flex gap-2">
                <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">
                  Alta: {stats.confidenceBreakdown?.high || 0}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                  Media: {stats.confidenceBreakdown?.medium || 0}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">
                  Baja: {stats.confidenceBreakdown?.low || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily Chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Clicks vs Conversiones por Día</h2>
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
                  name="Conversiones"
                  fill="#10B981"
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  name="Clicks"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', strokeWidth: 2, r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Correlation Controls */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Correlación</h2>

        <div className="flex flex-wrap gap-4 items-end mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Ventana (hrs)</label>
            <input
              type="number"
              value={timeWindowHours}
              onChange={(e) => setTimeWindowHours(parseInt(e.target.value) || 48)}
              className="bg-gray-700/50 border border-gray-600 rounded px-3 py-2 w-20 text-white"
              min="1"
              max="168"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Límite</label>
            <input
              type="number"
              value={orderLimit}
              onChange={(e) => setOrderLimit(parseInt(e.target.value) || 100)}
              className="bg-gray-700/50 border border-gray-600 rounded px-3 py-2 w-20 text-white"
              min="10"
              max="500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600 border border-gray-600"
          >
            {loading ? 'Cargando...' : 'Actualizar Stats'}
          </button>
          <button
            onClick={() => runCorrelation(true)}
            disabled={correlating}
            className="bg-gray-700/50 text-gray-300 px-4 py-2 rounded hover:bg-gray-600 disabled:opacity-50 border border-gray-600"
          >
            {correlating ? 'Procesando...' : 'Vista Previa'}
          </button>
          <button
            onClick={() => runCorrelation(false)}
            disabled={correlating}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {correlating ? 'Procesando...' : 'Sincronizar Ahora'}
          </button>
        </div>

        {/* Correlation Result */}
        {correlationResult && (
          <div className={`mt-4 p-4 rounded ${correlationResult.dryRun ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-green-500/20 border border-green-500/30'}`}>
            <h3 className="font-semibold mb-2 text-white">
              {correlationResult.dryRun ? 'Vista Previa (sin guardar)' : 'Correlación Completada'}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Pedidos procesados:</span>
                <span className="ml-2 font-medium text-white">{correlationResult.ordersProcessed}</span>
              </div>
              <div>
                <span className="text-gray-400">Con clicks:</span>
                <span className="ml-2 font-medium text-white">{correlationResult.ordersWithClicks}</span>
              </div>
              <div>
                <span className="text-gray-400">Clicks correlacionados:</span>
                <span className="ml-2 font-medium text-green-400">{correlationResult.clicksCorrelated || correlationResult.correlations?.length || 0}</span>
              </div>
              <div>
                <span className="text-gray-400">Tasa de match:</span>
                <span className="ml-2 font-medium text-white">
                  {correlationResult.ordersProcessed > 0
                    ? ((correlationResult.ordersWithClicks / correlationResult.ordersProcessed) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
            </div>

            {/* Show correlations if dry run */}
            {correlationResult.dryRun && correlationResult.correlations?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Correlaciones encontradas:</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {correlationResult.correlations.slice(0, 5).map((c, i) => (
                    <div key={i} className="text-xs bg-gray-800/50 p-2 rounded border border-gray-700">
                      <span className="font-medium text-white">PSID {c.psid?.substring(0, 12)}...</span>
                      <span className="mx-2 text-gray-500">→</span>
                      <span className="text-gray-300">{c.productName}</span>
                      <span className="mx-2 text-gray-500">→</span>
                      <span className="text-green-400">{formatCurrency(c.totalAmount)}</span>
                      <span className={`ml-2 px-1 py-0.5 rounded text-xs ${getConfidenceBadge(c.confidence)}`}>
                        {c.confidence}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top Converters - Horizontal Cards */}
      {stats?.topConverters?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Top Compradores</h2>
          <div className="flex flex-wrap gap-3">
            {stats.topConverters.map((converter, i) => (
              <div key={converter.psid} className={`flex items-center gap-3 px-4 py-3 bg-gray-800/30 rounded-lg border ${
                i === 0 ? 'border-yellow-500/50' :
                i === 1 ? 'border-gray-500/50' :
                i === 2 ? 'border-orange-500/50' :
                'border-gray-700/50'
              }`}>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                  i === 0 ? 'bg-yellow-500/30 text-yellow-300' :
                  i === 1 ? 'bg-gray-500/30 text-gray-300' :
                  i === 2 ? 'bg-orange-500/30 text-orange-300' :
                  'bg-gray-600/30 text-gray-400'
                }`}>
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">
                    {converter.firstName || converter.lastName
                      ? `${converter.firstName || ''} ${converter.lastName || ''}`.trim()
                      : 'Usuario'}
                  </p>
                  <p className="text-xs text-gray-500 font-mono">{converter.psid?.substring(0, 12)}...</p>
                  <p className="text-xs text-gray-500">{converter.conversions} compra{converter.conversions !== 1 ? 's' : ''} · {formatCurrency(converter.totalSpent)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Conversions - Table */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50">
        <div className="px-4 py-3 border-b border-gray-700/50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">Conversiones Recientes</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Mostrar:</span>
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
          {recentConversions.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No hay conversiones registradas</p>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3">Comprador</th>
                    <th className="px-4 py-3">Ciudad</th>
                    <th className="px-4 py-3">Click</th>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Método</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3 text-center">Confianza</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {recentConversions
                    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                    .map((conversion) => (
                    <tr key={conversion.clickId || conversion.conversionData?.orderId} className="hover:bg-gray-700/20">
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
                          {conversion.correlationMethod === 'orphan' ? '🔮 orphan' :
                           conversion.correlationMethod === 'ml_item_match' ? '🎯 ML ID' :
                           conversion.correlationMethod === 'enhanced' ? '✨ multi' :
                           '⏱️ tiempo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-green-400">
                          {formatCurrency(conversion.conversionData?.totalAmount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceBadge(conversion.correlationConfidence)}`}>
                          {conversion.correlationConfidence || 'N/A'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {recentConversions.length > pageSize && (
                <div className="px-4 py-3 border-t border-gray-700/50 flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    Mostrando {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, recentConversions.length)} de {recentConversions.length}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Anterior
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-400">
                      Página {currentPage} de {Math.ceil(recentConversions.length / pageSize)}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(Math.ceil(recentConversions.length / pageSize), p + 1))}
                      disabled={currentPage >= Math.ceil(recentConversions.length / pageSize)}
                      className="px-3 py-1 text-sm bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Siguiente
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
          <h2 className="text-lg font-semibold text-white mb-4">Funnel de Atribución</h2>
          <div className="flex items-center justify-between">
            {/* Links Generated */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-blue-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-blue-400">{stats.totalLinks}</span>
              </div>
              <p className="text-sm text-gray-400">Links Generados</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Clicked */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-purple-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-purple-400">{stats.clickedLinks}</span>
              </div>
              <p className="text-sm text-gray-400">Clicks</p>
              <p className="text-xs text-gray-500">{stats.clickRate}%</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Conversions */}
            <div className="text-center flex-1">
              <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-2">
                <span className="text-xl font-bold text-green-400">{stats.conversions}</span>
              </div>
              <p className="text-sm text-gray-400">Conversiones</p>
              <p className="text-xs text-gray-500">{stats.conversionRate}%</p>
            </div>

            <div className="text-gray-600 text-2xl">→</div>

            {/* Attributed Revenue */}
            <div className="text-center flex-1">
              <div className="w-24 h-20 mx-auto bg-yellow-500/20 rounded-lg flex items-center justify-center mb-2">
                <span className="text-lg font-bold text-yellow-400">{formatCurrency(stats.totalRevenue)}</span>
              </div>
              <p className="text-sm text-gray-400">Ingresos FB</p>
              <p className="text-xs text-gray-500">{stats.conversions} pedidos</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConversionsView;
