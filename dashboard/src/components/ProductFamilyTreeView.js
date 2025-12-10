import React, { useState } from 'react';

// Recursive component to render a single product node and its children
function ProductNode({ product, onEdit, onDelete, onAddChild, onCopy, level = 0, expandedNodes, onToggleExpand }) {
  const isExpanded = expandedNodes.has(product._id);
  const hasChildren = product.children && product.children.length > 0;
  const indentPixels = level * 32; // 32px per level (equivalent to ml-8 = 2rem = 32px)

  return (
    <div className="border-l-2 border-gray-700/50">
      {/* Product Row */}
      <div className="flex items-center justify-between px-6 py-4 hover:bg-gray-700/30 transition-colors" style={{ marginLeft: `${indentPixels}px` }}>
        <div className="flex items-center space-x-4 flex-1">
          {/* Expand/Collapse Button */}
          {hasChildren ? (
            <button
              onClick={() => onToggleExpand(product._id)}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title={isExpanded ? "Contraer" : "Expandir"}
            >
              <svg className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-7"></div>
          )}

          {/* Product Info */}
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h3 className="text-sm font-semibold text-white">{product.name}</h3>

              {/* Generation Badge */}
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs font-medium">
                Gen {product.generation || 1}
              </span>

              {/* Sellable Badge */}
              {product.sellable && (
                <span className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-xs font-medium flex items-center space-x-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Vendible</span>
                  {product.requiresHumanAdvisor && (
                    <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Requiere asesor humano">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </span>
              )}
            </div>

            {/* Description */}
            {product.description && (
              <p className="text-xs text-gray-400 mt-1">{product.description}</p>
            )}

            {/* Additional Info for Sellable Products */}
            {product.sellable && (
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                {product.price && <span>Precio: ${product.price}</span>}
                {product.sku && <span>SKU: {product.sku}</span>}
                {product.stock !== undefined && <span>Inventario: {product.stock}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => !product.sellable && onAddChild(product)}
            disabled={product.sellable}
            className={`p-2 rounded-lg transition-colors ${
              product.sellable
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : 'text-green-400 hover:bg-green-500/20'
            }`}
            title={product.sellable ? "Los productos vendibles no pueden tener hijos" : "Agregar Hijo"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => onCopy(product)}
            className="p-2 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-colors"
            title="Copiar como Hermano"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={() => onEdit(product)}
            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
            title="Editar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(product)}
            className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
            title="Eliminar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Children (Recursively render) */}
      {isExpanded && hasChildren && (
        <div className="ml-6 border-l-2 border-gray-700/30">
          {product.children.map((child) => (
            <ProductNode
              key={child._id}
              product={child}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onCopy={onCopy}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductFamilyTreeView({
  products,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onAddChild,
  onCopy
}) {
  // Manage expanded nodes state (Set of product IDs)
  const [expandedNodes, setExpandedNodes] = useState(() => {
    // Initialize with all root nodes expanded
    const initialExpanded = new Set();
    if (products && products.length > 0) {
      products.forEach(p => initialExpanded.add(p._id));
    }
    return initialExpanded;
  });

  // Update expanded nodes when products change (to include new root nodes)
  React.useEffect(() => {
    if (products && products.length > 0) {
      setExpandedNodes(prev => {
        const newExpanded = new Set(prev);
        products.forEach(p => {
          // Keep root nodes expanded
          if (!prev.has(p._id)) {
            newExpanded.add(p._id);
          }
        });
        return newExpanded;
      });
    }
  }, [products]);

  // Toggle expand/collapse for a node
  const handleToggleExpand = (productId) => {
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(productId)) {
        newExpanded.delete(productId);
      } else {
        newExpanded.add(productId);
      }
      return newExpanded;
    });
  };

  // Wrap onAddChild to auto-expand the parent
  const handleAddChild = (product) => {
    // Expand the parent node
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      newExpanded.add(product._id);
      return newExpanded;
    });

    // Call the original onAddChild
    onAddChild(product);
  };

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Familias de Productos</h1>
          <p className="text-gray-400 mt-2">Gestiona árboles de familias de productos con relaciones padre-hijo generacionales</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nueva Familia de Productos</span>
        </button>
      </div>

      {/* Product Family Tree */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Árbol de Familias de Productos</h2>
          <p className="text-sm text-gray-400 mt-1">
            Vista de árbol expandible mostrando generaciones de productos. Solo los productos vendibles pueden ofrecerse en campañas.
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando familias de productos...</p>
          </div>
        ) : !products || products.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No se encontraron familias de productos</h3>
            <p className="text-gray-400 mb-6">Comienza agregando tu primera familia de productos</p>
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Agregar Familia de Productos</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {products.map((product) => (
              <ProductNode
                key={product._id}
                product={product}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={handleAddChild}
                onCopy={onCopy}
                level={0}
                expandedNodes={expandedNodes}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductFamilyTreeView;
