// components/IntentModal.js
import React, { useState, useEffect } from 'react';

// Handler types
const HANDLER_TYPES = [
  { value: 'ai_generate', label: 'IA genera respuesta', description: 'El bot usa IA para generar una respuesta contextual' },
  { value: 'auto_response', label: 'Respuesta automática', description: 'Usa el template de respuesta definido' },
  { value: 'flow', label: 'Flujo conversacional', description: 'Inicia un flujo de conversación específico' },
  { value: 'human_handoff', label: 'Transferir a humano', description: 'Transfiere la conversación a un agente humano' }
];

function IntentModal({ intent, categories = [], onClose, onSave }) {
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({
    key: '',
    name: '',
    description: '',
    category: 'other',
    keywords: [],
    patterns: [],
    priority: 5,
    responseTemplate: '',
    handlerType: 'ai_generate',
    active: true
  });
  const [keywordInput, setKeywordInput] = useState('');
  const [patternInput, setPatternInput] = useState('');

  useEffect(() => {
    if (intent) {
      setFormData({
        key: intent.key || '',
        name: intent.name || '',
        description: intent.description || '',
        category: intent.category || 'other',
        keywords: intent.keywords || [],
        patterns: intent.patterns || [],
        priority: intent.priority !== undefined ? intent.priority : 5,
        responseTemplate: intent.responseTemplate || '',
        handlerType: intent.handlerType || 'ai_generate',
        active: intent.active !== undefined ? intent.active : true
      });
    }
  }, [intent]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.key || !formData.name) {
      alert('Por favor completa la key y el nombre');
      return;
    }

    // Validate key format (lowercase, underscores)
    if (!/^[a-z][a-z0-9_]*$/.test(formData.key)) {
      alert('La key solo puede contener letras minúsculas, números y guiones bajos, y debe comenzar con letra');
      return;
    }

    onSave(formData);
  };

  const addKeyword = () => {
    const keyword = keywordInput.trim().toLowerCase();
    if (keyword && !formData.keywords.includes(keyword)) {
      setFormData(prev => ({
        ...prev,
        keywords: [...prev.keywords, keyword]
      }));
    }
    setKeywordInput('');
  };

  const removeKeyword = (keyword) => {
    setFormData(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keyword)
    }));
  };

  const addPattern = () => {
    const pattern = patternInput.trim();
    if (pattern && !formData.patterns.includes(pattern)) {
      // Validate regex
      try {
        new RegExp(pattern);
        setFormData(prev => ({
          ...prev,
          patterns: [...prev.patterns, pattern]
        }));
        setPatternInput('');
      } catch (e) {
        alert('Patrón regex inválido: ' + e.message);
      }
    }
  };

  const removePattern = (pattern) => {
    setFormData(prev => ({
      ...prev,
      patterns: prev.patterns.filter(p => p !== pattern)
    }));
  };

  const tabs = [
    { id: 'basic', label: 'Básico' },
    { id: 'classification', label: 'Clasificación' },
    { id: 'response', label: 'Respuesta' },
    ...(intent ? [{ id: 'stats', label: 'Estadísticas' }] : [])
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between shrink-0">
          <h3 className="text-xl font-semibold text-white">
            {intent ? 'Editar Intent' : 'Nuevo Intent'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-700 px-6 shrink-0">
          <div className="flex space-x-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {/* Basic Tab */}
            {activeTab === 'basic' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Key */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Key (identificador) *
                    </label>
                    <input
                      type="text"
                      value={formData.key}
                      onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="price_query"
                      disabled={!!intent} // Can't change key of existing intent
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Identificador único (minúsculas y _)</p>
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nombre *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="Consulta de precio"
                      required
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Descripción
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors resize-none"
                    rows="3"
                    placeholder="Describe cuándo se activa este intent (usado por la IA para clasificar)"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Categoría
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500 transition-colors"
                  >
                    {categories.map(cat => (
                      <option key={cat.key} value={cat.key}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Active */}
                <div className="flex items-center space-x-3 p-4 bg-gray-700/30 rounded-lg">
                  <input
                    type="checkbox"
                    id="active"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="w-5 h-5 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
                  />
                  <label htmlFor="active" className="text-sm text-gray-300 cursor-pointer">
                    <span className="font-medium">Intent activo</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Solo los intents activos son usados por el clasificador
                    </p>
                  </label>
                </div>
              </>
            )}

            {/* Classification Tab */}
            {activeTab === 'classification' && (
              <>
                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Prioridad: {formData.priority}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1 (Baja)</span>
                    <span>10 (Alta)</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Mayor prioridad = se considera primero cuando múltiples intents pueden coincidir
                  </p>
                </div>

                {/* Keywords */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Palabras clave
                  </label>
                  <div className="flex space-x-2 mb-2">
                    <input
                      type="text"
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="Escribe una palabra clave y presiona Enter"
                    />
                    <button
                      type="button"
                      onClick={addKeyword}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formData.keywords.map((keyword, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeKeyword(keyword)}
                          className="ml-2 text-blue-400 hover:text-blue-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  {formData.keywords.length === 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Las palabras clave ayudan al clasificador a detectar este intent
                    </p>
                  )}
                </div>

                {/* Patterns (Advanced) */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Patrones Regex (Avanzado)
                  </label>
                  <div className="flex space-x-2 mb-2">
                    <input
                      type="text"
                      value={patternInput}
                      onChange={(e) => setPatternInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addPattern())}
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white font-mono text-sm placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                      placeholder="^hola[!\s]*$"
                    />
                    <button
                      type="button"
                      onClick={addPattern}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formData.patterns.map((pattern, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono"
                      >
                        {pattern}
                        <button
                          type="button"
                          onClick={() => removePattern(pattern)}
                          className="ml-2 text-purple-400 hover:text-purple-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  {formData.patterns.length === 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Patrones regex opcionales para detección rápida sin IA
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Response Tab */}
            {activeTab === 'response' && (
              <>
                {/* Handler Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Tipo de respuesta
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {HANDLER_TYPES.map(handler => (
                      <label
                        key={handler.value}
                        className={`flex items-start space-x-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                          formData.handlerType === handler.value
                            ? 'bg-primary-500/20 border-primary-500 text-white'
                            : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        <input
                          type="radio"
                          name="handlerType"
                          value={handler.value}
                          checked={formData.handlerType === handler.value}
                          onChange={(e) => setFormData({ ...formData, handlerType: e.target.value })}
                          className="mt-1 w-4 h-4 text-primary-600 bg-gray-700 border-gray-600 focus:ring-primary-500 focus:ring-2"
                        />
                        <div>
                          <span className="font-medium">{handler.label}</span>
                          <p className="text-xs text-gray-500 mt-0.5">{handler.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Response Template */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Template de respuesta
                  </label>
                  <textarea
                    value={formData.responseTemplate}
                    onChange={(e) => setFormData({ ...formData, responseTemplate: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors resize-none"
                    rows="4"
                    placeholder="Respuesta predeterminada cuando se detecta este intent (usado por auto_response)"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.handlerType === 'auto_response'
                      ? 'Esta respuesta se enviará automáticamente cuando se detecte el intent'
                      : 'Opcional: puede usarse como contexto para la IA o flujos'}
                  </p>
                </div>
              </>
            )}

            {/* Stats Tab */}
            {activeTab === 'stats' && intent && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                    <div className="text-3xl font-bold text-white">{intent.hitCount || 0}</div>
                    <div className="text-sm text-gray-400 mt-1">Veces detectado</div>
                  </div>
                  <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                    <div className="text-lg font-medium text-white">
                      {intent.lastTriggered
                        ? new Date(intent.lastTriggered).toLocaleString()
                        : 'Nunca'}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">Última detección</div>
                  </div>
                </div>

                <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                  <div className="text-sm text-gray-400 mb-2">Creado</div>
                  <div className="text-white">{new Date(intent.createdAt).toLocaleString()}</div>
                </div>

                <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                  <div className="text-sm text-gray-400 mb-2">Última modificación</div>
                  <div className="text-white">{new Date(intent.updatedAt).toLocaleString()}</div>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-700 bg-gray-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {intent ? 'Guardar Cambios' : 'Crear Intent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default IntentModal;
