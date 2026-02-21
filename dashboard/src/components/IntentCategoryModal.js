// components/IntentCategoryModal.js
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

function IntentCategoryModal({ category, onClose, onSave }) {
  const { t } = useTranslation();

  const COLOR_OPTIONS = [
    { value: '#10b981', label: t('intentCategoryModal.colorGreen') },
    { value: '#3b82f6', label: t('intentCategoryModal.colorBlue') },
    { value: '#8b5cf6', label: t('intentCategoryModal.colorPurple') },
    { value: '#f59e0b', label: t('intentCategoryModal.colorOrange') },
    { value: '#ef4444', label: t('intentCategoryModal.colorRed') },
    { value: '#6b7280', label: t('intentCategoryModal.colorGray') },
    { value: '#ec4899', label: t('intentCategoryModal.colorPink') },
    { value: '#14b8a6', label: t('intentCategoryModal.colorTeal') }
  ];

  const [formData, setFormData] = useState({
    key: '',
    name: '',
    description: '',
    color: '#6366f1',
    order: 0,
    active: true
  });

  useEffect(() => {
    if (category) {
      setFormData({
        key: category.key || '',
        name: category.name || '',
        description: category.description || '',
        color: category.color || '#6366f1',
        order: category.order || 0,
        active: category.active !== undefined ? category.active : true
      });
    }
  }, [category]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.key || !formData.name) {
      alert(t('intentCategoryModal.alertKeyName'));
      return;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(formData.key)) {
      alert(t('intentCategoryModal.alertKeyFormat'));
      return;
    }

    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-700">
        {/* Header */}
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">
            {category ? t('intentCategoryModal.editTitle') : t('intentCategoryModal.newTitle')}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Key */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('intentCategoryModal.keyRequired')}
              </label>
              <input
                type="text"
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="product"
                disabled={!!category}
                required
              />
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('intentCategoryModal.nameRequired')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="Productos"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('intentCategoryModal.descriptionLabel')}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors resize-none"
              rows="2"
              placeholder={t('intentCategoryModal.descriptionPlaceholder')}
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              {t('intentCategoryModal.color')}
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(color => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  className={`w-10 h-10 rounded-lg border-2 transition-all ${
                    formData.color === color.value
                      ? 'border-white scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Order */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('intentCategoryModal.order')}
            </label>
            <input
              type="number"
              value={formData.order}
              onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
              className="w-24 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500 transition-colors"
              min="0"
            />
            <p className="text-xs text-gray-500 mt-1">{t('intentCategoryModal.orderHint')}</p>
          </div>

          {/* Preview */}
          <div className="p-4 bg-gray-700/30 rounded-lg">
            <p className="text-sm text-gray-400 mb-2">{t('intentCategoryModal.preview')}</p>
            <div className="flex items-center space-x-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: formData.color }}
              ></span>
              <span className="text-white font-medium">{formData.name || 'Nombre'}</span>
              <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-0.5 rounded">
                {formData.key || 'key'}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              {t('intentCategoryModal.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {category ? t('intentCategoryModal.saveChanges') : t('intentCategoryModal.createCategory')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default IntentCategoryModal;
