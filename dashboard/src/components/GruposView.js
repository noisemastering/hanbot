import React from 'react';
import { useTranslation } from '../i18n';

function GruposView({
  grupos,
  loading,
  onAdd,
  onEdit,
  onDelete
}) {
  const { t } = useTranslation();

  const getTypeLabel = (type) => {
    const labels = {
      bundle: t('grupos.typeBundle'),
      complementary: t('grupos.typeComplementary'),
      alternative: t('grupos.typeAlternative'),
      seasonal: t('grupos.typeSeasonal'),
      custom: t('grupos.typeCustom')
    };
    return labels[type] || type;
  };

  const getTypeBadgeColor = (type) => {
    const colors = {
      bundle: 'bg-purple-500/20 text-purple-300',
      complementary: 'bg-green-500/20 text-green-300',
      alternative: 'bg-yellow-500/20 text-yellow-300',
      seasonal: 'bg-blue-500/20 text-blue-300',
      custom: 'bg-gray-500/20 text-gray-300'
    };
    return colors[type] || colors.custom;
  };

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('usosGrupos.gruposTabLabel')}</h1>
          <p className="text-gray-400 mt-2">{t('grupos.subtitle')}</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t('grupos.newGrupo')}</span>
        </button>
      </div>

      {/* Grupos Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <div className="col-span-full bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">{t('grupos.loadingGrupos')}</p>
          </div>
        ) : grupos.length === 0 ? (
          <div className="col-span-full bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{t('grupos.noGruposRegistered')}</h3>
            <p className="text-gray-400 mb-6">{t('grupos.startAdding')}</p>
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>{t('grupos.addGrupo')}</span>
            </button>
          </div>
        ) : (
          grupos.map((grupo) => (
            <div key={grupo._id} className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden hover:border-primary-500/50 transition-colors">
              {/* Grupo Header */}
              <div className="px-6 py-4 border-b border-gray-700/50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-bold text-white">{grupo.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeBadgeColor(grupo.type)}`}>
                        {getTypeLabel(grupo.type)}
                      </span>
                      {!grupo.available && (
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs font-medium">
                          {t('grupos.inactiveLabel')}
                        </span>
                      )}
                    </div>
                    {grupo.description && (
                      <p className="text-sm text-gray-400">{grupo.description}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Grupo Content */}
              <div className="px-6 py-4">
                {/* Stats */}
                <div className="flex items-center space-x-4 mb-4 text-sm">
                  <div className="flex items-center space-x-2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <span>{t('grupos.productsCount', { count: grupo.productCount || grupo.products?.length || 0 })}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    <span>{t('grupos.priorityLabel', { value: grupo.priority || 5 })}</span>
                  </div>
                  {grupo.discountPercentage > 0 && (
                    <div className="flex items-center space-x-2 text-green-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{t('grupos.discountLabel', { value: grupo.discountPercentage })}</span>
                    </div>
                  )}
                </div>

                {/* Tags */}
                {grupo.tags && grupo.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {grupo.tags.map((tag, index) => (
                      <span key={index} className="px-2 py-1 bg-gray-700/50 text-gray-300 rounded text-xs">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Products List */}
                {grupo.products && grupo.products.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('grupos.productsIncluded')}</p>
                    <div className="space-y-1">
                      {grupo.products.slice(0, 3).map((product) => (
                        <div key={product._id} className="text-sm text-gray-300 flex items-center space-x-2">
                          <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span>{product.name}</span>
                        </div>
                      ))}
                      {grupo.products.length > 3 && (
                        <div className="text-xs text-gray-500">
                          {t('grupos.moreProducts', { count: grupo.products.length - 3 })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="px-6 py-3 border-t border-gray-700/50 flex justify-end space-x-2">
                <button
                  onClick={() => onEdit(grupo)}
                  className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                  title={t('grupos.editTooltip')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => onDelete(grupo)}
                  className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                  title={t('grupos.deleteTooltip')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default GruposView;
