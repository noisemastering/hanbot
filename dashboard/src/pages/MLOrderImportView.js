import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function formatMoney(n) {
  if (n == null) return '-';
  return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

function authHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

const SELLER_ID = '482595248';

export default function MLOrderImportView() {
  const [stats, setStats] = useState(null);
  const [progress, setProgress] = useState(null);
  const [unmapped, setUnmapped] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [tab, setTab] = useState('overview'); // overview, mappings, unmapped
  const [families, setFamilies] = useState([]);
  const [editingMapping, setEditingMapping] = useState(null);
  const [editProductId, setEditProductId] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, progressRes, monthlyRes] = await Promise.all([
        fetch(`${API_URL}/ml/import/stats`, { headers: authHeaders() }),
        fetch(`${API_URL}/ml/import/progress/${SELLER_ID}`, { headers: authHeaders() }),
        fetch(`${API_URL}/ml/import/revenue-by-month`, { headers: authHeaders() })
      ]);
      const [statsData, progressData, monthlyData] = await Promise.all([
        statsRes.json(), progressRes.json(), monthlyRes.json()
      ]);
      if (statsData.success) setStats(statsData.data);
      if (progressData.success) setProgress(progressData.data);
      if (monthlyData.success) setMonthly(monthlyData.data);
    } catch (err) {
      console.error('Error fetching import data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMappings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/ml/import/mappings?limit=200`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setMappings(data.data || []);
    } catch {}
  }, []);

  const fetchUnmapped = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/ml/import/unmapped?limit=100`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setUnmapped(data.data || []);
    } catch {}
  }, []);

  const fetchFamilies = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        // Flatten tree to get all sellable products
        const flat = [];
        const walk = (nodes, path = '') => {
          for (const n of (nodes || [])) {
            const fullPath = path ? `${path} > ${n.name}` : n.name;
            if (n.sellable) flat.push({ id: n._id, name: n.name, path: fullPath, size: n.size });
            if (n.children) walk(n.children, fullPath);
          }
        };
        walk(data.data);
        setFamilies(flat);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchAll(); fetchFamilies(); }, [fetchAll, fetchFamilies]);

  useEffect(() => {
    if (tab === 'mappings') fetchMappings();
    if (tab === 'unmapped') fetchUnmapped();
  }, [tab, fetchMappings, fetchUnmapped]);

  // Poll progress while import is running
  useEffect(() => {
    if (progress?.status !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/ml/import/progress/${SELLER_ID}`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
          setProgress(data.data);
          if (data.data.status !== 'running') {
            clearInterval(interval);
            fetchAll();
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [progress?.status, fetchAll]);

  const startImport = async () => {
    try {
      const res = await fetch(`${API_URL}/ml/import/start/${SELLER_ID}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setProgress({ status: 'running', imported: 0, skipped: 0, windowsDone: 0, windowsTotal: 0 });
      }
    } catch (err) {
      console.error('Error starting import:', err);
    }
  };

  const stopImportAction = async () => {
    try {
      await fetch(`${API_URL}/ml/import/stop/${SELLER_ID}`, {
        method: 'POST',
        headers: authHeaders()
      });
    } catch {}
  };

  const runNormalization = async () => {
    setNormalizing(true);
    try {
      await fetch(`${API_URL}/ml/import/normalize`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ limit: 200 })
      });
      await fetchAll();
      if (tab === 'mappings') await fetchMappings();
      if (tab === 'unmapped') await fetchUnmapped();
    } catch (err) {
      console.error('Error normalizing:', err);
    } finally {
      setNormalizing(false);
    }
  };

  const saveMapping = async (mappingId) => {
    try {
      await fetch(`${API_URL}/ml/import/mappings/${mappingId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ productFamilyId: editProductId || null, confidence: 'high' })
      });
      setEditingMapping(null);
      setEditProductId('');
      await fetchMappings();
      await fetchAll();
    } catch {}
  };

  const deleteMapping = async (mappingId) => {
    if (!window.confirm('¿Eliminar este mapeo?')) return;
    try {
      await fetch(`${API_URL}/ml/import/mappings/${mappingId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await fetchMappings();
      await fetchAll();
    } catch {}
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isRunning = progress?.status === 'running';
  const coveragePct = parseFloat(stats?.coverage || 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Importar Órdenes ML</h1>
          <p className="text-gray-400 mt-2">Importa y normaliza el historial de ventas de Mercado Libre</p>
        </div>
        <div className="flex items-center gap-3">
          {!isRunning ? (
            <button onClick={startImport}
              className="px-5 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium">
              Iniciar importación
            </button>
          ) : (
            <button onClick={stopImportAction}
              className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium">
              Detener
            </button>
          )}
          <button onClick={runNormalization} disabled={normalizing}
            className="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm font-medium">
            {normalizing ? 'Normalizando...' : 'Normalizar productos'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-primary-300 font-medium">
              Importando ({progress.phase === 'archived' ? 'órdenes archivadas' : 'órdenes recientes'})
            </span>
            <span className="text-sm text-primary-400">
              {progress.imported?.toLocaleString()} importadas, {progress.skipped?.toLocaleString()} existentes
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div className="bg-primary-500 h-2 rounded-full transition-all"
              style={{ width: `${progress.windowsTotal > 0 ? (progress.windowsDone / progress.windowsTotal * 100) : 0}%` }} />
          </div>
          <p className="text-xs text-gray-500">{progress.currentWindow || 'Preparando...'}</p>
          {progress.errors?.length > 0 && (
            <p className="text-xs text-red-400 mt-1">{progress.errors.length} errores</p>
          )}
        </div>
      )}

      {/* Completed status */}
      {progress?.status === 'completed' && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm text-green-300">
            Importación completada: {progress.imported?.toLocaleString()} nuevas, {progress.skipped?.toLocaleString()} existentes.
          </p>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">{(stats?.totalOrders || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">Órdenes importadas</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">{(stats?.totalItems || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">Items totales</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-2xl font-bold text-green-400">{(stats?.mappedItems || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">Items mapeados</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-400">{stats?.needsReview || 0}</p>
          <p className="text-xs text-gray-400 mt-1">Pendientes de revisión</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-white">{coveragePct}%</p>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
            <div className={`h-1.5 rounded-full ${coveragePct > 80 ? 'bg-green-500' : coveragePct > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${coveragePct}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">Cobertura</p>
        </div>
      </div>

      {/* Date range */}
      {stats?.dateRange?.from && (
        <p className="text-xs text-gray-500 mb-4">
          Datos desde {new Date(stats.dateRange.from).toLocaleDateString('es-MX')} hasta {new Date(stats.dateRange.to).toLocaleDateString('es-MX')}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-700/50">
        {[
          { id: 'overview', label: 'Resumen' },
          { id: 'mappings', label: `Mapeos (${stats?.totalMappings || 0})` },
          { id: 'unmapped', label: 'Sin mapear' }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
              tab === t.id ? 'text-primary-400 border-primary-500' : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {monthly.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Ingresos mensuales (órdenes importadas)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(v, name) => [name === 'revenue' ? formatMoney(v) : v, name === 'revenue' ? 'Ingresos' : 'Órdenes']}
                  />
                  <Bar dataKey="revenue" name="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {monthly.length === 0 && stats?.totalOrders === 0 && (
            <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
              <p className="text-2xl mb-2">📦</p>
              <h3 className="text-lg font-semibold text-white mb-2">Sin órdenes importadas</h3>
              <p className="text-gray-400">Inicia una importación para traer el historial de ventas de Mercado Libre</p>
            </div>
          )}
        </div>
      )}

      {/* Mappings tab */}
      {tab === 'mappings' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 bg-gray-900/50">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Título ML</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Producto mapeado</th>
                <th className="px-4 py-3 text-center text-xs text-gray-500 font-medium">Confianza</th>
                <th className="px-4 py-3 text-center text-xs text-gray-500 font-medium">Método</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Órdenes</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {mappings.map(m => (
                <tr key={m._id} className="hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-gray-300 max-w-[300px] truncate" title={m.mlItemTitle}>{m.mlItemTitle}</td>
                  <td className="px-4 py-3">
                    {editingMapping === m._id ? (
                      <div className="flex items-center gap-2">
                        <select value={editProductId} onChange={e => setEditProductId(e.target.value)}
                          className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white max-w-[200px]">
                          <option value="">Sin mapeo</option>
                          {families.map(f => (
                            <option key={f.id} value={f.id}>{f.name}{f.size ? ` (${f.size})` : ''}</option>
                          ))}
                        </select>
                        <button onClick={() => saveMapping(m._id)} className="text-green-400 text-xs hover:underline">Guardar</button>
                        <button onClick={() => setEditingMapping(null)} className="text-gray-500 text-xs hover:underline">Cancelar</button>
                      </div>
                    ) : (
                      <span className={m.productFamilyId ? 'text-green-400' : 'text-gray-600'}>
                        {m.productFamilyId?.name || '—'}
                        {m.productFamilyId?.size && <span className="text-gray-500 ml-1">({m.productFamilyId.size})</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      m.confidence === 'high' ? 'bg-green-500/10 text-green-400' :
                      m.confidence === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>
                      {m.confidence}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">{m.matchedBy}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{m.orderCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditingMapping(m._id); setEditProductId(m.productFamilyId?._id || ''); }}
                        className="text-xs text-blue-400 hover:underline">Editar</button>
                      <button onClick={() => deleteMapping(m._id)}
                        className="text-xs text-red-400 hover:underline ml-2">Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {mappings.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Sin mapeos. Ejecuta la normalización primero.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Unmapped tab */}
      {tab === 'unmapped' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 bg-gray-900/50">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Título ML</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Órdenes</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Ingresos</th>
                <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Última vez</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {unmapped.map((u, i) => (
                <tr key={i} className="hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-gray-300 max-w-[400px] truncate" title={u.title}>{u.title}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{u.orderCount}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{formatMoney(u.totalRevenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">{u.lastSeen ? new Date(u.lastSeen).toLocaleDateString('es-MX') : '—'}</td>
                </tr>
              ))}
              {unmapped.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  {stats?.totalOrders > 0 ? 'Todos los items están mapeados' : 'Importa órdenes primero'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* How it works */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mt-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase mb-3">Cómo funciona</h3>
        <div className="text-sm text-gray-400 space-y-2">
          <p><strong className="text-gray-300">1. Importar:</strong> Trae todas las órdenes históricas de Mercado Libre (recientes + archivadas). Se pueden re-importar sin duplicar datos.</p>
          <p><strong className="text-gray-300">2. Normalizar:</strong> La IA analiza cada título de producto de ML y lo mapea a tu catálogo actual. Los mapeos con alta confianza se aplican automáticamente.</p>
          <p><strong className="text-gray-300">3. Revisar:</strong> Revisa y corrige los mapeos de baja confianza manualmente. Entre más mapeos correctos, mejores serán las predicciones de venta.</p>
        </div>
      </div>
    </div>
  );
}
