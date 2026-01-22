// components/IntentsView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import IntentModal from './IntentModal';
import IntentCategoryModal from './IntentCategoryModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Handler type labels
const HANDLER_LABELS = {
  auto_response: 'Respuesta automática',
  flow: 'Flujo',
  human_handoff: 'Transferir a humano',
  ai_generate: 'IA genera respuesta'
};

function IntentsView() {
  const [intents, setIntents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingIntent, setEditingIntent] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('intents'); // 'intents' or 'categories'

  useEffect(() => {
    fetchIntents();
    fetchCategories();
  }, []);

  const fetchIntents = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intents`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setIntents(data.data);
      }
    } catch (error) {
      console.error('Error fetching intents:', error);
      toast.error('Error al cargar intents');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intent-categories`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const handleSaveIntent = async (intentData) => {
    try {
      const token = localStorage.getItem('token');
      const url = editingIntent
        ? `${API_URL}/intents/${editingIntent._id}`
        : `${API_URL}/intents`;

      const res = await fetch(url, {
        method: editingIntent ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(intentData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchIntents();
        setShowIntentModal(false);
        setEditingIntent(null);
        toast.success(editingIntent ? 'Intent actualizado correctamente' : 'Intent creado correctamente');
      } else {
        toast.error(data.error || 'Error al guardar intent');
      }
    } catch (error) {
      console.error('Error saving intent:', error);
      toast.error('Error al guardar intent');
    }
  };

  const handleDeleteIntent = async (intentId) => {
    if (!window.confirm('¿Estás seguro de eliminar este intent?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intents/${intentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (data.success) {
        await fetchIntents();
        toast.success('Intent eliminado correctamente');
      } else {
        toast.error(data.error || 'Error al eliminar intent');
      }
    } catch (error) {
      console.error('Error deleting intent:', error);
      toast.error('Error al eliminar intent');
    }
  };

  const handleToggleActive = async (intent) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intents/${intent._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ active: !intent.active })
      });

      const data = await res.json();
      if (data.success) {
        await fetchIntents();
        toast.success(`Intent ${data.data.active ? 'activado' : 'desactivado'}`);
      } else {
        toast.error(data.error || 'Error al cambiar estado');
      }
    } catch (error) {
      console.error('Error toggling intent:', error);
      toast.error('Error al cambiar estado');
    }
  };

  // Category handlers
  const handleSaveCategory = async (categoryData) => {
    try {
      const token = localStorage.getItem('token');
      const url = editingCategory
        ? `${API_URL}/intent-categories/${editingCategory._id}`
        : `${API_URL}/intent-categories`;

      const res = await fetch(url, {
        method: editingCategory ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(categoryData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchCategories();
        setShowCategoryModal(false);
        setEditingCategory(null);
        toast.success(editingCategory ? 'Categoría actualizada' : 'Categoría creada');
      } else {
        toast.error(data.error || 'Error al guardar categoría');
      }
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error('Error al guardar categoría');
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (!window.confirm('¿Estás seguro de eliminar esta categoría?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/intent-categories/${categoryId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (data.success) {
        await fetchCategories();
        toast.success('Categoría eliminada');
      } else {
        toast.error(data.error || 'Error al eliminar categoría');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Error al eliminar categoría');
    }
  };

  // Helper to get category info
  const getCategoryInfo = (key) => {
    return categories.find(c => c.key === key) || { name: key, color: '#6b7280' };
  };

  // Filter intents based on search and filters
  const filteredIntents = intents.filter(intent => {
    const matchesSearch = searchTerm === '' ||
      intent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      intent.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (intent.keywords && intent.keywords.some(k => k.toLowerCase().includes(searchTerm.toLowerCase())));

    const matchesCategory = categoryFilter === 'all' || intent.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && intent.active) ||
      (statusFilter === 'inactive' && !intent.active);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Group intents by category for display
  const intentsByCategory = filteredIntents.reduce((acc, intent) => {
    const cat = intent.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(intent);
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestión de Intents</h2>
          <p className="text-sm text-gray-400 mt-1">Configura las intenciones que el bot puede detectar</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'categories' && (
            <button
              onClick={() => {
                setEditingCategory(null);
                setShowCategoryModal(true);
              }}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Nueva Categoría</span>
            </button>
          )}
          {activeTab === 'intents' && (
            <button
              onClick={() => {
                setEditingIntent(null);
                setShowIntentModal(true);
              }}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Nuevo Intent</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 mb-6">
        <div className="flex space-x-4">
          <button
            onClick={() => setActiveTab('intents')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'intents'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Intents ({intents.length})
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Categorías ({categories.length})
          </button>
        </div>
      </div>

      {activeTab === 'intents' && (
        <>
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por nombre, key o keywords..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                />
              </div>
            </div>

            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
            >
              <option value="all">Todas las categorías</option>
              {categories.map(cat => (
                <option key={cat.key} value={cat.key}>{cat.name}</option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>

          {/* Stats summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
              <div className="text-2xl font-bold text-white">{intents.length}</div>
              <div className="text-sm text-gray-400">Total Intents</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
              <div className="text-2xl font-bold text-green-400">{intents.filter(i => i.active).length}</div>
              <div className="text-sm text-gray-400">Activos</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
              <div className="text-2xl font-bold text-blue-400">{categories.length}</div>
              <div className="text-sm text-gray-400">Categorías</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
              <div className="text-2xl font-bold text-purple-400">
                {intents.reduce((sum, i) => sum + (i.hitCount || 0), 0)}
              </div>
              <div className="text-sm text-gray-400">Hits Totales</div>
            </div>
          </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando intents...</p>
        </div>
      ) : filteredIntents.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="text-6xl mb-4">🧠</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {intents.length === 0 ? 'No hay intents' : 'Sin resultados'}
          </h3>
          <p className="text-gray-400">
            {intents.length === 0
              ? 'Crea el primer intent del sistema'
              : 'Intenta con otros filtros de búsqueda'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(intentsByCategory).map(([category, categoryIntents]) => {
            const catInfo = getCategoryInfo(category);
            return (
            <div key={category}>
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: catInfo.color }}></span>
                <span>{catInfo.name}</span>
                <span className="text-sm font-normal text-gray-500">({categoryIntents.length})</span>
              </h3>
              <div className="grid gap-3">
                {categoryIntents.map((intent) => (
                  <div
                    key={intent._id}
                    className={`bg-gray-800/30 rounded-lg border p-4 transition-colors ${
                      intent.active ? 'border-gray-700/50 hover:border-gray-600/50' : 'border-red-900/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3 mb-2">
                          <h4 className="text-base font-semibold text-white truncate">{intent.name}</h4>
                          <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-0.5 rounded shrink-0">
                            {intent.key}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                            intent.active
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-red-500/20 text-red-300 border border-red-500/30'
                          }`}>
                            {intent.active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>

                        {intent.description && (
                          <p className="text-sm text-gray-400 mb-2 line-clamp-1">{intent.description}</p>
                        )}

                        <div className="flex flex-wrap gap-2 mb-2">
                          {intent.keywords && intent.keywords.slice(0, 5).map((keyword, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            >
                              {keyword}
                            </span>
                          ))}
                          {intent.keywords && intent.keywords.length > 5 && (
                            <span className="text-xs text-gray-500">+{intent.keywords.length - 5} más</span>
                          )}
                        </div>

                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <span>Prioridad: {intent.priority}</span>
                          <span>Handler: {HANDLER_LABELS[intent.handlerType] || intent.handlerType}</span>
                          <span>Hits: {intent.hitCount || 0}</span>
                          {intent.lastTriggered && (
                            <span>Último: {new Date(intent.lastTriggered).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 ml-4 shrink-0">
                        <button
                          onClick={() => handleToggleActive(intent)}
                          className={`p-2 rounded-lg transition-colors ${
                            intent.active
                              ? 'text-yellow-400 hover:bg-yellow-500/20'
                              : 'text-green-400 hover:bg-green-500/20'
                          }`}
                          title={intent.active ? 'Desactivar' : 'Activar'}
                        >
                          {intent.active ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setEditingIntent(intent);
                            setShowIntentModal(true);
                          }}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteIntent(intent._id)}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )})}
        </div>
      )}
        </>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          {categories.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
              <div className="text-6xl mb-4">📁</div>
              <h3 className="text-lg font-semibold text-white mb-2">No hay categorías</h3>
              <p className="text-gray-400">Crea la primera categoría</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {categories.map((category) => {
                const intentCount = intents.filter(i => i.category === category.key).length;
                return (
                  <div
                    key={category._id}
                    className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 hover:border-gray-600/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: category.color }}
                        ></div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-base font-semibold text-white">{category.name}</h4>
                            <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-0.5 rounded">
                              {category.key}
                            </span>
                          </div>
                          {category.description && (
                            <p className="text-sm text-gray-400 mt-1">{category.description}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-1">{intentCount} intents</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            setEditingCategory(category);
                            setShowCategoryModal(true);
                          }}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category._id)}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Intent Modal */}
      {showIntentModal && (
        <IntentModal
          intent={editingIntent}
          categories={categories}
          onClose={() => {
            setShowIntentModal(false);
            setEditingIntent(null);
          }}
          onSave={handleSaveIntent}
        />
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <IntentCategoryModal
          category={editingCategory}
          onClose={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
          }}
          onSave={handleSaveCategory}
        />
      )}
    </div>
  );
}

export default IntentsView;
