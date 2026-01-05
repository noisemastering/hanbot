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
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pedidos de Mercado Libre</h1>
        <p className="text-gray-600 mt-1">Seller ID: {sellerId}</p>
      </div>

      {/* Sales Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Total Orders */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Pedidos</p>
              <p className="text-2xl font-bold text-gray-900">{metrics.totalOrders}</p>
              {paging.total && paging.total > metrics.totalOrders && (
                <p className="text-xs text-gray-500 mt-1">
                  (Mostrando {metrics.totalOrders} de {paging.total})
                </p>
              )}
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
        </div>

        {/* Total Revenue */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Ingresos Totales</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(metrics.totalRevenue)}</p>
              <p className="text-xs text-gray-500 mt-1">Últimos {metrics.totalOrders} pedidos</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Average Order Value */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Ticket Promedio</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.avgOrderValue)}</p>
              <p className="text-xs text-gray-500 mt-1">{metrics.paidOrders} pedidos pagados</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Facebook Attribution */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Atribución Facebook</p>
              {sellerInfo?.psid ? (
                <>
                  <p className="text-lg font-bold text-blue-600">Conectado</p>
                  <p className="text-xs text-gray-500 mt-1">PSID: {sellerInfo.psid.substring(0, 12)}...</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold text-gray-400">No conectado</p>
                  <p className="text-xs text-gray-500 mt-1">Sin PSID asociado</p>
                </>
              )}
            </div>
            <div className={`w-12 h-12 ${sellerInfo?.psid ? 'bg-blue-100' : 'bg-gray-100'} rounded-full flex items-center justify-center`}>
              <svg className={`w-6 h-6 ${sellerInfo?.psid ? 'text-blue-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 flex gap-4 items-center">
        <input
          type="text"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          placeholder="Seller ID"
          className="border border-gray-300 rounded px-3 py-2 w-48"
        />
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Cargando...' : 'Actualizar Pedidos'}
        </button>

        {paging.total !== undefined && (
          <span className="text-gray-600">
            Total: {paging.total} pedidos
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Cargando pedidos...</p>
        </div>
      )}

      {/* Orders Table */}
      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded">
          <p className="text-gray-600">No hay pedidos para mostrar</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID Pedido
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Comprador
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Producto
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cant
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pago
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.map((order) => {
                  const firstItem = order.order_items?.[0];
                  const totalQty = order.order_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
                  const paymentStatus = order.payments?.[0]?.status || 'N/A';
                  const paymentStatusClass = paymentStatus === 'approved' ? 'text-green-600' :
                                           paymentStatus === 'pending' ? 'text-yellow-600' :
                                           paymentStatus === 'rejected' ? 'text-red-600' : 'text-gray-600';

                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-blue-600">
                        {order.id}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(order.status)}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(order.date_created)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {order.buyer?.nickname || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate" title={firstItem?.item?.title}>
                        {firstItem?.item?.title || 'N/A'}
                        {order.order_items?.length > 1 && (
                          <span className="text-xs text-gray-500 ml-1">
                            (+{order.order_items.length - 1} más)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center">
                        {totalQty}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatCurrency(order.paid_amount || order.total_amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={`font-medium ${paymentStatusClass}`}>
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
            <div className="p-4 bg-blue-50 border border-blue-200 rounded text-sm">
              <strong className="text-blue-900">Información de Atribución</strong>
              <div className="mt-2 space-y-1 text-blue-800">
                <div><strong>Seller:</strong> {sellerInfo.sellerInfo?.nickname || sellerInfo.sellerId}</div>
                <div><strong>Email:</strong> {sellerInfo.sellerInfo?.email || 'N/A'}</div>
                {sellerInfo.psid && (
                  <>
                    <div><strong>PSID (Facebook):</strong> {sellerInfo.psid}</div>
                    <div className="mt-2 px-3 py-2 bg-green-100 border border-green-300 rounded">
                      ✅ <strong>Conversión exitosa:</strong> Este vendedor se conectó desde un click de Facebook
                    </div>
                  </>
                )}
                {!sellerInfo.psid && (
                  <div className="mt-2 px-3 py-2 bg-yellow-100 border border-yellow-300 rounded">
                    ⚠️ No hay PSID asociado - Autorización directa (sin click de Facebook)
                  </div>
                )}
                <div><strong>Autorizado:</strong> {new Date(sellerInfo.authorizedAt).toLocaleString('es-MX')}</div>
              </div>
            </div>
          )}

          {/* Technical Debug Info */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
            <strong className="text-gray-900">Debug Técnico</strong>
            <div className="mt-2 space-y-1">
              <div>✅ Seller ID: {sellerId}</div>
              <div>✅ Authorization: Bearer token activo</div>
              <div>✅ Pedidos obtenidos: {orders.length}</div>
              <div>✅ URL: {API_URL}/ml/orders/{sellerId}</div>
              <div>✅ Total en ML: {paging.total || 'N/A'}</div>
              <div>✅ API Status: Funcionando correctamente</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersView;
