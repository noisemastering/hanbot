import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import FeatureTip from './FeatureTip';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const SALES_CHANNELS = [
  { value: 'retail', label: 'Menudeo' },
  { value: 'wholesale', label: 'Mayoreo' }
];

const CLIENT_PROFILES = [
  { value: 'buyer', label: 'Comprador' },
  { value: 'reseller', label: 'Revendedor' }
];

const VOICES = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Profesional' },
  { value: 'technical', label: 'Técnico' }
];

const ENDPOINTS = [
  { value: 'online_store', label: 'Tienda en línea' },
  { value: 'human', label: 'Asesor humano' }
];

function FlujosView() {
  const [flows, setFlows] = useState([]);
  const [productFamilies, setProductFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(getEmptyForm());

  function getEmptyForm() {
    return {
      displayName: '',
      salesChannel: 'retail',
      clientProfile: 'buyer',
      endpointOfSale: 'online_store',
      voice: 'casual',
      products: [],
      installationNote: '',
      allowListing: false,
      offersCatalog: false,
      description: '',
      active: true
    };
  }

  useEffect(() => {
    fetchFlows();
    fetchProducts();
  }, []);

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/convo-flows`);
      const data = await res.json();
      if (data.success) setFlows(data.data || []);
    } catch (err) {
      console.error('Error fetching flows:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        // Flatten to root families only
        const roots = (data.data || []).filter(p => !p.parentId);
        setProductFamilies(roots);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(getEmptyForm());
    setShowModal(true);
  };

  const openEdit = (flow) => {
    setEditing(flow);
    setForm({
      displayName: flow.displayName || '',
      salesChannel: flow.salesChannel || 'retail',
      clientProfile: flow.clientProfile || 'buyer',
      endpointOfSale: flow.endpointOfSale || 'online_store',
      voice: flow.voice || 'casual',
      products: (flow.products || []).map(p => p._id || p),
      installationNote: flow.installationNote || '',
      allowListing: flow.allowListing || false,
      offersCatalog: flow.offersCatalog || false,
      description: flow.description || '',
      active: flow.active !== false
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.displayName.trim()) {
      toast.error('El nombre es requerido');
      return;
    }
    if (form.products.length === 0) {
      toast.error('Selecciona al menos un producto');
      return;
    }

    try {
      const url = editing
        ? `${API_URL}/convo-flows/${editing._id}`
        : `${API_URL}/convo-flows`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();

      if (data.success) {
        toast.success(editing ? 'Flujo actualizado' : 'Flujo creado');
        setShowModal(false);
        fetchFlows();
      } else {
        toast.error(data.error || 'Error al guardar');
      }
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const handleDelete = async (flow) => {
    if (!window.confirm(`¿Eliminar "${flow.displayName}"?`)) return;
    try {
      const res = await fetch(`${API_URL}/convo-flows/${flow._id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Flujo eliminado');
        fetchFlows();
      }
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const toggleProduct = (id) => {
    setForm(prev => ({
      ...prev,
      products: prev.products.includes(id)
        ? prev.products.filter(p => p !== id)
        : [...prev.products, id]
    }));
  };

  const channelLabel = (v) => SALES_CHANNELS.find(c => c.value === v)?.label || v;
  const profileLabel = (v) => CLIENT_PROFILES.find(c => c.value === v)?.label || v;
  const voiceLabel = (v) => VOICES.find(c => c.value === v)?.label || v;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Flujos</h1>
          <p className="text-gray-400 mt-2">Crea y administra flujos de conversación</p>
        </div>
        <FeatureTip id="flujos-add" title="Crear flujo" text="Crea un flujo de conversación para el bot. Define qué producto maneja, el canal de venta y el perfil del cliente." position="left">
          <button
            onClick={openCreate}
            className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Nuevo Flujo</span>
          </button>
        </FeatureTip>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : flows.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <h3 className="text-lg font-semibold text-white mb-2">Sin flujos</h3>
          <p className="text-gray-400">Crea tu primer flujo de conversación</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {flows.map(flow => (
            <div key={flow._id} className={`bg-gray-800/50 border rounded-xl p-5 ${flow.active ? 'border-gray-700/50' : 'border-gray-700/30 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-white">{flow.displayName}</h3>
                    {flow.hasCustomHandler && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300">Custom</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${flow.active ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-gray-500/10 border border-gray-500/30 text-gray-400'}`}>
                      {flow.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{flow.name}</code>
                  {flow.description && <p className="text-sm text-gray-400 mt-2">{flow.description}</p>}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="text-xs px-2 py-1 rounded bg-indigo-500/10 text-indigo-300">{channelLabel(flow.salesChannel)}</span>
                    <span className="text-xs px-2 py-1 rounded bg-cyan-500/10 text-cyan-300">{profileLabel(flow.clientProfile)}</span>
                    <span className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-300">{voiceLabel(flow.voice)}</span>
                    {(flow.products || []).map(p => (
                      <span key={p._id || p} className="text-xs px-2 py-1 rounded bg-gray-700/50 text-gray-300">
                        {p.name || p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button onClick={() => openEdit(flow)} className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors" title="Editar">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {!flow.hasCustomHandler && (
                    <button onClick={() => handleDelete(flow)} className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors" title="Eliminar">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{editing ? 'Editar Flujo' : 'Nuevo Flujo'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors" title="Cerrar">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Nombre</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Ej: Confeccionada Menudeo"
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Descripción (opcional)</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Breve descripción del flujo"
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Core config row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Canal de venta</label>
                  <select value={form.salesChannel} onChange={(e) => setForm({ ...form, salesChannel: e.target.value })} className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {SALES_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Perfil del cliente</label>
                  <select value={form.clientProfile} onChange={(e) => setForm({ ...form, clientProfile: e.target.value })} className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {CLIENT_PROFILES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Voz</label>
                  <select value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {VOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cierre de venta</label>
                  <select value={form.endpointOfSale} onChange={(e) => setForm({ ...form, endpointOfSale: e.target.value })} className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {ENDPOINTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Products */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Productos</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto bg-gray-900/30 border border-gray-700 rounded-lg p-3">
                  {productFamilies.map(p => (
                    <label key={p._id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.products.includes(p._id)}
                        onChange={() => toggleProduct(p._id)}
                        className="rounded border-gray-600 text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-300">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Installation note */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Nota de instalación (opcional)</label>
                <textarea
                  value={form.installationNote}
                  onChange={(e) => setForm({ ...form, installationNote: e.target.value })}
                  rows={2}
                  placeholder="Instrucciones que el bot menciona al cotizar"
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.allowListing} onChange={(e) => setForm({ ...form, allowListing: e.target.checked })} className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
                  <span className="text-sm text-gray-300">Permitir listar productos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.offersCatalog} onChange={(e) => setForm({ ...form, offersCatalog: e.target.checked })} className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
                  <span className="text-sm text-gray-300">Ofrece catálogo</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
                  <span className="text-sm text-gray-300">Activo</span>
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave} className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors">
                {editing ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlujosView;
