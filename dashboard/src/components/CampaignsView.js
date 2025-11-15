import React, { useState } from 'react';

function CampaignsView({ campaigns, loading, onAdd, onEdit, onDelete }) {
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Campañas</h1>
          <p className="text-gray-400 mt-2">Gestiona las campañas de Facebook/Instagram</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nueva Campaña</span>
        </button>
      </div>

      {/* Campaigns Table */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Lista de Campañas</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando campañas...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay campañas</h3>
            <p className="text-gray-400 mb-6">Comienza creando tu primera campaña</p>
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Agregar Campaña</span>
            </button>
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
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Métricas
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Fechas
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {campaigns.map((campaign) => (
                  <tr key={campaign._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-white">{campaign.name}</div>
                          {campaign.fbCampaignId && (
                            <div className="mt-1">
                              <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                                {campaign.fbCampaignId}
                              </code>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        campaign.active
                          ? "bg-green-500/20 text-green-300"
                          : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {campaign.active ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      <div className="flex space-x-3 text-xs">
                        <span title="Visitas">
                          <span className="text-gray-500">V:</span> {campaign.metrics?.visits || 0}
                        </span>
                        <span title="Interacciones">
                          <span className="text-gray-500">I:</span> {campaign.metrics?.interactions || 0}
                        </span>
                        <span title="Conversiones">
                          <span className="text-gray-500">C:</span> {campaign.metrics?.conversions || 0}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {campaign.startDate && (
                        <div className="text-xs">
                          {new Date(campaign.startDate).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
                          {campaign.endDate && ` - ${new Date(campaign.endDate).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}`}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => setSelectedCampaign(campaign)}
                          className="p-2 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-colors"
                          title="Ver Detalles"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onEdit(campaign)}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDelete(campaign)}
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

      {/* Campaign Details Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                Detalles de la Campaña
              </h2>
              <button
                onClick={() => setSelectedCampaign(null)}
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
                      <p className="text-sm text-white mt-1">{selectedCampaign.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Referencia</p>
                      <p className="text-sm text-white mt-1">
                        <code className="bg-primary-500/10 text-primary-400 px-2 py-1 rounded">{selectedCampaign.ref}</code>
                      </p>
                    </div>
                    {selectedCampaign.description && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Descripción</p>
                        <p className="text-sm text-gray-300 mt-1">{selectedCampaign.description}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Estado</p>
                      <p className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedCampaign.active ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {selectedCampaign.active ? "Activa" : "Inactiva"}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Status FB</p>
                      <p className="text-sm text-white mt-1">{selectedCampaign.status || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                {/* Facebook Configuration */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    Configuración de Facebook
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB Campaign ID</p>
                      <p className="text-sm text-white mt-1">
                        {selectedCampaign.fbCampaignId ? (
                          <code className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded">{selectedCampaign.fbCampaignId}</code>
                        ) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB Ad Account ID</p>
                      <p className="text-sm text-white mt-1">{selectedCampaign.fbAdAccountId || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Objetivo</p>
                      <p className="text-sm text-white mt-1">{selectedCampaign.objective || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">ID Interno</p>
                      <p className="text-sm text-gray-400 mt-1">
                        <code className="text-xs">{selectedCampaign._id}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Budget */}
                {(selectedCampaign.dailyBudget || selectedCampaign.lifetimeBudget) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Presupuesto
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedCampaign.dailyBudget && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Diario</p>
                          <p className="text-sm text-white mt-1">${selectedCampaign.dailyBudget}</p>
                        </div>
                      )}
                      {selectedCampaign.lifetimeBudget && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
                          <p className="text-sm text-white mt-1">${selectedCampaign.lifetimeBudget}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Dates */}
                {(selectedCampaign.startDate || selectedCampaign.endDate) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Fechas
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedCampaign.startDate && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Inicio</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedCampaign.startDate).toLocaleDateString('es-MX', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </p>
                        </div>
                      )}
                      {selectedCampaign.endDate && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Fin</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedCampaign.endDate).toLocaleDateString('es-MX', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bot Configuration */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    Configuración del Bot
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedCampaign.defaultFlow && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Flujo Predeterminado</p>
                        <p className="text-sm text-white mt-1">{selectedCampaign.defaultFlow}</p>
                      </div>
                    )}
                    {selectedCampaign.conversionGoal && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Meta de Conversión</p>
                        <p className="text-sm text-white mt-1">{selectedCampaign.conversionGoal}</p>
                      </div>
                    )}
                    {selectedCampaign.productFocus && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Producto Focus</p>
                        <p className="text-sm text-white mt-1">{selectedCampaign.productFocus}</p>
                      </div>
                    )}
                    {selectedCampaign.initialMessage && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Mensaje Inicial</p>
                        <p className="text-sm text-gray-300 mt-1 bg-gray-900/50 p-3 rounded">
                          {selectedCampaign.initialMessage}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics */}
                {selectedCampaign.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      Métricas
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Visitas</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedCampaign.metrics.visits || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Interacciones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedCampaign.metrics.interactions || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Clicks</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedCampaign.metrics.clicks || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Leads</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedCampaign.metrics.leads || 0}</p>
                      </div>
                      <div className="bg-gray-900/50 p-3 rounded">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Conversiones</p>
                        <p className="text-2xl font-bold text-white mt-1">{selectedCampaign.metrics.conversions || 0}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
              <button
                onClick={() => setSelectedCampaign(null)}
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

export default CampaignsView;
