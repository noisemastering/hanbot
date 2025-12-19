import React, { useState, useEffect } from 'react';
import API from '../api';

// Recursive component to render parent selection tree
function ParentTreeNode({ node, selectedParentId, onSelectParent, expandedNodes, onToggleExpand, level = 0 }) {
  const isExpanded = expandedNodes.has(node._id);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedParentId === node._id;
  const isSellable = node.sellable;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded cursor-pointer transition-colors ${
          isSelected ? 'bg-primary-500/20 border border-primary-500/50' : 'hover:bg-gray-700/30'
        } ${isSellable ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ marginLeft: `${level * 24}px` }}
        onClick={() => !isSellable && onSelectParent(node._id)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node._id);
            }}
            className="p-0.5 hover:bg-gray-600/50 rounded"
          >
            <svg
              className={`w-4 h-4 text-gray-400 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        {!hasChildren && <div className="w-5" />}

        <input
          type="radio"
          checked={isSelected}
          onChange={() => !isSellable && onSelectParent(node._id)}
          disabled={isSellable}
          className="w-4 h-4 text-primary-500"
          onClick={(e) => e.stopPropagation()}
        />

        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm text-white">{node.name}</span>
          <span className="text-xs text-gray-500">Gen {node.generation}</span>
          {isSellable && (
            <span className="text-xs text-gray-500">(No puede tener hijos)</span>
          )}
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <ParentTreeNode
              key={child._id}
              node={child}
              selectedParentId={selectedParentId}
              onSelectParent={onSelectParent}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CopyProductModal({ product, onConfirm, onCancel }) {
  const [selectedChildren, setSelectedChildren] = useState(new Set());
  const [selectedParentId, setSelectedParentId] = useState(product.parentId || '');
  const [availableParents, setAvailableParents] = useState([]);
  const [loadingParents, setLoadingParents] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  const hasChildren = product.children && product.children.length > 0;

  useEffect(() => {
    fetchAvailableParents();
  }, []);

  const fetchAvailableParents = async () => {
    setLoadingParents(true);
    try {
      // Fetch tree structure
      const response = await API.get('/product-families/tree');
      if (response.data.success) {
        setAvailableParents(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching available parents:', error);
      alert('Error al cargar familias disponibles');
    } finally {
      setLoadingParents(false);
    }
  };

  const handleToggleChild = (childId) => {
    setSelectedChildren(prev => {
      const newSet = new Set(prev);
      if (newSet.has(childId)) {
        newSet.delete(childId);
      } else {
        newSet.add(childId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allIds = new Set(product.children.map(c => c._id));
    setSelectedChildren(allIds);
  };

  const handleSelectNone = () => {
    setSelectedChildren(new Set());
  };

  const handleToggleExpand = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleSelectParent = (parentId) => {
    setSelectedParentId(parentId);
  };

  const handleConfirm = () => {
    if (!selectedParentId) {
      alert('Por favor selecciona un padre para el producto copiado');
      return;
    }
    onConfirm(Array.from(selectedChildren), selectedParentId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Copiar Producto</h2>
          <p className="text-sm text-gray-400 mt-1">
            Selecciona qué hijos deseas copiar junto con "{product.name}"
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Parent Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Selecciona el Padre del Producto Copiado
            </label>
            {loadingParents ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Cargando familias...
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-gray-700 rounded-lg bg-gray-800/50 p-2">
                {availableParents.length === 0 ? (
                  <div className="text-center text-gray-400 py-4">
                    No hay familias disponibles
                  </div>
                ) : (
                  availableParents.map((parent) => (
                    <ParentTreeNode
                      key={parent._id}
                      node={parent}
                      selectedParentId={selectedParentId}
                      onSelectParent={handleSelectParent}
                      expandedNodes={expandedNodes}
                      onToggleExpand={handleToggleExpand}
                      level={0}
                    />
                  ))
                )}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Click en una familia para seleccionarla como padre del producto copiado. Los productos vendibles no pueden tener hijos.
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700 mb-6"></div>

          {!hasChildren ? (
            <div className="text-center py-8">
              <p className="text-gray-400">
                Este producto no tiene hijos. Se copiará solo el producto.
              </p>
            </div>
          ) : (
            <div>
              {/* Select All/None Buttons */}
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-gray-400">
                  {selectedChildren.size} de {product.children.length} seleccionados
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handleSelectAll}
                    className="px-3 py-1 text-xs bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 transition-colors"
                  >
                    Seleccionar Todos
                  </button>
                  <button
                    onClick={handleSelectNone}
                    className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors"
                  >
                    Deseleccionar Todos
                  </button>
                </div>
              </div>

              {/* Children List */}
              <div className="space-y-2">
                {product.children.map((child) => (
                  <label
                    key={child._id}
                    className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedChildren.has(child._id)
                        ? 'bg-primary-500/10 border-primary-500/50'
                        : 'bg-gray-700/30 border-gray-700 hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChildren.has(child._id)}
                      onChange={() => handleToggleChild(child._id)}
                      className="w-4 h-4 text-primary-500 rounded focus:ring-primary-500 focus:ring-offset-gray-800"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-white">{child.name}</span>
                        {child.sellable && (
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-xs">
                            Vendible
                          </span>
                        )}
                      </div>
                      {child.description && (
                        <p className="text-xs text-gray-400 mt-1">{child.description}</p>
                      )}
                      {child.children && child.children.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          📦 {child.children.length} hijo(s) - se copiarán también
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            Copiar {!hasChildren ? 'Producto' : selectedChildren.size > 0 ? `con ${selectedChildren.size} hijo(s)` : 'Solo Producto'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CopyProductModal;
