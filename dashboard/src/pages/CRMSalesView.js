import React, { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api';
import FeatureTip from '../components/FeatureTip';

// ML icon (shopping cart)
const MLIcon = () => (
  <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Mercado Libre">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

// Manual sale icon (hand/pencil)
const ManualIcon = () => (
  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Venta manual">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

function CRMSalesView() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddSale, setShowAddSale] = useState(false);
  const [saleForm, setSaleForm] = useState({ crmName: '', crmPhone: '', crmEmail: '', zipCode: '', productName: '', totalAmount: '', quantity: '1', notes: '', saleDate: new Date().toISOString().split('T')[0] });
  const [saving, setSaving] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState(null);
  const [productList, setProductList] = useState([]);
  const [productSuggestions, setProductSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);
  const [totals, setTotals] = useState({ totalRevenue: 0, totalSales: 0, mlSales: 0, manualSales: 0 });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (search) params.set('search', search);
      if (sourceFilter) params.set('source', sourceFilter);
      const res = await API.get(`/crm/sales?${params}`);
      setSales(res.data.sales || []);
      setPagination(res.data.pagination || { total: 0, pages: 1 });
      if (res.data.totals) setTotals(res.data.totals);
    } catch (err) {
      console.error('Error fetching CRM sales:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, sourceFilter]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
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

  // Load product list for autocomplete
  useEffect(() => {
    API.get('/crm/products').then(res => {
      if (res.data.success) setProductList(res.data.products || []);
    }).catch(() => {});
  }, []);

  // Product suggestions
  useEffect(() => {
    if (saleForm.productName.length >= 1 && productList.length > 0) {
      const q = saleForm.productName.toLowerCase();
      const matches = productList.filter(p => p.toLowerCase().includes(q)).slice(0, 8);
      setProductSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setProductSuggestions([]);
      setShowSuggestions(false);
    }
  }, [saleForm.productName, productList]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleAddSale = async () => {
    if (!saleForm.productName.trim() || !saleForm.totalAmount) return;
    setSaving(true);
    setSaleSuccess(null);
    try {
      const res = await API.post('/crm/standalone-sale', {
        productName: saleForm.productName.trim(),
        totalAmount: parseFloat(saleForm.totalAmount),
        quantity: parseInt(saleForm.quantity) || 1,
        notes: saleForm.notes.trim() || undefined,
        crmName: saleForm.crmName.trim() || undefined,
        crmPhone: saleForm.crmPhone.trim() || undefined,
        crmEmail: saleForm.crmEmail.trim() || undefined,
        zipCode: saleForm.zipCode.trim() || undefined,
        saleDate: saleForm.saleDate ? new Date(saleForm.saleDate + 'T12:00:00').toISOString() : undefined
      });
      if (res.data.success) {
        setSaleSuccess(`${saleForm.productName} — $${parseFloat(saleForm.totalAmount).toLocaleString()}`);
        setSaleForm({ crmName: '', crmPhone: '', crmEmail: '', zipCode: '', productName: '', totalAmount: '', quantity: '1', notes: '', saleDate: new Date().toISOString().split('T')[0] });
        fetchSales();
        setTimeout(() => { setSaleSuccess(null); setShowAddSale(false); }, 2500);
      }
    } catch (err) {
      console.error('Error adding sale:', err);
    } finally {
      setSaving(false);
    }
  };

  const isManual = (sale) => sale.correlationMethod === 'manual';

  const toTitleCase = (str) => {
    if (!str) return str;
    return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  };

  const buyerName = (sale) => {
    let name = sale.userName;
    if (!name) {
      const first = sale.conversionData?.buyerFirstName || '';
      const last = sale.conversionData?.buyerLastName || '';
      name = (first || last) ? `${first} ${last}`.trim() : null;
    }
    if (!name) name = sale.conversionData?.buyerNickname;
    return toTitleCase(name) || '-';
  };

  if (loading && sales.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Ventas</h1>
        <FeatureTip id="crm-add-sale" title="Registrar venta manual" text="Registra ventas que no pasaron por Mercado Libre — como ventas directas, por teléfono o en tienda. Puedes registrar ventas de hasta 30 días atrás." position="left">
          <button
            onClick={() => { setShowAddSale(!showAddSale); setSaleSuccess(null); }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-all"
          >
            {showAddSale ? 'Cerrar' : '+ Registrar Venta'}
          </button>
        </FeatureTip>
      </div>

      {/* Add Sale Form */}
      {showAddSale && (
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Registrar venta manual</h2>
          {saleSuccess ? (
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-center">
              Venta registrada: {saleSuccess}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Nombre del cliente</label>
                  <input type="text" value={saleForm.crmName} onChange={e => setSaleForm(f => ({ ...f, crmName: e.target.value }))}
                    placeholder="Juan Pérez" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Teléfono</label>
                  <input type="text" value={saleForm.crmPhone} onChange={e => setSaleForm(f => ({ ...f, crmPhone: e.target.value }))}
                    placeholder="4421234567" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Email</label>
                  <input type="email" value={saleForm.crmEmail} onChange={e => setSaleForm(f => ({ ...f, crmEmail: e.target.value }))}
                    placeholder="cliente@email.com" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Código postal</label>
                  <input type="text" value={saleForm.zipCode} onChange={e => setSaleForm(f => ({ ...f, zipCode: e.target.value }))}
                    placeholder="76900" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative" ref={suggestionsRef}>
                  <label className="block text-xs text-gray-400 mb-1">Producto *</label>
                  <input type="text" value={saleForm.productName}
                    onChange={e => setSaleForm(f => ({ ...f, productName: e.target.value }))}
                    onFocus={() => { if (saleForm.productName.length >= 1 && productSuggestions.length > 0) setShowSuggestions(true); }}
                    placeholder="Buscar producto..."
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                  {showSuggestions && productSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {productSuggestions.map((p, i) => (
                        <button key={i} type="button"
                          onClick={() => { setSaleForm(f => ({ ...f, productName: p })); setShowSuggestions(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 hover:text-white transition-colors">
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Monto total *</label>
                  <input type="number" value={saleForm.totalAmount} onChange={e => setSaleForm(f => ({ ...f, totalAmount: e.target.value }))}
                    placeholder="690" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Cantidad</label>
                  <input type="number" value={saleForm.quantity} onChange={e => setSaleForm(f => ({ ...f, quantity: e.target.value }))}
                    min="1" className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Fecha de venta</label>
                  <input type="date" value={saleForm.saleDate} onChange={e => setSaleForm(f => ({ ...f, saleDate: e.target.value }))}
                    max={new Date().toISOString().split('T')[0]}
                    min={new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]}
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notas (opcional)</label>
                <input type="text" value={saleForm.notes} onChange={e => setSaleForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Notas adicionales..." className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-green-500/50" />
              </div>
              <button onClick={handleAddSale} disabled={saving || !saleForm.productName.trim() || !saleForm.totalAmount}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-all">
                {saving ? 'Registrando...' : 'Registrar venta'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Total Ventas</p>
          <p className="text-2xl font-bold text-purple-400">{totals.totalSales}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ingresos</p>
          <p className="text-2xl font-bold text-green-400">{formatCurrency(totals.totalRevenue)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400 flex items-center gap-1.5"><MLIcon /> Mercado Libre</p>
          <p className="text-2xl font-bold text-yellow-400">{totals.mlSales}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400 flex items-center gap-1.5"><ManualIcon /> Manuales</p>
          <p className="text-2xl font-bold text-blue-400">{totals.manualSales}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por producto, comprador o ciudad..."
          className="flex-1 min-w-[200px] px-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50"
        />
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-purple-500/50"
        >
          <option value="">Todas las fuentes</option>
          <option value="ml">Mercado Libre</option>
          <option value="manual">Manuales</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-4 py-3 w-10">Fuente</th>
                <th className="px-6 py-3">Producto</th>
                <th className="px-6 py-3">Comprador</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-6 py-3">Ciudad</th>
                <th className="px-6 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400" />
                </td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No se encontraron ventas</td></tr>
              ) : sales.map((s) => (
                <tr key={s.clickId || s._id} className="hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-center" title={isManual(s) ? 'Venta manual' : 'Mercado Libre'}>
                    {isManual(s) ? <ManualIcon /> : <MLIcon />}
                  </td>
                  <td className="px-6 py-3 text-sm text-white font-medium">
                    {s.productName || s.conversionData?.itemTitle || '-'}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-300">{buyerName(s)}</td>
                  <td className="px-4 py-3 text-right text-sm text-green-400 font-medium">
                    {formatCurrency(s.conversionData?.totalAmount || 0)}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-300">
                    {[s.city, s.stateMx].filter(Boolean).join(', ') || '-'}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-300">{formatDate(s.convertedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-700/50 flex items-center justify-between">
            <p className="text-sm text-gray-400">{pagination.total} ventas</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >Anterior</button>
              <span className="px-3 py-1 text-sm text-gray-400">{page} / {pagination.pages}</span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page >= pagination.pages}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CRMSalesView;
