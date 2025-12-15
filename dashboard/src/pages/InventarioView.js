import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function InventarioView() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState(null); // { productId, field }
  const [editValue, setEditValue] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null); // Currently selected Gen 1 tab

  const fetchSellableProducts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/product-families/sellable`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data);
      }
    } catch (error) {
      console.error('Error fetching sellable products:', error);
      alert('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSellableProducts();
  }, []);

  // Auto-select first category when products load
  useEffect(() => {
    if (products.length > 0 && !selectedCategory) {
      const categories = getUniqueCategories();
      if (categories.length > 0) {
        setSelectedCategory(categories[0]);
      }
    }
  }, [products]);

  // Get unique Gen 1 categories
  const getUniqueCategories = () => {
    const categories = [...new Set(products.map(p => p.category).filter(c => c !== null && c !== undefined))];
    return categories.sort();
  };

  // Filter products by selected category
  const filteredProducts = selectedCategory
    ? products.filter(p => p.category === selectedCategory)
    : products;

  const handleCellClick = (productId, field, currentValue) => {
    setEditingCell({ productId, field });
    setEditValue(currentValue || '');
  };

  const handleSave = async (productId) => {
    if (!editingCell) return;

    try {
      const field = editingCell.field;
      const value = field === 'stock' ? parseInt(editValue, 10) : parseFloat(editValue);

      if (isNaN(value)) {
        alert('Por favor ingresa un valor numérico válido');
        return;
      }

      const res = await fetch(`${API_URL}/product-families/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });

      const data = await res.json();

      if (data.success) {
        // Update local state
        setProducts(prevProducts =>
          prevProducts.map(p =>
            p._id === productId ? { ...p, [field]: value } : p
          )
        );
        setEditingCell(null);
        setEditValue('');
      } else {
        alert('Error al actualizar: ' + data.error);
      }
    } catch (error) {
      console.error('Error updating product:', error);
      alert('Error al actualizar producto');
    }
  };

  const handleKeyDown = (e, productId) => {
    if (e.key === 'Enter') {
      handleSave(productId);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    }
  };

  const handleBlur = (productId) => {
    // Small delay to allow click events on buttons to fire first
    setTimeout(() => {
      if (editingCell) {
        handleSave(productId);
      }
    }, 200);
  };

  const renderEditableCell = (product, field, label) => {
    const isEditing = editingCell?.productId === product._id && editingCell?.field === field;
    const value = product[field];

    if (isEditing) {
      return (
        <input
          type="number"
          step={field === 'stock' ? '1' : '0.01'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, product._id)}
          onBlur={() => handleBlur(product._id)}
          autoFocus
          className="w-full px-2 py-1 bg-gray-900 border border-primary-500 rounded text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    }

    return (
      <button
        onClick={() => handleCellClick(product._id, field, value)}
        className="w-full text-left px-2 py-1 hover:bg-gray-700/50 rounded transition-colors group"
      >
        <span className="group-hover:text-primary-400 transition-colors">
          {field === 'stock' ? value || 0 : value ? `$${value.toFixed(2)}` : '-'}
        </span>
      </button>
    );
  };

  const categories = getUniqueCategories();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Inventario</h1>
        <p className="text-gray-400 mt-2">
          Gestiona el inventario y precios de productos vendibles. Haz clic en cualquier celda para editar.
        </p>
      </div>

      {/* Category Tabs */}
      {!loading && categories.length > 0 && (
        <div className="mb-6 border-b border-gray-700/50">
          <div className="flex space-x-1 overflow-x-auto">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors ${
                  selectedCategory === category
                    ? 'text-primary-400 border-b-2 border-primary-400 bg-gray-800/50'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Products Table */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">
            {selectedCategory || 'Productos Vendibles'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {filteredProducts.length} producto{filteredProducts.length !== 1 ? 's' : ''} en esta categoría
          </p>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando inventario...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay productos en esta categoría</h3>
            <p className="text-gray-400">Selecciona otra categoría o agrega productos vendibles</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50 border-b border-gray-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Producto
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Stock
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Precio Menudeo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Precio Mayoreo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {filteredProducts.map((product) => (
                  <tr
                    key={product._id}
                    className="hover:bg-gray-700/30 transition-colors"
                  >
                    {/* Product Name */}
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div>
                          <div className="text-sm font-medium text-white">{product.displayName || product.name}</div>
                          <div className="text-xs text-gray-400">
                            {product.category && product.subcategory && (
                              <span>{product.category} / {product.subcategory}</span>
                            )}
                            {!product.category && !product.subcategory && (
                              <span>Gen {product.generation}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* SKU */}
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-300 font-mono">{product.sku || '-'}</div>
                    </td>

                    {/* Stock - Editable */}
                    <td className="px-6 py-4">
                      {renderEditableCell(product, 'stock', 'Stock')}
                    </td>

                    {/* Retail Price - Editable */}
                    <td className="px-6 py-4">
                      {renderEditableCell(product, 'price', 'Precio Menudeo')}
                    </td>

                    {/* Wholesale Price - Editable */}
                    <td className="px-6 py-4">
                      {renderEditableCell(product, 'wholesalePrice', 'Precio Mayoreo')}
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col space-y-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          product.available
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}>
                          {product.available ? 'Disponible' : 'No Disponible'}
                        </span>
                        {product.active && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300">
                            Activo
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              Haz clic en cualquier celda de Stock o Precio para editarla. Presiona Enter para guardar o Escape para cancelar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InventarioView;
