import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Table component for sellable products
function SellableProductsTable({ product, parentChain, selectedItems, setSelectedItems, onUpdateProduct }) {
  const [bulkOperation, setBulkOperation] = useState('');
  const [bulkValue, setBulkValue] = useState('');

  const tableKey = product._id;
  const selected = selectedItems[tableKey] || new Set();
  const allSelected = product.children.every(child => selected.has(child._id));

  const toggleSelectAll = () => {
    setSelectedItems(prev => {
      const newSelected = { ...prev };
      if (allSelected) {
        newSelected[tableKey] = new Set();
      } else {
        newSelected[tableKey] = new Set(product.children.map(child => child._id));
      }
      return newSelected;
    });
  };

  const toggleSelect = (childId) => {
    setSelectedItems(prev => {
      const newSelected = { ...prev };
      const tableSelected = new Set(prev[tableKey] || []);
      if (tableSelected.has(childId)) {
        tableSelected.delete(childId);
      } else {
        tableSelected.add(childId);
      }
      newSelected[tableKey] = tableSelected;
      return newSelected;
    });
  };

  const handleBulkUpdate = async () => {
    const selectedIds = Array.from(selected);
    if (selectedIds.length === 0) {
      alert('Por favor selecciona al menos un producto');
      return;
    }

    if (!bulkOperation) {
      alert('Por favor selecciona una operación');
      return;
    }

    let updateData = {};
    if (bulkOperation === 'precio') {
      if (!bulkValue) {
        alert('Por favor ingresa un precio');
        return;
      }
      updateData = { price: parseFloat(bulkValue) };
    } else if (bulkOperation === 'stock') {
      if (!bulkValue) {
        alert('Por favor ingresa un stock');
        return;
      }
      updateData = { stock: parseInt(bulkValue) };
    } else if (bulkOperation === 'inactivo') {
      updateData = { available: false };
    }

    try {
      await Promise.all(
        selectedIds.map(id =>
          fetch(`${API_URL}/product-families/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          })
        )
      );
      window.location.reload();
    } catch (error) {
      console.error('Error in bulk update:', error);
      alert('Error al actualizar productos');
    }
  };

  return (
    <div className="p-4 bg-gray-900/30">
      {/* Bulk Edit Controls */}
      {selected.size > 0 && (
        <div className="mb-4 p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-primary-300 font-medium">
              {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
            </span>
            <select
              value={bulkOperation}
              onChange={(e) => {
                setBulkOperation(e.target.value);
                setBulkValue('');
              }}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
            >
              <option value="">Seleccionar operación...</option>
              <option value="precio">Actualizar Precio</option>
              <option value="stock">Actualizar Stock</option>
              <option value="inactivo">Inactivo</option>
            </select>

            {bulkOperation === 'precio' && (
              <input
                type="number"
                step="0.01"
                placeholder="Nuevo precio"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm w-32"
              />
            )}

            {bulkOperation === 'stock' && (
              <input
                type="number"
                placeholder="Nuevo stock"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm w-24"
              />
            )}

            {bulkOperation && (
              <button
                onClick={handleBulkUpdate}
                className="px-4 py-2 bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors text-sm font-medium"
              >
                Aplicar
              </button>
            )}
          </div>
        </div>
      )}

      <table className="w-full">
        <thead className="bg-gray-900/50 border-b border-gray-700/50">
          <tr>
            <th className="px-4 py-3 text-left w-12">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded border-gray-600 text-primary-500 focus:ring-primary-500 focus:ring-offset-gray-900"
              />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              Producto
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              SKU
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              Stock
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              Precio Menudeo
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              Precio Mayoreo
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
              Activo
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700/50">
          {product.children.map((child) => {
            const getChildInheritedPrice = () => {
              if (child.price !== undefined && child.price !== null) {
                return child.price;
              }
              const fullChain = [...parentChain, product];
              for (let i = fullChain.length - 1; i >= 0; i--) {
                if (fullChain[i].price !== undefined && fullChain[i].price !== null) {
                  return fullChain[i].price;
                }
              }
              return null;
            };
            const childInheritedPrice = getChildInheritedPrice();
            const priceIsInherited = child.price === undefined || child.price === null;

            return (
              <tr key={child._id} className="hover:bg-gray-700/30 transition-colors">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(child._id)}
                    onChange={() => toggleSelect(child._id)}
                    className="rounded border-gray-600 text-primary-500 focus:ring-primary-500 focus:ring-offset-gray-900"
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-white">{child.name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-400 font-mono">{child.sku || '-'}</span>
                </td>
                <td className="px-4 py-3">
                  <EditableField
                    label=""
                    value={child.stock || 0}
                    onSave={(value) => onUpdateProduct(child._id, 'stock', parseInt(value))}
                    type="number"
                  />
                </td>
                <td className="px-4 py-3">
                  <EditableField
                    label=""
                    value={childInheritedPrice || 0}
                    onSave={(value) => onUpdateProduct(child._id, 'price', parseFloat(value))}
                    type="number"
                    step="0.01"
                    inherited={priceIsInherited}
                  />
                </td>
                <td className="px-4 py-3">
                  <EditableField
                    label=""
                    value={child.wholesalePrice || 0}
                    onSave={(value) => onUpdateProduct(child._id, 'wholesalePrice', parseFloat(value))}
                    type="number"
                    step="0.01"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onUpdateProduct(child._id, 'active', !(child.active ?? true))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        (child.active ?? true) ? 'bg-green-500' : 'bg-gray-600'
                      }`}
                      title={(child.active ?? true) ? 'Activo - Click para desactivar' : 'Inactivo - Click para activar'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          (child.active ?? true) ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className={`text-xs font-medium ${
                      (child.active ?? true) ? 'text-green-300' : 'text-gray-400'
                    }`}>
                      {(child.active ?? true) ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Recursive component for rendering product hierarchy with collapsible panels
function ProductPanel({ product, level = 0, expandedIds, onToggle, onUpdateProduct, parentChain = [], selectedItems, setSelectedItems }) {
  const isExpanded = expandedIds.has(product._id);
  const hasChildren = product.children && product.children.length > 0;
  const indentPixels = level * 32; // 32px per level

  // Get inherited price from parent chain
  const getInheritedPrice = () => {
    if (product.price !== undefined && product.price !== null) {
      return product.price;
    }
    for (let i = parentChain.length - 1; i >= 0; i--) {
      if (parentChain[i].price !== undefined && parentChain[i].price !== null) {
        return parentChain[i].price;
      }
    }
    return null;
  };

  const inheritedPrice = getInheritedPrice();

  return (
    <div style={{ marginLeft: `${indentPixels}px` }}>
      {/* Panel Header */}
      <div
        className={`flex items-center justify-between p-4 border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
          level === 0 ? 'bg-gray-800/80' : level === 1 ? 'bg-gray-800/60' : 'bg-gray-800/40'
        }`}
      >
        <div className="flex items-center space-x-3 flex-1">
          {/* Expand/Collapse Button */}
          {hasChildren ? (
            <button
              onClick={() => onToggle(product._id)}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-7"></div>
          )}

          {/* Product Name */}
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-white font-semibold">{product.name}</h3>
              {product.sellable && (
                <span className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-xs">
                  Vendible
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sellable Product Edit Fields */}
      {product.sellable && (
        <div className="p-4 bg-gray-900/50 border-b border-gray-700/50">
          <div className="grid grid-cols-4 gap-4">
            <EditableField
              label="SKU"
              value={product.sku || ''}
              disabled={true}
              type="text"
            />
            <EditableField
              label="Stock"
              value={product.stock}
              onSave={(value) => onUpdateProduct(product._id, 'stock', parseInt(value))}
              type="number"
            />
            <EditableField
              label="Precio Menudeo"
              value={inheritedPrice || 0}
              onSave={(value) => onUpdateProduct(product._id, 'price', parseFloat(value))}
              type="number"
              step="0.01"
              inherited={product.price === undefined || product.price === null}
            />
            <EditableField
              label="Precio Mayoreo"
              value={product.wholesalePrice || 0}
              onSave={(value) => onUpdateProduct(product._id, 'wholesalePrice', parseFloat(value))}
              type="number"
              step="0.01"
            />
          </div>
        </div>
      )}

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {/* Check if all children are sellable - if so, render as table */}
          {product.children.every(child => child.sellable) ? (
            <SellableProductsTable
              product={product}
              parentChain={[...parentChain, product]}
              selectedItems={selectedItems}
              setSelectedItems={setSelectedItems}
              onUpdateProduct={onUpdateProduct}
            />
          ) : (
            // Otherwise render as recursive panels
            <>
              {product.children.map((child) => (
                <ProductPanel
                  key={child._id}
                  product={child}
                  level={level + 1}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                  onUpdateProduct={onUpdateProduct}
                  parentChain={[...parentChain, product]}
                  selectedItems={selectedItems}
                  setSelectedItems={setSelectedItems}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Editable field component
function EditableField({ label, value, onSave, type = "text", step, disabled = false, inherited = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = () => {
    if (onSave && editValue !== value) {
      onSave(editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (disabled) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
        <div className="text-sm text-gray-500 font-mono">{value || '-'}</div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">
        {label}
        {inherited && <span className="ml-1 text-amber-400">(heredado)</span>}
      </label>
      {isEditing ? (
        <input
          type={type}
          step={step}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          autoFocus
          className="w-full px-2 py-1 bg-gray-900 border border-primary-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      ) : (
        <button
          onClick={() => setIsEditing(true)}
          className="w-full text-left px-2 py-1 hover:bg-gray-700/50 rounded transition-colors text-sm"
        >
          <span className={`${inherited ? 'text-amber-400' : 'text-white'}`}>
            {type === 'number' && step === '0.01' ? `$${parseFloat(value || 0).toFixed(2)}` : value || 0}
          </span>
        </button>
      )}
    </div>
  );
}

function InventarioView() {
  const [productTree, setProductTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState({}); // { parentProductId: Set of selected child IDs }

  const fetchProductTree = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        setProductTree(data.data);
      }
    } catch (error) {
      console.error('Error fetching product tree:', error);
      alert('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProductTree();
  }, []);

  const handleToggle = (productId) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const handleUpdateProduct = async (productId, field, value) => {
    try {
      const res = await fetch(`${API_URL}/product-families/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });

      const data = await res.json();

      if (data.success) {
        // Refresh the tree to get updated data
        fetchProductTree();
      } else {
        alert('Error al actualizar: ' + data.error);
      }
    } catch (error) {
      console.error('Error updating product:', error);
      alert('Error al actualizar producto');
    }
  };

  const expandAll = () => {
    const allIds = new Set();
    const collectIds = (products) => {
      products.forEach(product => {
        if (product.children && product.children.length > 0) {
          allIds.add(product._id);
          collectIds(product.children);
        }
      });
    };
    collectIds(productTree);
    setExpandedIds(allIds);
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Inventario</h1>
          <p className="text-gray-400 mt-2">
            Gestiona el inventario y precios de productos. Haz clic para expandir/contraer categorías.
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={expandAll}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Expandir Todo
          </button>
          <button
            onClick={collapseAll}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Contraer Todo
          </button>
        </div>
      </div>

      {/* Product Tree */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando inventario...</p>
          </div>
        ) : productTree.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay productos</h3>
            <p className="text-gray-400">Agrega productos desde el catálogo</p>
          </div>
        ) : (
          <div>
            {productTree.map((product) => (
              <ProductPanel
                key={product._id}
                product={product}
                level={0}
                expandedIds={expandedIds}
                onToggle={handleToggle}
                onUpdateProduct={handleUpdateProduct}
                selectedItems={selectedItems}
                setSelectedItems={setSelectedItems}
              />
            ))}
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <div className="flex items-start space-x-3">
          <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-blue-300 font-medium">Edición rápida</p>
            <p className="text-xs text-blue-200/80 mt-1">
              Haz clic en los campos de Stock o Precio para editarlos. Presiona Enter para guardar o Escape para cancelar. Los precios heredados se muestran en amarillo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InventarioView;
