import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdsView() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState(null);

  useEffect(() => {
    fetchAds();
  }, []);

  const fetchAds = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/ads`);
      const data = await res.json();
      if (data.success) {
        setAds(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching ads:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Anuncios</h1>
        <p className="text-gray-400 mt-2">Gestiona los anuncios individuales de tus ad sets</p>
      </div>

      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Lista de Anuncios</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando anuncios...</p>
          </div>
        ) : ads.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay anuncios</h3>
            <p className="text-gray-400">Los anuncios se crearán automáticamente con las campañas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    FB Ad ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Ad Set / Campaña
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Creative
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Métricas
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {ads.map((ad) => (
                  <tr key={ad._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-white">{ad.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded">
                        {ad.fbAdId}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300">
                      <div>{ad.adSetId?.name || 'N/A'}</div>
                      <div className="text-xs text-gray-500">{ad.adSetId?.campaignId?.name || ''}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300 max-w-xs">
                      <div className="font-medium truncate">{ad.creative?.headline || 'Sin headline'}</div>
                      <div className="text-xs text-gray-500 truncate">{ad.creative?.body || 'Sin body'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        ad.status === 'ACTIVE'
                          ? "bg-green-500/20 text-green-300"
                          : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {ad.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      <div className="flex space-x-3 text-xs">
                        <span title="Impresiones">
                          <span className="text-gray-500">Imp:</span> {ad.metrics?.impressions || 0}
                        </span>
                        <span title="Clicks">
                          <span className="text-gray-500">Clk:</span> {ad.metrics?.clicks || 0}
                        </span>
                        <span title="Conversiones">
                          <span className="text-gray-500">Conv:</span> {ad.metrics?.conversions || 0}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => setSelectedAd(ad)}
                        className="px-3 py-1.5 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/50 rounded-lg transition-colors text-xs font-medium"
                      >
                        Ver Detalles
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedAd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                Detalles del Anuncio
              </h2>
              <button
                onClick={() => setSelectedAd(null)}
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
                      <p className="text-sm text-white mt-1">{selectedAd.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB Ad ID</p>
                      <p className="text-sm text-white mt-1">
                        <code className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded">{selectedAd.fbAdId}</code>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Estado</p>
                      <p className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedAd.status === 'ACTIVE' ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {selectedAd.status}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Ad Set</p>
                      <p className="text-sm text-white mt-1">{selectedAd.adSetId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Campaña</p>
                      <p className="text-sm text-white mt-1">{selectedAd.adSetId?.campaignId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">ID Interno</p>
                      <p className="text-sm text-gray-400 mt-1">
                        <code className="text-xs">{selectedAd._id}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Creative */}
                {selectedAd.creative && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Creatividad
                    </h3>
                    <div className="space-y-4">
                      {selectedAd.creative.headline && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Título</p>
                          <p className="text-base text-white mt-1 font-medium">{selectedAd.creative.headline}</p>
                        </div>
                      )}
                      {selectedAd.creative.body && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Texto Principal</p>
                          <p className="text-sm text-gray-300 mt-1 bg-gray-900/50 p-3 rounded">
                            {selectedAd.creative.body}
                          </p>
                        </div>
                      )}
                      {selectedAd.creative.description && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Descripción</p>
                          <p className="text-sm text-gray-300 mt-1">{selectedAd.creative.description}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        {selectedAd.creative.callToAction && (
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Call to Action</p>
                            <p className="text-sm text-white mt-1">
                              <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded">
                                {selectedAd.creative.callToAction}
                              </span>
                            </p>
                          </div>
                        )}
                        {selectedAd.creative.linkUrl && (
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">URL de Destino</p>
                            <a
                              href={selectedAd.creative.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-400 hover:text-blue-300 mt-1 block truncate"
                            >
                              {selectedAd.creative.linkUrl}
                            </a>
                          </div>
                        )}
                      </div>
                      {selectedAd.creative.imageUrl && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Imagen</p>
                          <div className="mt-2">
                            <img
                              src={selectedAd.creative.imageUrl}
                              alt="Ad creative"
                              className="rounded-lg max-w-full h-auto"
                            />
                          </div>
                        </div>
                      )}
                      {selectedAd.creative.videoUrl && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Video</p>
                          <p className="text-sm text-blue-400 mt-1">{selectedAd.creative.videoUrl}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tracking */}
                {selectedAd.tracking && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Seguimiento
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAd.tracking.utmSource && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">UTM Source</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.utmSource}</code>
                          </p>
                        </div>
                      )}
                      {selectedAd.tracking.utmMedium && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">UTM Medium</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.utmMedium}</code>
                          </p>
                        </div>
                      )}
                      {selectedAd.tracking.utmCampaign && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">UTM Campaign</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.utmCampaign}</code>
                          </p>
                        </div>
                      )}
                      {selectedAd.tracking.utmContent && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">UTM Content</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.utmContent}</code>
                          </p>
                        </div>
                      )}
                      {selectedAd.tracking.utmTerm && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">UTM Term</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.utmTerm}</code>
                          </p>
                        </div>
                      )}
                      {selectedAd.tracking.fbPixelId && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Facebook Pixel ID</p>
                          <p className="text-sm text-white mt-1">
                            <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking.fbPixelId}</code>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {selectedAd.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Métricas
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Impresiones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAd.metrics.impressions || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Clicks</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAd.metrics.clicks || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Conversiones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAd.metrics.conversions || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Gasto</p>
                        <p className="text-2xl font-bold text-white mt-1">${selectedAd.metrics.spend || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Alcance</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAd.metrics.reach || 0}</p>
                      </div>
                      {selectedAd.metrics.ctr !== undefined && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">CTR</p>
                          <p className="text-2xl font-bold text-white mt-1">{selectedAd.metrics.ctr}%</p>
                        </div>
                      )}
                      {selectedAd.metrics.cpc !== undefined && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">CPC</p>
                          <p className="text-2xl font-bold text-white mt-1">${selectedAd.metrics.cpc}</p>
                        </div>
                      )}
                      {selectedAd.metrics.cpm !== undefined && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">CPM</p>
                          <p className="text-2xl font-bold text-white mt-1">${selectedAd.metrics.cpm}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Dates */}
                {(selectedAd.createdAt || selectedAd.updatedAt) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Información de Sistema
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAd.createdAt && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Creado</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAd.createdAt).toLocaleString('es-MX')}
                          </p>
                        </div>
                      )}
                      {selectedAd.updatedAt && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Actualizado</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAd.updatedAt).toLocaleString('es-MX')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
              <button
                onClick={() => setSelectedAd(null)}
                className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdsView;
