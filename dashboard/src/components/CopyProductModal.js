import React, { useState } from 'react';

function CopyProductModal({ product, onConfirm, onCancel }) {
  const [selectedChildren, setSelectedChildren] = useState(new Set());

  const hasChildren = product.children && product.children.length > 0;

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

  const handleConfirm = () => {
    onConfirm(Array.from(selectedChildren));
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
