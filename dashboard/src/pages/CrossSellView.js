import React, { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function authHeaders() {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const TRIGGER_TYPES = [
  { value: 'in_conversation', label: 'Durante la conversación', desc: 'El bot sugiere mientras el cliente pregunta por el producto origen' },
  { value: 'post_purchase', label: 'Post-compra', desc: 'El bot sugiere después de que el cliente compra el producto origen' },
  { value: 'cart_suggestion', label: 'Antes de cerrar', desc: 'El bot sugiere antes de enviar el link de compra' }
];

export default function CrossSellView() {
  const [rules, setRules] = useState([]);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', sourceProductFamilyId: '', targetProductFamilyId: '',
    triggerType: 'in_conversation', priority: 0, message: '', active: true,
    conditions: { minOrderAmount: 0, minQuantity: 0 }
  });

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/cross-sell`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setRules(data.data || []);
    } catch {}
  }, []);

  const fetchFamilies = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        const flat = [];
        const walk = (nodes, path = '') => {
          for (const n of (nodes || [])) {
            const fullPath = path ? `${path} > ${n.name}` : n.name;
            flat.push({ id: n._id, name: n.name, path: fullPath, sellable: n.sellable });
            if (n.children) walk(n.children, fullPath);
          }
        };
        walk(data.data);
        setFamilies(flat);
      }
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchRules(), fetchFamilies()]).finally(() => setLoading(false));
  }, [fetchRules, fetchFamilies]);

  const resetForm = () => {
    setForm({ name: '', sourceProductFamilyId: '', targetProductFamilyId: '', triggerType: 'in_conversation', priority: 0, message: '', active: true, conditions: { minOrderAmount: 0, minQuantity: 0 } });
    setEditing(null);
    setShowForm(false);
  };

  const openEdit = (rule) => {
    setForm({
      name: rule.name,
      sourceProductFamilyId: rule.sourceProductFamilyId?._id || rule.sourceProductFamilyId || '',
      targetProductFamilyId: rule.targetProductFamilyId?._id || rule.targetProductFamilyId || '',
      triggerType: rule.triggerType || 'in_conversation',
      priority: rule.priority || 0,
      message: rule.message || '',
      active: rule.active !== false,
      conditions: rule.conditions || { minOrderAmount: 0, minQuantity: 0 }
    });
    setEditing(rule._id);
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      const url = editing ? `${API_URL}/cross-sell/${editing}` : `${API_URL}/cross-sell`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(form) });
      const data = await res.json();
      if (data.success) { fetchRules(); resetForm(); }
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta regla?')) return;
    try {
      await fetch(`${API_URL}/cross-sell/${id}`, { method: 'DELETE', headers: authHeaders() });
      fetchRules();
    } catch {}
  };

  const toggleActive = async (rule) => {
    try {
      await fetch(`${API_URL}/cross-sell/${rule._id}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ active: !rule.active })
      });
      fetchRules();
    } catch {}
  };

  const getFamilyName = (id) => {
    if (!id) return '—';
    const fam = families.find(f => f.id === (id._id || id));
    return fam?.name || (id.name || '—');
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Cross-Selling</h1>
          <p className="text-gray-400 mt-2">Reglas de venta cruzada — el bot sugiere productos complementarios</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="px-5 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium">
          Nueva regla
        </button>
      </div>

      {/* How it works */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
        <p className="text-sm text-blue-300">
          Define reglas para que el bot sugiera productos complementarios. Ejemplo: cuando alguien compra malla confeccionada, sugerir cuerda para instalarla.
          Cada regla conecta un producto origen con un producto destino y define cuándo se activa la sugerencia.
        </p>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">{editing ? 'Editar regla' : 'Nueva regla'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nombre de la regla</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Cuerda con confeccionada"
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Disparador</label>
              <select value={form.triggerType} onChange={e => setForm(f => ({ ...f, triggerType: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm">
                {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Producto origen (cuando compran...)</label>
              <select value={form.sourceProductFamilyId} onChange={e => setForm(f => ({ ...f, sourceProductFamilyId: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm">
                <option value="">Seleccionar...</option>
                {families.filter(f => !f.sellable).map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Producto destino (...sugerir esto)</label>
              <select value={form.targetProductFamilyId} onChange={e => setForm(f => ({ ...f, targetProductFamilyId: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm">
                <option value="">Seleccionar...</option>
                {families.filter(f => !f.sellable).map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Mensaje de sugerencia</label>
              <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Ej: Para instalar tu malla vas a necesitar cuerda. ¿Te gustaría ver las opciones?"
                rows={2}
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Prioridad (mayor = se muestra primero)</label>
              <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  className="rounded border-gray-600 text-primary-500" />
                <span className="text-sm text-gray-300">Activa</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={resetForm} className="px-4 py-2 bg-gray-700/50 text-white rounded-lg text-sm">Cancelar</button>
            <button onClick={handleSave} disabled={!form.name || !form.sourceProductFamilyId || !form.targetProductFamilyId}
              className="px-5 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 text-sm font-medium">
              {editing ? 'Guardar' : 'Crear regla'}
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-2xl mb-2">🔄</p>
          <h3 className="text-lg font-semibold text-white mb-2">Sin reglas de cross-selling</h3>
          <p className="text-gray-400">Crea tu primera regla para que el bot sugiera productos complementarios</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule._id} className={`bg-gray-800/50 border rounded-xl p-5 ${rule.active ? 'border-gray-700/50' : 'border-gray-700/30 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-sm font-semibold text-white">{rule.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${rule.active ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-gray-500/10 border border-gray-500/30 text-gray-400'}`}>
                      {rule.active ? 'Activa' : 'Inactiva'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300">
                      {TRIGGER_TYPES.find(t => t.value === rule.triggerType)?.label || rule.triggerType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                    <span className="text-cyan-400">{getFamilyName(rule.sourceProductFamilyId)}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-amber-400">{getFamilyName(rule.targetProductFamilyId)}</span>
                  </div>
                  {rule.message && <p className="text-xs text-gray-500 italic">"{rule.message}"</p>}
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button onClick={() => toggleActive(rule)} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50" title={rule.active ? 'Desactivar' : 'Activar'}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={rule.active ? "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
                    </svg>
                  </button>
                  <button onClick={() => openEdit(rule)} className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg" title="Editar">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(rule._id)} className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg" title="Eliminar">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
