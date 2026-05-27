import React, { useState, useEffect, useCallback } from 'react';
import API from '../api';
import toast from 'react-hot-toast';
import FlowWizard from '../components/FlowWizard';

export default function ConvoFlowsView() {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchFlows = useCallback(async () => {
    try {
      const res = await API.get('/convo-flows');
      setFlows(res.data?.data || res.data || []);
    } catch (err) {
      toast.error('Error cargando flujos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const handleSave = async (payload) => {
    try {
      if (editing) {
        await API.put(`/convo-flows/${editing._id}`, payload);
        toast.success('Flujo actualizado');
      } else {
        await API.post('/convo-flows', payload);
        toast.success('Flujo creado');
      }
      setShowWizard(false);
      setEditing(null);
      fetchFlows();
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (flow) => {
    if (!window.confirm(`¿Eliminar el flujo "${flow.displayName}"? Esta acción no se puede deshacer.`)) return;
    try {
      await API.delete(`/convo-flows/${flow._id}`);
      toast.success('Flujo eliminado');
      fetchFlows();
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleToggleActive = async (flow) => {
    try {
      await API.put(`/convo-flows/${flow._id}`, { active: !flow.active });
      fetchFlows();
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Flujos de Conversación</h1>
        <div className="p-12 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Flujos de Conversación</h1>
          <p className="text-gray-400">Cada flujo guía la conversación del bot para un producto, canal y persona específicos. Asocia un flujo a un anuncio desde Anuncios.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowWizard(true); }}
          className="px-5 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Nuevo flujo
        </button>
      </div>

      {showWizard && (
        <FlowWizard
          editing={editing}
          onSave={handleSave}
          onClose={() => { setShowWizard(false); setEditing(null); }}
        />
      )}

      {flows.length === 0 ? (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
          <p className="text-gray-400 mb-4">Aún no has creado ningún flujo</p>
          <button onClick={() => { setEditing(null); setShowWizard(true); }}
            className="px-5 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm">
            Crear el primero
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map(flow => (
            <div key={flow._id} className={`bg-gray-800/50 border rounded-xl p-5 ${flow.active ? 'border-gray-700/50' : 'border-gray-700/30 opacity-60'}`}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold truncate">{flow.displayName || flow.name}</h3>
                  <p className="text-xs text-gray-500 font-mono mt-0.5 truncate">{flow.name}</p>
                </div>
                <button onClick={() => handleToggleActive(flow)}
                  title={flow.active ? 'Desactivar' : 'Activar'}
                  className={`ml-2 px-2 py-1 rounded text-xs font-medium ${flow.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {flow.active ? 'Activo' : 'Inactivo'}
                </button>
              </div>

              <div className="space-y-1.5 text-xs mb-4">
                {flow.products?.[0]?.name && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Producto:</span>
                    <span className="text-white truncate ml-2">{flow.products[0].name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Canal:</span>
                  <span className="text-white capitalize">{flow.salesChannel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Persona:</span>
                  <span className="text-white capitalize">{flow.clientProfile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Voz:</span>
                  <span className="text-white capitalize">{flow.voice}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Venta:</span>
                  <span className="text-white">{flow.endpointOfSale === 'online_store' ? 'Tienda online' : 'Humano'}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-700/50">
                <button onClick={() => { setEditing(flow); setShowWizard(true); }}
                  className="flex-1 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-white rounded text-xs font-medium">
                  Editar
                </button>
                <button onClick={() => handleDelete(flow)}
                  className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs font-medium">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
