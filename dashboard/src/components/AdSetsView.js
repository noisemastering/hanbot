import React, { useState, useEffect } from 'react';
import AdSetModal from './AdSetModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdSetsView() {
  const [adSets, setAdSets] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdSet, setSelectedAdSet] = useState(null);
  const [showAdSetModal, setShowAdSetModal] = useState(false);
  const [editingAdSet, setEditingAdSet] = useState(null);

  useEffect(() => {
    fetchAdSets();
    fetchCampaigns();
  }, []);

  const fetchAdSets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/adsets`);
      const data = await res.json();
      if (data.success) {
        setAdSets(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching ad sets:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`${API_URL}/campaigns`);
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching campaigns:", error);
    }
  };

  const handleSaveAdSet = async (adSetData) => {
    try {
      const url = editingAdSet
        ? `${API_URL}/adsets/${editingAdSet._id}`
        : `${API_URL}/adsets`;
      const method = editingAdSet ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adSetData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchAdSets();
        setShowAdSetModal(false);
        setEditingAdSet(null);
      } else {
        alert("Error al guardar el ad set: " + (data.error || "Error desconocido"));
      }
    } catch (error) {
      console.error("Error saving ad set:", error);
      alert("Error al guardar el ad set");
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Ad Sets</h1>
          <p className="text-gray-400 mt-2">Gestiona los conjuntos de anuncios de tus campañas</p>
        </div>
        <button
          onClick={() => {
            setEditingAdSet(null);
            setShowAdSetModal(true);
          }}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Ad Set</span>
        </button>
      </div>

      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Lista de Ad Sets</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando ad sets...</p>
          </div>
        ) : adSets.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay ad sets</h3>
            <p className="text-gray-400">Los ad sets se crearán automáticamente con las campañas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="w-[320px] px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="w-[280px] px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Campaña
                  </th>
                  <th className="w-[120px] px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="w-[200px] px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Métricas
                  </th>
                  <th className="w-[150px] px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {adSets.map((adSet) => (
                  <tr key={adSet._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-white">{adSet.name}</div>
                      <code className="text-xs text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded mt-1 inline-block">
                        {adSet.fbAdSetId}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {adSet.campaignId?.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        adSet.status === 'ACTIVE'
                          ? "bg-green-500/20 text-green-300"
                          : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {adSet.status === 'ACTIVE' ? 'Activo' : adSet.status === 'PAUSED' ? 'Pausado' : adSet.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      <div className="flex space-x-3 text-xs">
                        <span title="Impresiones">
                          <span className="text-gray-500">Imp:</span> {adSet.metrics?.impressions || 0}
                        </span>
                        <span title="Clicks">
                          <span className="text-gray-500">Clk:</span> {adSet.metrics?.clicks || 0}
                        </span>
                        <span title="Conversiones">
                          <span className="text-gray-500">Conv:</span> {adSet.metrics?.conversions || 0}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => setSelectedAdSet(adSet)}
                          className="p-2 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-colors"
                          title="Ver Detalles"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setEditingAdSet(adSet);
                            setShowAdSetModal(true);
                          }}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {/* TODO: implement delete */}}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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

      {/* Details Modal */}
      {selectedAdSet && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                Detalles del Ad Set
              </h2>
              <button
                onClick={() => setSelectedAdSet(null)}
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
                      <p className="text-sm text-white mt-1">{selectedAdSet.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB AdSet ID</p>
                      <p className="text-sm text-white mt-1">
                        <code className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded">{selectedAdSet.fbAdSetId}</code>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Estado</p>
                      <p className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedAdSet.status === 'ACTIVE' ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {selectedAdSet.status}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Campaña</p>
                      <p className="text-sm text-white mt-1">{selectedAdSet.campaignId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">ID Interno</p>
                      <p className="text-sm text-gray-400 mt-1">
                        <code className="text-xs">{selectedAdSet._id}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Targeting */}
                {selectedAdSet.targeting && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Segmentación
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAdSet.targeting.locations && selectedAdSet.targeting.locations.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Ubicaciones</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.targeting.locations.join(', ')}</p>
                        </div>
                      )}
                      {(selectedAdSet.targeting.ageMin || selectedAdSet.targeting.ageMax) && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Edad</p>
                          <p className="text-sm text-white mt-1">
                            {selectedAdSet.targeting.ageMin || 18} - {selectedAdSet.targeting.ageMax || 65}
                          </p>
                        </div>
                      )}
                      {selectedAdSet.targeting.gender && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Género</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.targeting.gender}</p>
                        </div>
                      )}
                      {selectedAdSet.targeting.interests && selectedAdSet.targeting.interests.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Intereses</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {selectedAdSet.targeting.interests.map((interest, idx) => (
                              <span key={idx} className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded text-xs">
                                {interest}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Budget & Optimization */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    Presupuesto y Optimización
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedAdSet.dailyBudget && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Presupuesto Diario</p>
                        <p className="text-sm text-white mt-1">${selectedAdSet.dailyBudget}</p>
                      </div>
                    )}
                    {selectedAdSet.lifetimeBudget && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Presupuesto Total</p>
                        <p className="text-sm text-white mt-1">${selectedAdSet.lifetimeBudget}</p>
                      </div>
                    )}
                    {selectedAdSet.optimizationGoal && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Objetivo de Optimización</p>
                        <p className="text-sm text-white mt-1">{selectedAdSet.optimizationGoal}</p>
                      </div>
                    )}
                    {selectedAdSet.billingEvent && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Evento de Facturación</p>
                        <p className="text-sm text-white mt-1">{selectedAdSet.billingEvent}</p>
                      </div>
                    )}
                    {selectedAdSet.bidAmount && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Puja</p>
                        <p className="text-sm text-white mt-1">${selectedAdSet.bidAmount}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Placements */}
                {selectedAdSet.placements && selectedAdSet.placements.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Ubicaciones de Anuncios
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedAdSet.placements.map((placement, idx) => (
                        <span key={idx} className="bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded text-sm">
                          {placement}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Schedule */}
                {(selectedAdSet.startTime || selectedAdSet.endTime) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Programación
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAdSet.startTime && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Inicio</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAdSet.startTime).toLocaleString('es-MX')}
                          </p>
                        </div>
                      )}
                      {selectedAdSet.endTime && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Fin</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAdSet.endTime).toLocaleString('es-MX')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {selectedAdSet.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Métricas
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Impresiones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAdSet.metrics.impressions || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Clicks</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAdSet.metrics.clicks || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Conversiones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAdSet.metrics.conversions || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Gasto</p>
                        <p className="text-2xl font-bold text-white mt-1">${selectedAdSet.metrics.spend || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Alcance</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedAdSet.metrics.reach || 0}</p>
                      </div>
                      {selectedAdSet.metrics.ctr !== undefined && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">CTR</p>
                          <p className="text-2xl font-bold text-white mt-1">{selectedAdSet.metrics.ctr}%</p>
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
                onClick={() => setSelectedAdSet(null)}
                className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AdSet Modal */}
      {showAdSetModal && (
        <AdSetModal
          adSet={editingAdSet}
          campaigns={campaigns}
          onSave={handleSaveAdSet}
          onClose={() => {
            setShowAdSetModal(false);
            setEditingAdSet(null);
          }}
        />
      )}
    </div>
  );
}

export default AdSetsView;
