import React, { useState, useEffect } from 'react';
import axios from 'axios';

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

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
      const dateToISO = dateTo ? `${dateTo}T23:59:59.999Z` : undefined;

      const params = new URLSearchParams();
      if (dateFromISO) params.append('dateFrom', dateFromISO);
      if (dateToISO) params.append('dateTo', dateToISO);

      const [statsRes, conversionsRes] = await Promise.all([
        axios.get(`${API_URL}/analytics/conversions?${params.toString()}`),
        axios.get(`${API_URL}/analytics/conversions/recent?limit=20`)
      ]);

      setStats(statsRes.data.stats);
      setRecentConversions(conversionsRes.data.conversions || []);
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
      const response = await axios.post(`${API_URL}/analytics/correlate-conversions`, {
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
  }, [dateFrom, dateTo]);

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
                <p className="text-2xl font-bold text-blue-400">{formatCurrency(stats.attributedRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {stats.attributedOrders} de {stats.totalMLOrders} pedidos ({stats.attributionRate}%)
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

      {/* Date Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-4 bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {/* Correlation Controls */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Ejecutar Correlación</h2>
        <p className="text-sm text-gray-400 mb-4">
          Correlaciona clicks de Messenger con pedidos de Mercado Libre por producto y tiempo.
        </p>

        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Ventana de tiempo (horas)</label>
            <input
              type="number"
              value={timeWindowHours}
              onChange={(e) => setTimeWindowHours(parseInt(e.target.value) || 48)}
              className="bg-gray-700/50 border border-gray-600 rounded px-3 py-2 w-24 text-white"
              min="1"
              max="168"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Límite de pedidos</label>
            <input
              type="number"
              value={orderLimit}
              onChange={(e) => setOrderLimit(parseInt(e.target.value) || 100)}
              className="bg-gray-700/50 border border-gray-600 rounded px-3 py-2 w-24 text-white"
              min="10"
              max="500"
            />
          </div>
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
          <button
            onClick={fetchData}
            disabled={loading}
            className="bg-gray-700/50 text-gray-300 px-4 py-2 rounded hover:bg-gray-600 border border-gray-600"
          >
            Actualizar
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

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Converters */}
        {stats?.topConverters?.length > 0 && (
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50">
            <div className="px-4 py-3 border-b border-gray-700/50">
              <h2 className="text-lg font-semibold text-white">Top Compradores (PSID)</h2>
            </div>
            <div className="p-4">
              <div className="space-y-3">
                {stats.topConverters.map((converter, i) => (
                  <div key={converter._id} className="flex items-center justify-between p-3 bg-gray-700/30 rounded">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-yellow-500/30 text-yellow-300' :
                        i === 1 ? 'bg-gray-500/30 text-gray-300' :
                        i === 2 ? 'bg-orange-500/30 text-orange-300' :
                        'bg-gray-600/30 text-gray-400'
                      }`}>
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {converter._id?.substring(0, 16)}...
                        </p>
                        <p className="text-xs text-gray-500">{converter.conversions} compra(s)</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recent Conversions */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Conversiones Recientes</h2>
          </div>
          <div className="p-4">
            {recentConversions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No hay conversiones registradas</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {recentConversions.map((conversion) => (
                  <div key={conversion.clickId} className="p-3 bg-gray-700/30 rounded border-l-4 border-green-500">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-white truncate max-w-xs" title={conversion.productName}>
                          {conversion.productName || 'Producto'}
                        </p>
                        <p className="text-xs text-gray-500">
                          PSID: {conversion.psid?.substring(0, 12)}...
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceBadge(conversion.correlationConfidence)}`}>
                        {conversion.correlationConfidence || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-400">
                      <span>Click: {formatDate(conversion.clickedAt)}</span>
                      <span className="font-bold text-green-400">
                        {formatCurrency(conversion.conversionData?.totalAmount)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Comprador: {conversion.conversionData?.buyerNickname || 'N/A'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                <span className="text-lg font-bold text-yellow-400">{formatCurrency(stats.attributedRevenue)}</span>
              </div>
              <p className="text-sm text-gray-400">Ingresos FB</p>
              <p className="text-xs text-gray-500">{stats.attributionRate}% del total</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">
            * Ingresos verificados contra ML API. Total en ML: {formatCurrency(stats.totalMLRevenue)} de {stats.totalMLOrders} pedidos.
          </p>
        </div>
      )}
    </div>
  );
}

export default ConversionsView;
