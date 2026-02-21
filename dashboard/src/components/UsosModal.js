import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
import api from '../api';
import ProductTreeSelector from './ProductTreeSelector';

function UsosModal({ uso, onSave, onClose }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    keywords: '',
    products: [],
    available: true,
    imageUrl: '',
    priority: 5
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

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
    if (uso) {
      setFormData({
        name: uso.name || '',
        description: uso.description || '',
        keywords: uso.keywords?.join(', ') || '',
        products: uso.products?.map(p => typeof p === 'string' ? p : p._id) || [],
        available: uso.available !== undefined ? uso.available : true,
        imageUrl: uso.imageUrl || '',
        priority: uso.priority || 5
      });
    }
  }, [uso]);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Convert keywords string to array
    const dataToSave = {
      ...formData,
      keywords: formData.keywords
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0)
    };
    onSave(dataToSave);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleProductToggle = (productIds, isCurrentlySelected) => {
    // productIds is an array of IDs (parent + all descendants)
    // isCurrentlySelected indicates if the parent is currently selected
    setFormData(prev => {
      const currentProducts = prev.products;

      if (isCurrentlySelected) {
        // Remove all the IDs
        return {
          ...prev,
          products: currentProducts.filter(id => !productIds.includes(id))
        };
      } else {
        // Add all the IDs that aren't already selected
        const newIds = productIds.filter(id => !currentProducts.includes(id));
        return {
          ...prev,
          products: [...currentProducts, ...newIds]
        };
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {uso ? t('usosModal.editTitle') : t('usosModal.newTitle')}
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
                {t('usosModal.basicInfo')}
              </h3>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('usosModal.nameRequired')}
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
                  {t('usosModal.description')}
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('usosModal.descriptionPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('usosModal.keywords')}
                </label>
                <input
                  type="text"
                  name="keywords"
                  value={formData.keywords}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="carro, cochera, estacionamiento, auto"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('usosModal.keywordsHint')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('usosModal.imageUrl')}
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
                    {t('usosModal.priorityLabel', { value: formData.priority })}
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
                    <span>{t('usosModal.priorityLow')}</span>
                    <span>{t('usosModal.priorityHigh')}</span>
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
                  {t('usosModal.available')}
                </label>
              </div>
            </div>

            {/* Products Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white border-b border-gray-700/50 pb-2">
                {t('usosModal.associatedProducts')}
              </h3>

              <ProductTreeSelector
                selectedProducts={formData.products}
                onToggle={handleProductToggle}
                products={productFamilies}
                loading={loadingProducts}
              />

              <p className="text-xs text-gray-500">
                {t('usosModal.productsHint')}
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
            {t('usosModal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {uso ? t('usosModal.updateUso') : t('usosModal.createUso')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UsosModal;
