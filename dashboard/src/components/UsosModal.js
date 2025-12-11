import React, { useState, useEffect } from 'react';
import api from '../api';

function UsosModal({ uso, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    products: [],
    available: true,
    imageUrl: '',
    priority: 5
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Fetch sellable products
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await api.get('/product-families/sellable');
        setProductFamilies(response.data.data || []);
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoadingProducts(false);
      }
    };
    fetchProducts();
  }, []);

  useEffect(() => {
    if (uso) {
      setFormData({
        name: uso.name || '',
        description: uso.description || '',
        products: uso.products?.map(p => typeof p === 'string' ? p : p._id) || [],
        available: uso.available !== undefined ? uso.available : true,
        imageUrl: uso.imageUrl || '',
        priority: uso.priority || 5
      });
    }
  }, [uso]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleProductToggle = (productId) => {
    setFormData(prev => {
      const currentProducts = prev.products;
      const isSelected = currentProducts.includes(productId);

      return {
        ...prev,
        products: isSelected
          ? currentProducts.filter(id => id !== productId)
          : [...currentProducts, productId]
      };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {uso ? 'Editar Uso' : 'Nuevo Uso'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Información Básica
              </h3>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nombre *
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ej: Protección solar, Agricultura, Construcción"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Descripción
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Descripción del uso o aplicación del producto..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    URL de Imagen
                  </label>
                  <input
                    type="url"
                    name="imageUrl"
                    value={formData.imageUrl}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="https://ejemplo.com/imagen.jpg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Prioridad: {formData.priority}
                  </label>
                  <input
                    type="range"
                    name="priority"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={handleChange}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Baja (1)</span>
                    <span>Alta (10)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  name="available"
                  id="available"
                  checked={formData.available}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-500 bg-gray-900/50 border-gray-700 rounded focus:ring-primary-500"
                />
                <label htmlFor="available" className="text-sm font-medium text-gray-300">
                  Uso disponible
                </label>
              </div>
            </div>

            {/* Products Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Productos Asociados
              </h3>

              {loadingProducts ? (
                <div className="text-center py-8 text-gray-400">
                  Cargando productos...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto p-4 bg-gray-900/30 rounded-lg">
                  {productFamilies.map((product) => (
                    <label
                      key={product._id}
                      className="flex items-start space-x-3 p-3 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-700/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={formData.products.includes(product._id)}
                        onChange={() => handleProductToggle(product._id)}
                        className="mt-1 w-4 h-4 text-primary-500 bg-gray-900/50 border-gray-700 rounded focus:ring-primary-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">{product.name}</div>
                        {product.price && (
                          <div className="text-xs text-gray-400">${product.price}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">
                Selecciona los productos asociados con este uso
              </p>
            </div>
          </div>
        </form>

        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {uso ? 'Actualizar' : 'Crear'} Uso
          </button>
        </div>
      </div>
    </div>
  );
}

export default UsosModal;
