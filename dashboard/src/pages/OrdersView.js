import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function OrdersView() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sellerId, setSellerId] = useState('482595248'); // Hanlob default
  const [paging, setPaging] = useState({});
  const [sellerInfo, setSellerInfo] = useState(null);
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    paidOrders: 0
  });

  const fetchSellerInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      console.log(`🔍 Fetching seller info for: ${sellerId}`);

      const response = await axios.get(
        `${API_URL}/ml/sellers/${sellerId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      console.log('✅ Seller info received:', response.data);
      setSellerInfo(response.data.auth || null);

    } catch (err) {
      console.error('⚠️ Error fetching seller info:', err);
      // Don't set error state - seller might not be authorized yet
      setSellerInfo(null);
    }
  };

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

      console.log(`📦 Fetching orders for seller: ${sellerId}`);

      const response = await axios.get(
        `${API_URL}/ml/orders/${sellerId}?sort=date_desc&limit=50`,
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
    fetchSellerInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <p className="text-sm text-gray-400 mt-1">Ventas del mes actual - Seller {sellerId}</p>
      </div>

      {/* Sales Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Total Orders */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Pedidos del Mes</div>
          <div className="text-2xl font-bold text-white mt-1">{metrics.totalOrders}</div>
          {paging.total && paging.total > metrics.totalOrders && (
            <div className="text-xs text-gray-500 mt-1">
              Mostrando {metrics.totalOrders} de {paging.total.toLocaleString()} del mes
            </div>
          )}
        </div>

        {/* Total Revenue */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Ingresos Totales</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(metrics.totalRevenue)}</div>
          <div className="text-xs text-gray-500 mt-1">Mes actual ({metrics.totalOrders} pedidos)</div>
        </div>

        {/* Average Order Value */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Ticket Promedio</div>
          <div className="text-2xl font-bold text-white mt-1">{formatCurrency(metrics.avgOrderValue)}</div>
          <div className="text-xs text-gray-500 mt-1">{metrics.paidOrders} pedidos pagados</div>
        </div>

        {/* Facebook Attribution */}
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
          <div className="text-gray-400 text-sm">Atribución Facebook</div>
          {sellerInfo?.psid ? (
            <>
              <div className="text-lg font-bold text-blue-400 mt-1">Conectado</div>
              <div className="text-xs text-gray-500 mt-1">PSID: {sellerInfo.psid.substring(0, 12)}...</div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-gray-500 mt-1">No conectado</div>
              <div className="text-xs text-gray-500 mt-1">Sin PSID asociado</div>
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
              onChange={(e) => setSellerId(e.target.value)}
              placeholder="Seller ID"
              className="px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 w-48"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchOrders}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Cargando...' : 'Actualizar Pedidos'}
            </button>
          </div>
          {paging.total !== undefined && (
            <div className="text-gray-400 ml-auto">
              Total del mes: <span className="text-white font-semibold">{paging.total.toLocaleString()}</span> pedidos
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
            <table className="w-full" style={{ minWidth: '1200px' }}>
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-28">
                    ID Pedido
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-24">
                    Estado
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-36">
                    Fecha
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-32">
                    Comprador
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" style={{ minWidth: '350px' }}>
                    Producto
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider w-16">
                    Cant
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider w-28">
                    Total
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider w-24">
                    Pago
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {orders.map((order) => {
                  const firstItem = order.order_items?.[0];
                  const totalQty = order.order_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
                  const paymentStatus = order.payments?.[0]?.status || 'N/A';
                  const paymentStatusClass = paymentStatus === 'approved'
                    ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                    : paymentStatus === 'pending'
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                    : paymentStatus === 'rejected'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'bg-gray-500/20 text-gray-300 border border-gray-500/30';

                  const orderStatusClass = order.status === 'paid'
                    ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                    : order.status === 'confirmed'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : order.status === 'cancelled'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'bg-gray-500/20 text-gray-300 border border-gray-500/30';

                  return (
                    <tr key={order.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer" title={`Order ID: ${order.id}`}>
                          {order.id}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 inline-flex text-xs font-medium rounded ${orderStatusClass}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-300">
                        {formatDate(order.date_created)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-sm text-white font-medium">{order.buyer?.nickname || 'N/A'}</span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-300">
                        <div className="flex items-start gap-2">
                          {firstItem?.item?.thumbnail && (
                            <img
                              src={firstItem.item.thumbnail}
                              alt=""
                              className="w-10 h-10 rounded object-cover flex-shrink-0 border border-gray-700"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-sm text-gray-200"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}
                              title={firstItem?.item?.title}
                            >
                              {firstItem?.item?.title || 'N/A'}
                            </p>
                            {order.order_items?.length > 1 && (
                              <span className="text-xs text-cyan-400 font-medium">
                                +{order.order_items.length - 1} producto(s) más
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-700 text-white font-semibold text-xs">
                          {totalQty}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-green-400 text-right">
                        {formatCurrency(order.paid_amount || order.total_amount)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-center">
                        <span className={`px-2 py-0.5 inline-flex text-xs font-medium rounded ${paymentStatusClass}`}>
                          {paymentStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attribution & Debug Info */}
      {!loading && orders.length > 0 && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Attribution Details */}
          {sellerInfo && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm">
              <strong className="text-blue-300">Información de Atribución</strong>
              <div className="mt-2 space-y-1 text-blue-200">
                <div><strong>Seller:</strong> {sellerInfo.sellerInfo?.nickname || sellerInfo.sellerId}</div>
                <div><strong>Email:</strong> {sellerInfo.sellerInfo?.email || 'N/A'}</div>
                {sellerInfo.psid && (
                  <>
                    <div><strong>PSID (Facebook):</strong> {sellerInfo.psid}</div>
                    <div className="mt-2 px-3 py-2 bg-green-500/20 border border-green-500/30 rounded text-green-300">
                      ✅ <strong>Conversión exitosa:</strong> Este vendedor se conectó desde un click de Facebook
                    </div>
                  </>
                )}
                {!sellerInfo.psid && (
                  <div className="mt-2 px-3 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-300">
                    ⚠️ No hay PSID asociado - Autorización directa (sin click de Facebook)
                  </div>
                )}
                <div><strong>Autorizado:</strong> {new Date(sellerInfo.authorizedAt).toLocaleString('es-MX')}</div>
              </div>
            </div>
          )}

          {/* Technical Debug Info */}
          <div className="p-4 bg-gray-800/30 border border-gray-700/50 rounded-lg text-sm text-gray-400">
            <strong className="text-gray-300">Debug Técnico</strong>
            <div className="mt-2 space-y-1">
              <div>✅ Seller ID: <span className="text-white">{sellerId}</span></div>
              <div>✅ Authorization: <span className="text-green-400">Bearer token activo</span></div>
              <div>✅ Pedidos obtenidos: <span className="text-white">{orders.length}</span></div>
              <div>✅ URL: <span className="text-cyan-400 font-mono text-xs">{API_URL}/ml/orders/{sellerId}</span></div>
              <div>✅ Total en ML: <span className="text-white">{paging.total?.toLocaleString() || 'N/A'}</span></div>
              <div>✅ API Status: <span className="text-green-400">Funcionando correctamente</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersView;
