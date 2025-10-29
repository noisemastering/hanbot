import React, { useState, useEffect } from 'react';

function CampaignModal({ campaign, onSave, onClose }) {
  const [formData, setFormData] = useState({
    ref: '',
    name: '',
    description: '',
    active: true,
    startDate: '',
    endDate: '',
    initialMessage: '',
    defaultFlow: 'malla_confeccionada',
    conversionGoal: 'solicitar_cotizacion'
  });

  useEffect(() => {
    if (campaign) {
      setFormData({
        ref: campaign.ref || '',
        name: campaign.name || '',
        description: campaign.description || '',
        active: campaign.active !== undefined ? campaign.active : true,
        startDate: campaign.startDate ? campaign.startDate.split('T')[0] : '',
        endDate: campaign.endDate ? campaign.endDate.split('T')[0] : '',
        initialMessage: campaign.initialMessage || '',
        defaultFlow: campaign.defaultFlow || 'malla_confeccionada',
        conversionGoal: campaign.conversionGoal || 'solicitar_cotizacion'
      });
    }
  }, [campaign]);

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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {campaign ? 'Editar Campaña' : 'Nueva Campaña'}
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
          <div className="space-y-4">
            {/* Ref and Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Referencia (Ref) *
                </label>
                <input
                  type="text"
                  name="ref"
                  value={formData.ref}
                  onChange={handleChange}
                  required
                  disabled={!!campaign}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="malla_beige_2025"
                />
                <p className="text-xs text-gray-500 mt-1">URL: ?ref=valor</p>
              </div>
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
                  placeholder="Malla Sombra Beige"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Descripción
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={2}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Descripción de la campaña..."
              />
            </div>

            {/* Active Status and Dates */}
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="active"
                    checked={formData.active}
                    onChange={handleChange}
                    className="w-5 h-5 rounded bg-gray-900/50 border-gray-700 text-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-300">Activa</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Fecha Inicio
                </label>
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Fecha Fin
                </label>
                <input
                  type="date"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* Initial Message */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Mensaje Inicial
              </label>
              <textarea
                name="initialMessage"
                value={formData.initialMessage}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="¡Hola! Veo que te interesa la malla sombra beige..."
              />
            </div>

            {/* Flow and Conversion Goal */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Flujo Predeterminado
                </label>
                <select
                  name="defaultFlow"
                  value={formData.defaultFlow}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="malla_confeccionada">Malla Confeccionada</option>
                  <option value="malla_rollo">Malla en Rollo</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Meta de Conversión
                </label>
                <select
                  name="conversionGoal"
                  value={formData.conversionGoal}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="solicitar_cotizacion">Solicitar Cotización</option>
                  <option value="ver_producto">Ver Producto</option>
                  <option value="comprar_directo">Comprar Directo</option>
                  <option value="contacto">Contacto</option>
                </select>
              </div>
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
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {campaign ? 'Actualizar' : 'Crear'} Campaña
          </button>
        </div>
      </div>
    </div>
  );
}

export default CampaignModal;
