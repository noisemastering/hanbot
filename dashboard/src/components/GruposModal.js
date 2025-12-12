import React, { useState, useEffect } from 'react';
import api from '../api';
import ProductTreeSelector from './ProductTreeSelector';

function GruposModal({ grupo, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    products: [],
    suggestedProducts: [],
    type: 'custom',
    priority: 5,
    available: true,
    imageUrl: '',
    tags: [],
    discountPercentage: 0
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [tagInput, setTagInput] = useState('');

  // Fetch product tree
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await api.get('/product-families/tree');
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
    if (grupo) {
      setFormData({
        name: grupo.name || '',
        description: grupo.description || '',
        products: grupo.products?.map(p => typeof p === 'string' ? p : p._id) || [],
        suggestedProducts: grupo.suggestedProducts?.map(p => typeof p === 'string' ? p : p._id) || [],
        type: grupo.type || 'custom',
        priority: grupo.priority || 5,
        available: grupo.available !== undefined ? grupo.available : true,
        imageUrl: grupo.imageUrl || '',
        tags: grupo.tags || [],
        discountPercentage: grupo.discountPercentage || 0
      });
    }
  }, [grupo]);

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

  const handleProductToggle = (productIds, isCurrentlySelected, field) => {
    // productIds is an array of IDs (parent + all descendants)
    // isCurrentlySelected indicates if the parent is currently selected
    setFormData(prev => {
      const currentProducts = prev[field];

      if (isCurrentlySelected) {
        // Remove all the IDs
        return {
          ...prev,
          [field]: currentProducts.filter(id => !productIds.includes(id))
        };
      } else {
        // Add all the IDs that aren't already selected
        const newIds = productIds.filter(id => !currentProducts.includes(id));
        return {
          ...prev,
          [field]: [...currentProducts, ...newIds]
        };
      }
    });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !formData.tags.includes(tag)) {
      setFormData({
        ...formData,
        tags: [...formData.tags, tag]
      });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter(tag => tag !== tagToRemove)
    });
  };

  const typeOptions = [
    { value: 'bundle', label: 'Paquete', description: 'Productos que van bien juntos' },
    { value: 'complementary', label: 'Complementario', description: 'Productos que se complementan' },
    { value: 'alternative', label: 'Alternativo', description: 'Alternativas para el mismo caso de uso' },
    { value: 'seasonal', label: 'Estacional', description: 'Agrupaciones estacionales' },
    { value: 'custom', label: 'Personalizado', description: 'Agrupación personalizada' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {grupo ? 'Editar Grupo' : 'Nuevo Grupo'}
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
            {/* Basic Info Section */}
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
                  placeholder="Ej: Kit de Protección Solar Completo"
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
                  placeholder="Descripción del grupo de productos..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tipo de Grupo *
                  </label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {typeOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {typeOptions.find(o => o.value === formData.type)?.description}
                  </p>
                </div>

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
              </div>
            </div>

            {/* Priority and Discount Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Prioridad y Descuentos
              </h3>

              <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Descuento (%)
                  </label>
                  <input
                    type="number"
                    name="discountPercentage"
                    min="0"
                    max="100"
                    value={formData.discountPercentage}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Descuento al comprar productos del grupo
                  </p>
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
                  Grupo disponible
                </label>
              </div>
            </div>

            {/* Tags Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Etiquetas
              </h3>

              <div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                    className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Agregar etiqueta..."
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    Agregar
                  </button>
                </div>

                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {formData.tags.map((tag, index) => (
                      <span key={index} className="px-3 py-1 bg-primary-500/20 text-primary-300 rounded-full text-sm flex items-center space-x-2">
                        <span>#{tag}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-primary-100"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Products Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Productos del Grupo
              </h3>

              <ProductTreeSelector
                selectedProducts={formData.products}
                onToggle={(productIds, isSelected) => handleProductToggle(productIds, isSelected, 'products')}
                products={productFamilies}
                loading={loadingProducts}
              />

              <p className="text-xs text-gray-500">
                Selecciona los productos que pertenecen a este grupo. Puedes expandir las categorías para ver productos específicos.
              </p>
            </div>

            {/* Suggested Products Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                Productos Sugeridos (Opcional)
              </h3>

              <ProductTreeSelector
                selectedProducts={formData.suggestedProducts}
                onToggle={(productIds, isSelected) => handleProductToggle(productIds, isSelected, 'suggestedProducts')}
                products={productFamilies}
                loading={loadingProducts}
              />

              <p className="text-xs text-gray-500">
                Productos recomendados cuando se muestra este grupo. Puedes expandir las categorías para ver productos específicos.
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
            {grupo ? 'Actualizar' : 'Crear'} Grupo
          </button>
        </div>
      </div>
    </div>
  );
}

export default GruposModal;
