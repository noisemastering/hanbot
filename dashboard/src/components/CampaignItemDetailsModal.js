import React from 'react';

function CampaignItemDetailsModal({ item, onClose }) {
  if (!item) return null;

  const itemType = item.type || 'campaign';

  const getTypeLabel = (type) => {
    switch (type) {
      case 'campaign': return 'Campaña';
      case 'adset': return 'Conjunto de Anuncios';
      case 'ad': return 'Anuncio';
      default: return 'Item';
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'bg-green-500/20 text-green-300';
      case 'PAUSED':
        return 'bg-yellow-500/20 text-yellow-300';
      case 'ARCHIVED':
        return 'bg-gray-500/20 text-gray-300';
      case 'DELETED':
        return 'bg-red-500/20 text-red-300';
      default:
        return 'bg-blue-500/20 text-blue-300';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              Detalles de {getTypeLabel(itemType)}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{item.name || 'Sin nombre'}</p>
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Basic Information */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                Información Básica
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Nombre</p>
                  <p className="text-sm text-white mt-1">{item.name || 'N/A'}</p>
                </div>

                {item.ref && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Referencia</p>
                    <p className="text-sm text-white mt-1">
                      <code className="bg-primary-500/10 text-primary-400 px-2 py-1 rounded">{item.ref}</code>
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Estado</p>
                  <p className="text-sm mt-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>
                      {item.status?.toUpperCase() || 'N/A'}
                    </span>
                  </p>
                </div>

                {(item.fbCampaignId || item.fbAdSetId || item.fbAdId) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">ID de Facebook</p>
                    <p className="text-sm text-white mt-1">
                      <code className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded">
                        {item.fbCampaignId || item.fbAdSetId || item.fbAdId}
                      </code>
                    </p>
                  </div>
                )}

                {item._id && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">ID Interno</p>
                    <p className="text-sm text-gray-400 mt-1">
                      <code className="text-xs">{item._id}</code>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Campaign-specific fields */}
            {itemType === 'campaign' && (
              <>
                {item.objective && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Objetivo
                    </h3>
                    <p className="text-sm text-gray-300">{item.objective}</p>
                  </div>
                )}
                {item.description && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Descripción
                    </h3>
                    <p className="text-sm text-gray-300">{item.description}</p>
                  </div>
                )}
              </>
            )}

            {/* AdSet-specific fields */}
            {itemType === 'adset' && (
              <>
                {item.budget && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Presupuesto
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {item.budget.daily && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Diario</p>
                          <p className="text-sm text-white mt-1">${item.budget.daily}</p>
                        </div>
                      )}
                      {item.budget.lifetime && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
                          <p className="text-sm text-white mt-1">${item.budget.lifetime}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {item.targeting && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Segmentación
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {item.targeting.locations && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Ubicaciones</p>
                          <p className="text-sm text-white mt-1">{item.targeting.locations.join(', ')}</p>
                        </div>
                      )}
                      {(item.targeting.ageMin || item.targeting.ageMax) && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Edad</p>
                          <p className="text-sm text-white mt-1">
                            {item.targeting.ageMin || '18'} - {item.targeting.ageMax || '65+'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {item.optimizationGoal && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Optimización
                    </h3>
                    <p className="text-sm text-gray-300">Objetivo: {item.optimizationGoal}</p>
                  </div>
                )}
              </>
            )}

            {/* Ad-specific fields */}
            {itemType === 'ad' && item.creative && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                  Creatividad
                </h3>
                <div className="space-y-3">
                  {item.creative.description && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Descripción</p>
                      <p className="text-sm text-gray-300 mt-1 bg-gray-900/50 p-3 rounded">
                        {item.creative.description}
                      </p>
                    </div>
                  )}
                  {item.creative.callToAction && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Call to Action</p>
                      <p className="text-sm text-white mt-1">{item.creative.callToAction}</p>
                    </div>
                  )}
                  {item.creative.linkUrl && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">URL</p>
                      <a href={item.creative.linkUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 mt-1 block">
                        {item.creative.linkUrl}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Products */}
            {item.productIds && item.productIds.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                  Productos Asociados
                </h3>
                <div className="flex flex-wrap gap-2">
                  {item.productIds.map((product, index) => (
                    <span key={index} className="px-3 py-1 bg-primary-500/20 text-primary-300 rounded-full text-xs">
                      {typeof product === 'object' ? product.name : product}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default CampaignItemDetailsModal;
