import React, { useState, useEffect } from 'react';

function PuntoDeVentaModal({ puntoDeVenta, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    defaultUrl: '',
    icon: '',
    description: '',
    active: true
  });

  useEffect(() => {
    if (puntoDeVenta) {
      setFormData({
        name: puntoDeVenta.name || '',
        defaultUrl: puntoDeVenta.defaultUrl || '',
        icon: puntoDeVenta.icon || '',
        description: puntoDeVenta.description || '',
        active: puntoDeVenta.active !== undefined ? puntoDeVenta.active : true
      });
    }
  }, [puntoDeVenta]);

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
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {puntoDeVenta ? 'Editar Punto de Venta' : 'Nuevo Punto de Venta'}
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
                Información del Punto de Venta
              </h3>

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
                  placeholder="Ej: Mercado Libre, Amazon, Tienda Online"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  URL Base
                </label>
                <input
                  type="url"
                  name="defaultUrl"
                  value={formData.defaultUrl}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="https://ejemplo.com/"
                />
                <p className="text-xs text-gray-500 mt-1">URL base opcional que se usará por defecto (ej: https://mercadolibre.com.mx/)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Icono / Emoji
                </label>
                <input
                  type="text"
                  name="icon"
                  value={formData.icon}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="🛒"
                />
                <p className="text-xs text-gray-500 mt-1">Emoji o URL de imagen que representa la tienda</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Descripción
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  placeholder="Descripción breve del punto de venta"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="active"
                  name="active"
                  checked={formData.active}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-500 bg-gray-900/50 border-gray-700 rounded focus:ring-primary-500 focus:ring-2"
                />
                <label htmlFor="active" className="text-sm font-medium text-gray-300">
                  Activo (mostrar en dropdowns)
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-gray-700/50">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              {puntoDeVenta ? 'Guardar Cambios' : 'Crear Punto de Venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PuntoDeVentaModal;
