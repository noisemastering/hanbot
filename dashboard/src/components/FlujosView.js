import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import FeatureTip from './FeatureTip';
import FlowWizard from './FlowWizard';

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


function FlujosView() {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);


  useEffect(() => {
    fetchFlows();
  }, []);

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/convo-flows`);
      const data = await res.json();
      if (data.success) setFlows((data.data || []).filter(f => !f.hasCustomHandler));
    } catch (err) {
      console.error('Error fetching flows:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (flow) => {
    setEditing(flow);
    setShowModal(true);
  };

  const handleWizardSave = async (payload) => {
    try {
      const url = editing
        ? `${API_URL}/convo-flows/${editing._id}`
        : `${API_URL}/convo-flows`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

      {/* Flow Wizard */}
      {showModal && (
        <FlowWizard
          editing={editing}
          onSave={handleWizardSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

export default FlujosView;
