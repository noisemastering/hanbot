import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import AdModal from './AdModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const STATUS_STYLE = {
  ACTIVE: "bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/20",
  PAUSED: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20",
  ARCHIVED: "bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-gray-500/20"
};

function AdsView() {
  const [ads, setAds] = useState([]);
  const [adSets, setAdSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState(null);
  const [showAdModal, setShowAdModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [expandedSets, setExpandedSets] = useState(new Set());

  useEffect(() => {
    fetchAds();
    fetchAdSets();
  }, []);

  // Auto-expand all ad sets on first load
  useEffect(() => {
    if (ads.length > 0 && expandedSets.size === 0) {
      const allSetIds = new Set(ads.map(a => a.adSetId?._id || 'unassigned').filter(Boolean));
      setExpandedSets(allSetIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads]);

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

  const fetchAdSets = async () => {
    try {
      const res = await fetch(`${API_URL}/adsets`);
      const data = await res.json();
      if (data.success) {
        setAdSets(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching ad sets:", error);
    }
  };

  const handleSaveAd = async (adData) => {
    try {
      const url = editingAd
        ? `${API_URL}/ads/${editingAd._id}`
        : `${API_URL}/ads`;
      const method = editingAd ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adData)
      });

      const data = await res.json();

      if (data.success) {
        await fetchAds();
        setShowAdModal(false);
        setEditingAd(null);
        toast.success(editingAd ? 'Anuncio actualizado correctamente' : 'Anuncio creado correctamente');
      } else {
        toast.error("Error al guardar el anuncio: " + (data.error || "Error desconocido"));
      }
    } catch (error) {
      console.error("Error saving ad:", error);
      toast.error("Error al guardar el anuncio");
    }
  };

  const handleStatusChange = async (adId, newStatus) => {
    try {
      const res = await fetch(`${API_URL}/ads/${adId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      const data = await res.json();
      if (data.success) {
        await fetchAds();
        toast.success('Estado actualizado correctamente');
      } else {
        toast.error("Error al actualizar estado: " + (data.error || "Error desconocido"));
      }
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Error al actualizar estado");
    }
  };

  const toggleSet = (setId) => {
    setExpandedSets(prev => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      return next;
    });
  };

  // Group ads: Campaign → Ad Set → Ads
  const buildHierarchy = () => {
    const campaigns = {};

    for (const ad of ads) {
      const campaignId = ad.adSetId?.campaignId?._id || 'no-campaign';
      const campaignName = ad.adSetId?.campaignId?.name || 'Sin Campaña';
      const adSetId = ad.adSetId?._id || 'no-adset';
      const adSetName = ad.adSetId?.name || 'Sin Ad Set';

      if (!campaigns[campaignId]) {
        campaigns[campaignId] = { name: campaignName, adSets: {} };
      }
      if (!campaigns[campaignId].adSets[adSetId]) {
        campaigns[campaignId].adSets[adSetId] = { name: adSetName, ads: [] };
      }
      campaigns[campaignId].adSets[adSetId].ads.push(ad);
    }

    return campaigns;
  };

  const hierarchy = buildHierarchy();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Anuncios</h1>
          <p className="text-gray-400 mt-2">Agrupados por campaña y ad set</p>
        </div>
        <button
          onClick={() => {
            setEditingAd(null);
            setShowAdModal(true);
          }}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Anuncio</span>
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">Cargando anuncios...</p>
        </div>
      ) : ads.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No hay anuncios</h3>
          <p className="text-gray-400">Los anuncios se crearán automáticamente con las campañas</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(hierarchy).map(([campaignId, campaign]) => (
            <div key={campaignId}>
              {/* Campaign Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                <h2 className="text-lg font-bold text-white">{campaign.name}</h2>
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                  {Object.keys(campaign.adSets).length} ad sets
                </span>
              </div>

              {/* Ad Sets */}
              <div className="space-y-3 ml-2">
                {Object.entries(campaign.adSets).map(([adSetId, adSet]) => {
                  const isExpanded = expandedSets.has(adSetId);
                  const activeCount = adSet.ads.filter(a => a.status === 'ACTIVE').length;
                  const totalCount = adSet.ads.length;

                  return (
                    <div key={adSetId} className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
                      {/* Ad Set Header */}
                      <button
                        onClick={() => toggleSet(adSetId)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/80 hover:bg-gray-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-semibold text-white text-sm">{adSet.name}</span>
                          <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                            {activeCount}/{totalCount} activos
                          </span>
                        </div>
                      </button>

                      {/* Ads Table */}
                      {isExpanded && (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-900/50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Anuncio</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase w-32">Estado</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase w-28">Acciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700/30">
                              {adSet.ads.map((ad) => (
                                <tr key={ad._id} className="hover:bg-gray-700/20 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="text-sm font-medium text-white">{ad.name}</div>
                                    <code className="text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded mt-1 inline-block">
                                      {ad.fbAdId}
                                    </code>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <select
                                      value={ad.status}
                                      onChange={(e) => handleStatusChange(ad._id, e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border-2 transition-colors cursor-pointer ${STATUS_STYLE[ad.status] || STATUS_STYLE.ARCHIVED}`}
                                    >
                                      <option value="ACTIVE">Activo</option>
                                      <option value="PAUSED">Pausado</option>
                                      <option value="ARCHIVED">Archivado</option>
                                    </select>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-right">
                                    <div className="flex items-center justify-end space-x-1">
                                      <button
                                        onClick={() => setSelectedAd(ad)}
                                        className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
                                        title="Ver Detalles"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingAd(ad);
                                          setShowAdModal(true);
                                        }}
                                        className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                                        title="Editar"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

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
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Productos Asociados</p>
                      <p className="text-sm text-white mt-1">
                        <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded">
                          {selectedAd.productIds?.length || 0} productos
                        </span>
                      </p>
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
                      {['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'fbPixelId'].map(key => (
                        selectedAd.tracking[key] ? (
                          <div key={key}>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{key.replace(/([A-Z])/g, ' $1').replace('utm ', 'UTM ')}</p>
                            <p className="text-sm text-white mt-1">
                              <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking[key]}</code>
                            </p>
                          </div>
                        ) : null
                      ))}
                    </div>
                  </div>
                )}

                {/* Bot Response Customization */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    Personalización del Bot
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Ángulo del Anuncio</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adAngle ? (
                          <span className="bg-purple-500/20 text-purple-300 px-2 py-1 rounded">
                            {{
                              'price_sensitive': 'Precio - Enfoque en valor/precio accesible',
                              'quality_premium': 'Calidad Premium - Enfoque en durabilidad',
                              'urgency_offer': 'Urgencia - Oferta por tiempo limitado',
                              'problem_pain': 'Problema/Dolor - Solución al sol/calor',
                              'bulk_b2b': 'Mayoreo/B2B - Enfoque en negocios',
                              'diy_ease': 'Fácil Instalación - Hazlo tú mismo',
                              'comparison_switching': 'Comparación - Mejor que alternativas'
                            }[selectedAd.adAngle] || selectedAd.adAngle}
                          </span>
                        ) : (
                          <span className="text-gray-500">No configurado</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Tipo de Audiencia</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adIntent?.audienceType || <span className="text-gray-500">No configurado</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Uso Principal</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adIntent?.primaryUse || <span className="text-gray-500">No configurado</span>}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Gancho de Oferta</p>
                      <p className="text-sm mt-1">
                        {selectedAd.adIntent?.offerHook ? (
                          <span className="bg-green-500/20 text-green-300 px-3 py-2 rounded block">
                            {selectedAd.adIntent.offerHook}
                          </span>
                        ) : (
                          <span className="text-gray-500">No configurado</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                {selectedAd.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Métricas
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { key: 'impressions', label: 'Impresiones' },
                        { key: 'clicks', label: 'Clicks' },
                        { key: 'conversions', label: 'Conversiones' },
                        { key: 'spend', label: 'Gasto', prefix: '$' },
                        { key: 'reach', label: 'Alcance' },
                        { key: 'ctr', label: 'CTR', suffix: '%' },
                        { key: 'cpc', label: 'CPC', prefix: '$' },
                        { key: 'cpm', label: 'CPM', prefix: '$' },
                      ].map(m => {
                        const val = selectedAd.metrics[m.key];
                        if (val === undefined || val === null) return null;
                        return (
                          <div key={m.key} className="bg-gray-900/50 p-3 rounded">
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{m.label}</p>
                            <p className="text-2xl font-bold text-white mt-1">{m.prefix || ''}{val}{m.suffix || ''}</p>
                          </div>
                        );
                      })}
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

      {/* Ad Modal */}
      {showAdModal && (
        <AdModal
          ad={editingAd}
          adSets={adSets}
          onSave={handleSaveAd}
          onClose={() => {
            setShowAdModal(false);
            setEditingAd(null);
          }}
        />
      )}
    </div>
  );
}

export default AdsView;
