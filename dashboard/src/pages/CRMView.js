import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';

const INTENT_COLORS = {
  high: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const INTENT_LABELS = { high: 'Alto', medium: 'Medio', low: 'Bajo' };

function CRMView() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [convertedFilter, setConvertedFilter] = useState('');

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (search) params.set('search', search);
      if (channelFilter) params.set('channel', channelFilter);
      if (intentFilter) params.set('intent', intentFilter);
      if (convertedFilter) params.set('hasConverted', convertedFilter);
      const res = await API.get(`/crm/customers?${params}`);
      setCustomers(res.data.customers || []);
      setPagination(res.data.pagination || { total: 0, pages: 1 });
      if (res.data.kpis) setKpis(res.data.kpis);
    } catch (err) {
      console.error('Error fetching CRM data:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, channelFilter, intentFilter, convertedFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  };

  const channelBadge = (ch) => {
    if (ch === 'whatsapp') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">WA</span>;
    if (ch === 'facebook') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">FB</span>;
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-400">-</span>;
  };

  const displayName = (c) => c.customerName || c.psid?.replace(/^(fb:|wa:)/, '') || '-';

  if (loading && !kpis) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando CRM...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-white">CRM - Clientes</h1>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-sm text-gray-400">Total Clientes</p>
            <p className="text-2xl font-bold text-purple-400">{kpis.totalCustomers}</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-sm text-gray-400">Leads Activos</p>
            <p className="text-2xl font-bold text-blue-400">{kpis.activeLeads}</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-sm text-gray-400">Con Compras</p>
            <p className="text-2xl font-bold text-green-400">{kpis.customersWithPurchases}</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-sm text-gray-400">Ingresos Totales</p>
            <p className="text-2xl font-bold text-amber-400">{formatCurrency(kpis.totalRevenue)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nombre o ciudad..."
          className="flex-1 min-w-[200px] px-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50"
        />
        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-purple-500/50"
        >
          <option value="">Todos los canales</option>
          <option value="facebook">Facebook</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <select
          value={intentFilter}
          onChange={(e) => { setIntentFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-purple-500/50"
        >
          <option value="">Todas las intenciones</option>
          <option value="high">Alto</option>
          <option value="medium">Medio</option>
          <option value="low">Bajo</option>
        </select>
        <select
          value={convertedFilter}
          onChange={(e) => { setConvertedFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-purple-500/50"
        >
          <option value="">Todas</option>
          <option value="true">Con compras</option>
          <option value="false">Sin compras</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-6 py-3">Ubicación</th>
                <th className="px-4 py-3">Intención</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="px-4 py-3 text-right">Ingresos</th>
                <th className="px-6 py-3">Último contacto</th>
                <th className="px-6 py-3">Etiquetas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400"></div>
                </td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500">No se encontraron clientes</td></tr>
              ) : customers.map((c) => (
                <tr
                  key={c.psid}
                  onClick={() => navigate(`/crm/${encodeURIComponent(c.psid)}`)}
                  className="hover:bg-gray-700/20 cursor-pointer"
                >
                  <td className="px-6 py-3 text-sm text-white font-medium">{displayName(c)}</td>
                  <td className="px-4 py-3">{channelBadge(c.channel)}</td>
                  <td className="px-6 py-3 text-sm text-gray-300">
                    {[c.city, c.stateMx].filter(Boolean).join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {c.purchaseIntent ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${INTENT_COLORS[c.purchaseIntent] || ''}`}>
                        {INTENT_LABELS[c.purchaseIntent] || c.purchaseIntent}
                      </span>
                    ) : <span className="text-sm text-gray-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-white font-medium">{c.totalPurchases || 0}</td>
                  <td className="px-4 py-3 text-right text-sm text-green-400">{formatCurrency(c.totalRevenue || 0)}</td>
                  <td className="px-6 py-3 text-sm text-gray-300">{formatDate(c.lastMessageAt)}</td>
                  <td className="px-6 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {(c.tags || []).slice(0, 3).map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-purple-500/20 text-purple-300">{tag}</span>
                      ))}
                      {(c.tags || []).length > 3 && (
                        <span className="text-xs text-gray-500">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-700/50 flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {pagination.total} clientes
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >
                Anterior
              </button>
              <span className="px-3 py-1 text-sm text-gray-400">
                {page} / {pagination.pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page >= pagination.pages}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CRMView;
