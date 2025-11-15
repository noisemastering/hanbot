import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdSetModal({ adSet, campaigns, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    fbAdSetId: '',
    campaignId: '',
    status: 'ACTIVE',
    optimizationGoal: 'LINK_CLICKS',
    billingEvent: 'IMPRESSIONS',
    dailyBudget: '',
    locations: 'Mexico',
    ageMin: '25',
    ageMax: '60',
    placements: 'facebook_feed,instagram_feed',
    productIds: []
  });

  const [products, setProducts] = useState([]);

  // Fetch products on mount
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`${API_URL}/products`);
        const data = await response.json();
        if (data.success) {
          setProducts(data.data);
        }
      } catch (error) {
        console.error('Error fetching products:', error);
      }
    };
    fetchProducts();
  }, []);

  useEffect(() => {
    if (adSet) {
      setFormData({
        name: adSet.name || '',
        fbAdSetId: adSet.fbAdSetId || '',
        campaignId: adSet.campaignId?._id || adSet.campaignId || '',
        status: adSet.status || 'ACTIVE',
        optimizationGoal: adSet.optimizationGoal || 'LINK_CLICKS',
        billingEvent: adSet.billingEvent || 'IMPRESSIONS',
        dailyBudget: adSet.dailyBudget || '',
        locations: adSet.targeting?.locations?.join(', ') || 'Mexico',
        ageMin: adSet.targeting?.ageMin || '25',
        ageMax: adSet.targeting?.ageMax || '60',
        placements: adSet.placements?.join(',') || 'facebook_feed,instagram_feed',
        productIds: adSet.productIds?.map(p => p._id || p) || []
      });
    }
  }, [adSet]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const payload = {
      name: formData.name,
      fbAdSetId: formData.fbAdSetId,
      campaignId: formData.campaignId,
      status: formData.status,
      optimizationGoal: formData.optimizationGoal,
      billingEvent: formData.billingEvent,
      dailyBudget: formData.dailyBudget ? parseFloat(formData.dailyBudget) : undefined,
      productIds: formData.productIds,
      targeting: {
        locations: formData.locations.split(',').map(l => l.trim()),
        ageMin: parseInt(formData.ageMin),
        ageMax: parseInt(formData.ageMax)
      },
      placements: formData.placements.split(',').map(p => p.trim())
    };

    onSave(payload);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  const handleProductToggle = (productId) => {
    setFormData(prev => ({
      ...prev,
      productIds: prev.productIds.includes(productId)
        ? prev.productIds.filter(id => id !== productId)
        : [...prev.productIds, productId]
    }));
  };

  const handleSelectAllProducts = () => {
    if (formData.productIds.length === products.length) {
      // Deselect all
      setFormData(prev => ({ ...prev, productIds: [] }));
    } else {
      // Select all
      setFormData(prev => ({ ...prev, productIds: products.map(p => p._id) }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {adSet ? 'Editar Ad Set' : 'Nuevo Ad Set'}
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
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
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
                  placeholder="Ad Set Principal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  FB AdSet ID *
                </label>
                <input
                  type="text"
                  name="fbAdSetId"
                  value={formData.fbAdSetId}
                  onChange={handleChange}
                  required
                  disabled={!!adSet}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  placeholder="120232182338610686"
                />
              </div>
            </div>

            {/* Campaign Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Campaña *
              </label>
              <select
                name="campaignId"
                value={formData.campaignId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Selecciona una campaña</option>
                {campaigns.map(campaign => (
                  <option key={campaign._id} value={campaign._id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status and Budget */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Estado
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="ACTIVE">Activo</option>
                  <option value="PAUSED">Pausado</option>
                  <option value="ARCHIVED">Archivado</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Presupuesto Diario ($)
                </label>
                <input
                  type="number"
                  name="dailyBudget"
                  value={formData.dailyBudget}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="50"
                />
              </div>
            </div>

            {/* Targeting */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Segmentación</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ubicaciones (separadas por comas)
                  </label>
                  <input
                    type="text"
                    name="locations"
                    value={formData.locations}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Mexico, United States"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Edad Mín
                    </label>
                    <input
                      type="number"
                      name="ageMin"
                      value={formData.ageMin}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Edad Máx
                    </label>
                    <input
                      type="number"
                      name="ageMax"
                      value={formData.ageMax}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Optimization */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Objetivo de Optimización
                </label>
                <select
                  name="optimizationGoal"
                  value={formData.optimizationGoal}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="LINK_CLICKS">Link Clicks</option>
                  <option value="IMPRESSIONS">Impressions</option>
                  <option value="REACH">Reach</option>
                  <option value="CONVERSIONS">Conversions</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Evento de Facturación
                </label>
                <select
                  name="billingEvent"
                  value={formData.billingEvent}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="IMPRESSIONS">Impressions</option>
                  <option value="LINK_CLICKS">Link Clicks</option>
                </select>
              </div>
            </div>

            {/* Placements */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Ubicaciones de Anuncios (separadas por comas)
              </label>
              <input
                type="text"
                name="placements"
                value={formData.placements}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="facebook_feed,instagram_feed"
              />
            </div>

            {/* Products Selection */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">Productos Asociados</h3>
                {products.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAllProducts}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    {formData.productIds.length === products.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {products.length === 0 ? (
                  <p className="text-sm text-gray-500">No hay productos disponibles</p>
                ) : (
                  products.map((product) => (
                    <label
                      key={product._id}
                      className="flex items-center p-3 bg-gray-900/50 rounded-lg hover:bg-gray-700/50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={formData.productIds.includes(product._id)}
                        onChange={() => handleProductToggle(product._id)}
                        className="w-4 h-4 text-primary-500 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
                      />
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-white">{product.name}</p>
                        <p className="text-xs text-gray-400">
                          {product.size && `${product.size} - `}${product.price ? `$${product.price}` : 'Precio no disponible'}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {formData.productIds.length} producto(s) seleccionado(s)
              </p>
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
            {adSet ? 'Actualizar' : 'Crear'} Ad Set
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdSetModal;
