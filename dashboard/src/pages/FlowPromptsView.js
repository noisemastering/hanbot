import React, { useState, useEffect, useCallback } from 'react';
import API from '../api';
import toast from 'react-hot-toast';

const FLOW_LABELS = {
  masterFlow: 'Master Flow',
  retailFlow: 'Retail Flow',
  wholesaleFlow: 'Wholesale Flow',
  promoFlow: 'Promo Flow',
  buyerFlow: 'Buyer Flow',
  resellerFlow: 'Reseller Flow'
};

const FLOW_ORDER = ['masterFlow', 'retailFlow', 'wholesaleFlow', 'promoFlow', 'buyerFlow', 'resellerFlow'];

function FlowPromptsView() {
  const [prompts, setPrompts] = useState({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id, prompt }
  const [saving, setSaving] = useState(false);
  const [expandedFlows, setExpandedFlows] = useState(new Set(['masterFlow']));

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await API.get('/flow-prompts');
      setPrompts(res.data?.data || {});
    } catch (err) {
      toast.error('Error cargando prompts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const toggleFlow = (flow) => {
    setExpandedFlows(prev => {
      const next = new Set(prev);
      if (next.has(flow)) next.delete(flow);
      else next.add(flow);
      return next;
    });
  };

  const startEdit = (p) => {
    setEditing({ id: p._id, prompt: p.prompt, label: p.label, flow: p.flow, key: p.key });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await API.put(`/flow-prompts/${editing.id}`, { prompt: editing.prompt });
      toast.success('Prompt actualizado');
      setEditing(null);
      fetchPrompts();
    } catch (err) {
      toast.error('Error guardando: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Prompts de Flujos</h1>
        <p className="text-gray-400 mb-6">Edita los prompts de IA de cada bloque del bot</p>
        <div className="p-12 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Prompts de Flujos</h1>
      <p className="text-gray-400 mb-6">Edita los prompts de IA de cada bloque del bot. Los cambios se aplican en tiempo real.</p>

      {/* Editing modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{editing.label}</h2>
                <p className="text-xs text-gray-500 mt-1">{FLOW_LABELS[editing.flow] || editing.flow} &rarr; {editing.key}</p>
              </div>
              <button onClick={cancelEdit} className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <textarea
                value={editing.prompt}
                onChange={(e) => setEditing(prev => ({ ...prev, prompt: e.target.value }))}
                className="w-full h-[60vh] px-4 py-3 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                spellCheck={false}
              />
              <p className="text-xs text-gray-500 mt-2">
                Variables disponibles: {'{{voiceInstructions}}'}, {'{{channelNote}}'}, {'{{customerName}}'}, {'{{colorNote}}'}, {'{{currentProfile}}'}, {'{{multiProductNote}}'}, {'{{linkInstruction}}'}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end gap-3">
              <button onClick={cancelEdit} className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50">
                Cancelar
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flow list */}
      <div className="space-y-4">
        {FLOW_ORDER.filter(f => prompts[f]).map(flow => {
          const flowPrompts = prompts[flow];
          const isExpanded = expandedFlows.has(flow);

          return (
            <div key={flow} className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
              <button
                onClick={() => toggleFlow(flow)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <h3 className="text-lg font-semibold text-white">{FLOW_LABELS[flow] || flow}</h3>
                  <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                    {flowPrompts.length} prompt{flowPrompts.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-6 pb-4 space-y-3">
                  {flowPrompts.map(p => (
                    <div key={p._id} className="bg-gray-900/50 border border-gray-700/30 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="text-sm font-medium text-white">{p.label}</h4>
                          {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                        </div>
                        <button
                          onClick={() => startEdit(p)}
                          className="px-3 py-1.5 text-xs bg-primary-500/10 text-primary-400 rounded-lg hover:bg-primary-500/20 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <pre className="text-xs text-gray-400 bg-gray-950/50 rounded p-3 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                        {p.prompt.slice(0, 300)}{p.prompt.length > 300 ? '...' : ''}
                      </pre>
                      {p.updatedBy && (
                        <p className="text-xs text-gray-600 mt-2">
                          Editado por {p.updatedBy} el {new Date(p.updatedAt).toLocaleDateString('es-MX')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FlowPromptsView;
