import React, { useState, useEffect } from 'react';
import API from '../api';

function ImportProductsModal({ targetFamily, onClose, onImport }) {
  const [products, setProducts] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      // Fetch products from the flat /products list (same as Products page)
      const response = await API.get('/products');
      if (response.data.success) {
        // Show all products from the flat Productos list
        setProducts(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      alert('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleProduct = (productId) => {
    setSelectedProducts(prev => {
      if (prev.includes(productId)) {
        return prev.filter(id => id !== productId);
      } else {
        return [...prev, productId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedProducts.length === products.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(products.map(p => p._id));
    }
  };

  const handleImport = async () => {
    if (selectedProducts.length === 0) {
      alert('Por favor selecciona al menos un producto');
      return;
    }

    setImporting(true);
    try {
      const response = await API.post(`/product-families/${targetFamily._id}/import`, {
        productIds: selectedProducts
      });

      if (response.data.success) {
        alert(`${response.data.count} productos importados correctamente`);
        onImport();
      }
    } catch (error) {
      console.error('Error importing products:', error);
      alert('Error al importar productos: ' + (error.response?.data?.error || error.message));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              Importar Productos desde Productos
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Selecciona productos huérfanos (sin familia asignada) para importar a "{targetFamily.name}"
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <svg className="animate-spin h-8 w-8 text-primary-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Cargando productos...</span>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              No hay productos disponibles para importar
            </div>
          ) : (
            <div>
              {/* Select All */}
              <div className="mb-4 flex items-center justify-between px-4 py-2 bg-gray-700/30 rounded-lg">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProducts.length === products.length && products.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-primary-500 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
                  />
                  <span className="ml-3 text-sm text-white">Seleccionar todos</span>
                </label>
                <span className="text-sm text-gray-400">
                  {selectedProducts.length} de {products.length} seleccionados
                </span>
              </div>

              {/* Product List */}
              <div className="space-y-2">
                {products.map(product => (
                  <div
                    key={product._id}
                    className="flex items-start gap-3 px-4 py-3 bg-gray-700/20 hover:bg-gray-700/40 rounded-lg cursor-pointer transition-colors"
                    onClick={() => handleToggleProduct(product._id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProducts.includes(product._id)}
                      onChange={() => handleToggleProduct(product._id)}
                      className="w-4 h-4 text-primary-500 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2 mt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-white">{product.name}</h3>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300">
                          Gen {product.generation}
                        </span>
                        {product.sellable && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-300">
                            Vendible
                          </span>
                        )}
                      </div>
                      {product.description && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                      {product.price && (
                        <p className="text-xs text-gray-500 mt-1">
                          Precio: ${product.price}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-between items-center">
          <span className="text-sm text-gray-400">
            {selectedProducts.length} producto{selectedProducts.length !== 1 ? 's' : ''} seleccionado{selectedProducts.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={selectedProducts.length === 0 || importing}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? 'Importando...' : `Importar ${selectedProducts.length} producto${selectedProducts.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImportProductsModal;
