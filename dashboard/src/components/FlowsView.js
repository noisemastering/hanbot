// components/FlowsView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import FlowModal from './FlowModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function FlowsView() {
  const [flows, setFlows] = useState([]);
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);

  useEffect(() => {
    fetchFlows();
    fetchIntents();
  }, []);

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/flows`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setFlows(data.data);
      }
    } catch (error) {
      console.error('Error fetching flows:', error);
      toast.error('Error al cargar flows');
    } finally {
      setLoading(false);
    }
  };

  const fetchIntents = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intents`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setIntents(data.data);
      }
    } catch (error) {
      console.error('Error fetching intents:', error);
    }
  };

  // Filter flows
  const filteredFlows = flows.filter(flow => {
    const matchesSearch =
      flow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      flow.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (flow.triggerIntent && flow.triggerIntent.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesActive =
      filterActive === 'all' ||
      (filterActive === 'active' && flow.active) ||
      (filterActive === 'inactive' && !flow.active);

    return matchesSearch && matchesActive;
  });

  const handleEdit = (flow) => {
    setEditingFlow(flow);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingFlow(null);
    setShowModal(true);
  };

  const handleSave = async (flowData) => {
    try {
      const token = localStorage.getItem('token');
      const url = editingFlow
        ? `${API_URL}/flows/${editingFlow._id}`
        : `${API_URL}/flows`;

      const res = await fetch(url, {
        method: editingFlow ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(flowData)
      });

      const data = await res.json();
      if (data.success) {
        toast.success(editingFlow ? 'Flow actualizado' : 'Flow creado');
        fetchFlows();
        setShowModal(false);
        setEditingFlow(null);
      } else {
        toast.error(data.error || 'Error al guardar');
      }
    } catch (error) {
      console.error('Error saving flow:', error);
      toast.error('Error al guardar flow');
    }
  };

  const handleDelete = async (flow) => {
    if (window.confirm(`¿Eliminar el flow "${flow.name}"?`)) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/flows/${flow._id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        if (data.success) {
          toast.success('Flow eliminado');
          fetchFlows();
        } else {
          toast.error(data.error || 'Error al eliminar');
        }
      } catch (error) {
        console.error('Error deleting flow:', error);
        toast.error('Error al eliminar flow');
      }
    }
  };

  const getIntentName = (intentKey) => {
    const intent = intents.find(i => i.key === intentKey);
    return intent?.name || intentKey;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Conversation Flows</h2>
          <p className="text-gray-400 text-sm mt-1">
            Define flujos de conversación paso a paso para recopilar información
          </p>
        </div>

        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo Flow
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar por nombre, key o intent..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 pl-10 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
            />
            <svg
              className="absolute left-3 top-2.5 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Status filter */}
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
        >
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="text-gray-400 mt-4">Cargando flows...</p>
        </div>
      ) : filteredFlows.length === 0 ? (
        <div className="text-center py-12 bg-gray-800 rounded-lg">
          <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p className="text-gray-400">No hay flows que coincidan con tu búsqueda</p>
          <button
            onClick={handleCreate}
            className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            Crear primer flow
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFlows.map(flow => (
            <div
              key={flow._id}
              className={`bg-gray-800 rounded-lg border ${flow.active ? 'border-gray-700' : 'border-gray-700/50'} hover:border-gray-600 transition-colors`}
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-700">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-white truncate">
                        {flow.name}
                      </h3>
                      {!flow.active && (
                        <span className="px-2 py-0.5 text-xs bg-gray-600 text-gray-300 rounded">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 font-mono mt-1">{flow.key}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => handleEdit(flow)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Editar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(flow)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                      title="Eliminar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-4 space-y-3">
                {/* Trigger Intent */}
                {flow.triggerIntent && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">Trigger:</span>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full">
                      {getIntentName(flow.triggerIntent)}
                    </span>
                  </div>
                )}

                {/* Steps */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm">Pasos:</span>
                  <div className="flex items-center gap-1">
                    {flow.steps?.slice(0, 5).map((step, idx) => (
                      <div
                        key={step.stepId || idx}
                        className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs text-gray-300"
                        title={step.message?.substring(0, 50)}
                      >
                        {idx + 1}
                      </div>
                    ))}
                    {flow.steps?.length > 5 && (
                      <span className="text-xs text-gray-500">+{flow.steps.length - 5}</span>
                    )}
                    {(!flow.steps || flow.steps.length === 0) && (
                      <span className="text-xs text-gray-500 italic">Sin pasos</span>
                    )}
                  </div>
                </div>

                {/* On Complete */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm">Al completar:</span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    flow.onComplete?.action === 'handoff' ? 'bg-orange-500/20 text-orange-400' :
                    flow.onComplete?.action === 'flow' ? 'bg-purple-500/20 text-purple-400' :
                    'bg-gray-600 text-gray-300'
                  }`}>
                    {flow.onComplete?.action === 'handoff' ? 'Handoff' :
                     flow.onComplete?.action === 'flow' ? 'Otro flow' :
                     flow.onComplete?.action === 'intent' ? 'Intent' : 'Mensaje'}
                  </span>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 pt-2 text-xs text-gray-500">
                  <span title="Iniciados">{flow.startCount || 0} iniciados</span>
                  <span title="Completados">{flow.completeCount || 0} completados</span>
                  {flow.startCount > 0 && (
                    <span title="Tasa de completado" className="text-green-400">
                      {((flow.completeCount || 0) / flow.startCount * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <FlowModal
          flow={editingFlow}
          intents={intents}
          onClose={() => {
            setShowModal(false);
            setEditingFlow(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

export default FlowsView;
