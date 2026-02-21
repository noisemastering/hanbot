import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

function CampaignProductModal({ campaignProduct, campaigns, onSave, onClose }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    campaignRef: '',
    name: '',
    shortName: '',
    shade: '90%',
    color: 'Beige',
    features: [],
    variants: [],
    suggestClosest: true,
    fallbackMessage: '',
    active: true
  });

  const [newFeature, setNewFeature] = useState('');
  const [newVariant, setNewVariant] = useState({
    size: '',
    price: '',
    stock: true,
    source: 'local',
    permalink: '',
    imageUrl: ''
  });

  useEffect(() => {
    if (campaignProduct) {
      setFormData({
        campaignRef: campaignProduct.campaignRef || '',
        name: campaignProduct.name || '',
        shortName: campaignProduct.shortName || '',
        shade: campaignProduct.shade || '90%',
        color: campaignProduct.color || 'Beige',
        features: campaignProduct.features || [],
        variants: campaignProduct.variants || [],
        suggestClosest: campaignProduct.suggestClosest !== undefined ? campaignProduct.suggestClosest : true,
        fallbackMessage: campaignProduct.fallbackMessage || '',
        active: campaignProduct.active !== undefined ? campaignProduct.active : true
      });
    }
  }, [campaignProduct]);

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

  const handleAddFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...formData.features, newFeature.trim()]
      });
      setNewFeature('');
    }
  };

  const handleRemoveFeature = (index) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    });
  };

  const handleAddVariant = () => {
    if (newVariant.size && newVariant.price) {
      setFormData({
        ...formData,
        variants: [...formData.variants, { ...newVariant, price: parseFloat(newVariant.price) }]
      });
      setNewVariant({
        size: '',
        price: '',
        stock: true,
        source: 'local',
        permalink: '',
        imageUrl: ''
      });
    }
  };

  const handleRemoveVariant = (index) => {
    setFormData({
      ...formData,
      variants: formData.variants.filter((_, i) => i !== index)
    });
  };

  const handleVariantChange = (e) => {
    const { name, value, type, checked } = e.target;
    setNewVariant({
      ...newVariant,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {campaignProduct ? t('campaignProductModal.editTitle') : t('campaignProductModal.newTitle')}
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Campaign Reference and Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('campaignProductModal.campaignRef')}
                </label>
                <select
                  name="campaignRef"
                  value={formData.campaignRef}
                  onChange={handleChange}
                  required
                  disabled={!!campaignProduct}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">{t('campaignProductModal.selectCampaign')}</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign._id} value={campaign.ref}>
                      {campaign.name} ({campaign.ref})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{t('campaignProductModal.cantChange')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('campaignProductModal.productName')}
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Malla sombra confeccionada 90% beige"
                />
              </div>
            </div>

            {/* Short Name and Basic Info */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('campaignProductModal.shortName')}
                </label>
                <input
                  type="text"
                  name="shortName"
                  value={formData.shortName}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Malla sombra beige"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('campaignProductModal.shade')}
                </label>
                <input
                  type="text"
                  name="shade"
                  value={formData.shade}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="90%"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('campaignProductModal.color')}
                </label>
                <input
                  type="text"
                  name="color"
                  value={formData.color}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Beige"
                />
              </div>
            </div>

            {/* Features Section */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('campaignProductModal.features')}
              </label>
              <div className="flex space-x-2 mb-3">
                <input
                  type="text"
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())}
                  className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ej: Refuerzos en esquinas"
                />
                <button
                  type="button"
                  onClick={handleAddFeature}
                  className="px-4 py-2 bg-primary-500/20 text-primary-300 border border-primary-500/50 rounded-lg hover:bg-primary-500/30 transition-colors"
                >
                  {t('campaignProductModal.addFeature')}
                </button>
              </div>
              <div className="space-y-2">
                {formData.features.map((feature, index) => (
                  <div key={index} className="flex items-center justify-between px-3 py-2 bg-gray-900/50 rounded-lg">
                    <span className="text-sm text-gray-300">{feature}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFeature(index)}
                      className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Variants Section */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('campaignProductModal.variants')}
              </label>
              <div className="bg-gray-900/30 border border-gray-700/50 rounded-lg p-4 mb-3">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <input
                      type="text"
                      name="size"
                      value={newVariant.size}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('campaignProductModal.sizePlaceholder')}
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      name="price"
                      value={newVariant.price}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('campaignProductModal.pricePlaceholder')}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <select
                      name="source"
                      value={newVariant.source}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="local">{t('campaignProductModal.sourceLocal')}</option>
                      <option value="mercadolibre">{t('campaignProductModal.sourceML')}</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="url"
                      name="permalink"
                      value={newVariant.permalink}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('campaignProductModal.linkPlaceholder')}
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-3 mb-3">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="stock"
                      checked={newVariant.stock}
                      onChange={handleVariantChange}
                      className="w-4 h-4 rounded bg-gray-900/50 border-gray-700 text-primary-500 focus:ring-2 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-300">{t('campaignProductModal.inStock')}</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleAddVariant}
                  className="w-full px-4 py-2 bg-primary-500/20 text-primary-300 border border-primary-500/50 rounded-lg hover:bg-primary-500/30 transition-colors text-sm"
                >
                  {t('campaignProductModal.addVariant')}
                </button>
              </div>
              <div className="space-y-2">
                {formData.variants.map((variant, index) => (
                  <div key={index} className="flex items-center justify-between px-3 py-3 bg-gray-900/50 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <span className="text-sm font-medium text-white">{variant.size}</span>
                        <span className="text-sm text-primary-400">${variant.price}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          variant.stock ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                        }`}>
                          {variant.stock ? t('campaignProductModal.inStock') : t('campaignProductModal.outOfStock')}
                        </span>
                        <span className="text-xs text-gray-500">{variant.source}</span>
                      </div>
                      {variant.permalink && (
                        <div className="text-xs text-gray-400 truncate mt-1">{variant.permalink}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveVariant(index)}
                      className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Fallback Message */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('campaignProductModal.fallbackMessage')}
              </label>
              <textarea
                name="fallbackMessage"
                value={formData.fallbackMessage}
                onChange={handleChange}
                rows={2}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Mensaje cuando no hay respuesta específica..."
              />
            </div>

            {/* Options */}
            <div className="flex items-center space-x-6">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="suggestClosest"
                  checked={formData.suggestClosest}
                  onChange={handleChange}
                  className="w-5 h-5 rounded bg-gray-900/50 border-gray-700 text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-300">{t('campaignProductModal.suggestClosest')}</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="active"
                  checked={formData.active}
                  onChange={handleChange}
                  className="w-5 h-5 rounded bg-gray-900/50 border-gray-700 text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-300">{t('campaignProductModal.active')}</span>
              </label>
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
          >
            {t('campaignProductModal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {campaignProduct ? t('campaignProductModal.updateProduct') : t('campaignProductModal.createProduct')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CampaignProductModal;
