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

const ITEMS_PER_PAGE = 50;
const ML_MAX_OFFSET = 10000; // ML API limit

function OrdersView() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sellerId] = useState('482595248'); // Hanlob default
  const [dateFrom, setDateFrom] = useState(getStartOfMonthStr());
  const [dateTo, setDateTo] = useState(getTodayStr());
  const [offset, setOffset] = useState(0);
  const [paging, setPaging] = useState({});
  // eslint-disable-next-line no-unused-vars
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    paidOrders: 0
  });
  const [fbAttribution, setFbAttribution] = useState({
    conversionRate: null,
    conversions: 0,
    totalRevenue: 0,
    totalMLOrders: null,
    totalMLRevenue: null,
    attributionRate: null,
    loading: true
  });
  const [summary, setSummary] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    paidOrders: 0,
    loading: false,
    error: null
  });

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');

      if (!token) {
        setError('No authentication token found. Please login.');
        setLoading(false);
        return;
      }

      // Convert date inputs to ISO format for API
      const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000-00:00` : undefined;
      const dateToISO = dateTo ? `${dateTo}T23:59:59.999-00:00` : undefined;

      console.log(`📦 Fetching orders for seller: ${sellerId}`);
      console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);

      const params = new URLSearchParams({
        sort: 'date_desc',
        limit: ITEMS_PER_PAGE.toString(),
        offset: offset.toString()
      });
      if (dateFromISO) params.append('dateFrom', dateFromISO);
      if (dateToISO) params.append('dateTo', dateToISO);

      const response = await axios.get(
        `${API_URL}/ml/orders/${sellerId}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      console.log('✅ Orders received:', response.data);

      const fetchedOrders = response.data.orders || [];
      setOrders(fetchedOrders);
      setPaging(response.data.paging || {});

      // Calculate metrics
      const totalRevenue = fetchedOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
      const paidOrders = fetchedOrders.filter(order => order.status === 'paid').length;

      setMetrics({
        totalOrders: fetchedOrders.length,
        totalRevenue,
        avgOrderValue: fetchedOrders.length > 0 ? totalRevenue / fetchedOrders.length : 0,
        paidOrders
      });

      setLoading(false);

    } catch (err) {
      console.error('❌ Error fetching orders:', err);
      setError(err.response?.data?.message || err.message || 'Failed to fetch orders');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, dateFrom, dateTo]); // Re-fetch when offset or dates change

  // Fetch summary stats (total revenue for the period)
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setSummary(prev => ({ ...prev, loading: true, error: null }));
        const token = localStorage.getItem('token');
        if (!token) return;

        // Build date params matching the order filters
        const dateFromISO = dateFrom ? `${dateFrom}T00:00:00.000-00:00` : undefined;
        const dateToISO = dateTo ? `${dateTo}T23:59:59.999-00:00` : undefined;

        const params = new URLSearchParams();
        if (dateFromISO) params.append('dateFrom', dateFromISO);
        if (dateToISO) params.append('dateTo', dateToISO);

        console.log('📊 Fetching orders summary...');
        const response = await axios.get(
          `${API_URL}/ml/orders/${sellerId}/summary?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (response.data.success) {
          console.log('✅ Summary received:', response.data);
          setSummary({
            totalOrders: response.data.totalOrders,
            totalRevenue: response.data.totalRevenue,
            avgOrderValue: response.data.avgOrderValue,
            paidOrders: response.data.paidOrders,
            loading: false,
            error: null
          });
        }
      } catch (err) {
        console.error('Error fetching summary:', err);
        setSummary(prev => ({ ...prev, loading: false, error: err.message }));
      }
    };

    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, sellerId]);

  // Fetch Facebook attribution data (filtered by date range)
  useEffect(() => {
    const fetchAttribution = async () => {
      try {
        setFbAttribution(prev => ({ ...prev, loading: true }));
        const token = localStorage.getItem('token');
        if (!token) return;

        // Build date params matching the order filters
        const params = new URLSearchParams();
        if (dateFrom) params.append('dateFrom', `${dateFrom}T00:00:00.000Z`);
        if (dateTo) params.append('dateTo', `${dateTo}T23:59:59.999Z`);

        const response = await axios.get(`${API_URL}/analytics/conversions?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.success) {
          const stats = response.data.stats;
          setFbAttribution({
            conversionRate: stats.conversionRate,
            conversions: stats.attributedOrders || stats.conversions,
            totalRevenue: stats.attributedRevenue || stats.totalRevenue,
            totalMLOrders: stats.totalMLOrders,
            totalMLRevenue: stats.totalMLRevenue,
            attributionRate: stats.attributionRate,
            loading: false
          });
        }
      } catch (err) {
        console.error('Error fetching attribution:', err);
        setFbAttribution(prev => ({ ...prev, loading: false }));
      }
    };

    fetchAttribution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  // Reset offset when dates change
  const handleDateChange = (type, value) => {
    setOffset(0); // Reset to first page
    if (type === 'from') setDateFrom(value);
    else setDateTo(value);
  };

  const currentPage = Math.floor(offset / ITEMS_PER_PAGE) + 1;
  const maxAccessibleItems = Math.min(paging.total || 0, ML_MAX_OFFSET);
  const totalAccessiblePages = Math.ceil(maxAccessibleItems / ITEMS_PER_PAGE);

  const goToNextPage = () => {
    const nextOffset = offset + ITEMS_PER_PAGE;
    if (nextOffset < maxAccessibleItems) {
      setOffset(nextOffset);
    }
  };

  const goToPrevPage = () => {
    if (offset > 0) {
      setOffset(Math.max(0, offset - ITEMS_PER_PAGE));
    }
  };

  const goToFirstPage = () => setOffset(0);
  const goToLastPage = () => {
    if (maxAccessibleItems > 0) {
      const lastPageOffset = Math.floor((maxAccessibleItems - 1) / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      setOffset(Math.min(lastPageOffset, ML_MAX_OFFSET - ITEMS_PER_PAGE));
    }
  };

  // eslint-disable-next-line no-unused-vars
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(amount);
  };

  // eslint-disable-next-line no-unused-vars
  const getStatusBadgeClass = (status) => {
    const statusClasses = {
      'paid': 'bg-green-100 text-green-800',
      'confirmed': 'bg-blue-100 text-blue-800',
      'payment_required': 'bg-yellow-100 text-yellow-800',
      'cancelled': 'bg-red-100 text-red-800',
      'invalid': 'bg-gray-100 text-gray-800'
    };
    return statusClasses[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Pedidos de Mercado Libre</h2>
        <p className="text-sm text-gray-400 mt-1">Seller {sellerId}</p>
      </div>

      {/* Sales Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Total Orders - FULL MONTH from summary */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Pedidos del Periodo</div>
          <div className="text-2xl font-bold text-white mt-1">
            {summary.loading ? '...' : summary.totalOrders.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {dateFrom} a {dateTo}
          </div>
        </div>

        {/* Total Revenue - FULL MONTH from summary */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Ingresos del Periodo</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {summary.loading ? '...' : formatCurrency(summary.totalRevenue)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {summary.loading ? 'Calculando...' : `Total de ${summary.totalOrders.toLocaleString()} pedidos`}
          </div>
        </div>

        {/* Average Order Value */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Ticket Promedio</div>
          <div className="text-2xl font-bold text-white mt-1">
            {summary.loading ? '...' : formatCurrency(summary.avgOrderValue)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Basado en total del periodo
          </div>
        </div>

        {/* Facebook Attribution */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Atribución Facebook</div>
          {fbAttribution.loading || summary.loading ? (
            <div className="text-lg font-bold text-gray-500 mt-1">Cargando...</div>
          ) : (
            <>
              <div className="text-2xl font-bold text-blue-400 mt-1">
                {summary.totalOrders > 0 ? ((fbAttribution.conversions / summary.totalOrders) * 100).toFixed(1) : 0}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {fbAttribution.conversions} de {summary.totalOrders.toLocaleString()} pedidos
              </div>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Seller ID</label>
            <input
              type="text"
              value={sellerId}
              readOnly
              className="px-4 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-gray-400 w-40 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateChange('from', e.target.value)}
              className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateChange('to', e.target.value)}
              className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchOrders}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Cargando...' : 'Buscar Pedidos'}
            </button>
          </div>
          {!summary.loading && (
            <div className="text-gray-400 ml-auto">
              Total: <span className="text-white font-semibold">{summary.totalOrders.toLocaleString()}</span> pedidos
              {summary.totalOrders > 0 && (
                <span className="text-green-400 ml-2">({formatCurrency(summary.totalRevenue)})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-3 rounded-lg">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando pedidos...</p>
        </div>
      )}

      {/* Orders Table */}
      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-lg font-semibold text-white mb-2">No hay pedidos</h3>
          <p className="text-gray-400">No se encontraron pedidos para este vendedor</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '130px' }}>
                    Pedido
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '55px' }}>
                    Estado
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '90px' }}>
                    Fecha
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '100px' }}>
                    Comprador
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '35%' }}>
                    Producto
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '35px' }}>
                    #
                  </th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ width: '75px' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {orders.map((order) => {
                  const firstItem = order.order_items?.[0];
                  const totalQty = order.order_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

                  const orderStatusClass = order.status === 'paid'
                    ? 'bg-green-500/20 text-green-300'
                    : order.status === 'confirmed'
                    ? 'bg-blue-500/20 text-blue-300'
                    : order.status === 'cancelled'
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-gray-500/20 text-gray-300';

                  // Show full order ID
                  const orderId = String(order.id);

                  // Date format with year to verify
                  const shortDate = order.date_created
                    ? new Date(order.date_created).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
                    : 'N/A';

                  return (
                    <tr key={order.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-2 py-2 overflow-hidden">
                        <span className="text-xs font-mono text-cyan-400 truncate block" title={orderId}>
                          {orderId}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${orderStatusClass}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-300">
                        {shortDate}
                      </td>
                      <td className="px-2 py-2 overflow-hidden">
                        <span className="text-xs text-white truncate block" title={order.buyer?.nickname}>
                          {order.buyer?.nickname || 'N/A'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-300 overflow-hidden">
                        <p className="truncate" title={firstItem?.item?.title}>
                          {firstItem?.item?.title || 'N/A'}
                        </p>
                        {order.order_items?.length > 1 && (
                          <span className="text-xs text-cyan-400">+{order.order_items.length - 1} más</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className="text-xs text-white font-semibold">{totalQty}</span>
                      </td>
                      <td className="px-2 py-2 text-xs font-bold text-green-400 text-right">
                        {formatCurrency(order.paid_amount || order.total_amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {paging.total > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50">
              <div className="text-sm text-gray-400">
                Mostrando {offset + 1} - {Math.min(offset + ITEMS_PER_PAGE, maxAccessibleItems)} de {paging.total.toLocaleString()} pedidos
                {paging.total > ML_MAX_OFFSET && (
                  <span className="text-yellow-400 ml-2">(máx. {ML_MAX_OFFSET.toLocaleString()} accesibles)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={goToFirstPage}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Primera página"
                >
                  ««
                </button>
                <button
                  onClick={goToPrevPage}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <span className="px-3 py-1 text-white">
                  Página {currentPage} de {totalAccessiblePages.toLocaleString()}
                </span>
                <button
                  onClick={goToNextPage}
                  disabled={offset + ITEMS_PER_PAGE >= maxAccessibleItems || loading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente
                </button>
                <button
                  onClick={goToLastPage}
                  disabled={offset + ITEMS_PER_PAGE >= maxAccessibleItems || loading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Última página"
                >
                  »»
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OrdersView;
