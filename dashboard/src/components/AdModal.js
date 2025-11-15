import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdModal({ ad, adSets, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    fbAdId: '',
    adSetId: '',
    status: 'ACTIVE',
    description: '',
    callToAction: 'LEARN_MORE',
    linkUrl: '',
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
    if (ad) {
      setFormData({
        name: ad.name || '',
        fbAdId: ad.fbAdId || '',
        adSetId: ad.adSetId?._id || ad.adSetId || '',
        status: ad.status || 'ACTIVE',
        description: ad.creative?.description || '',
        callToAction: ad.creative?.callToAction || 'LEARN_MORE',
        linkUrl: ad.creative?.linkUrl || '',
        productIds: ad.productIds?.map(p => p._id || p) || []
      });
    }
  }, [ad]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const payload = {
      name: formData.name,
      fbAdId: formData.fbAdId,
      adSetId: formData.adSetId,
      status: formData.status,
      productIds: formData.productIds,
      creative: {
        description: formData.description,
        callToAction: formData.callToAction,
        linkUrl: formData.linkUrl
      }
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
            {ad ? 'Editar Anuncio' : 'Nuevo Anuncio'}
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
                  placeholder="Anuncio Principal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  FB Ad ID *
                </label>
                <input
                  type="text"
                  name="fbAdId"
                  value={formData.fbAdId}
                  onChange={handleChange}
                  required
                  disabled={!!ad}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  placeholder="120232182338600686"
                />
              </div>
            </div>

            {/* AdSet Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Ad Set *
              </label>
              <select
                name="adSetId"
                value={formData.adSetId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Selecciona un ad set</option>
                {adSets.map(adSet => (
                  <option key={adSet._id} value={adSet._id}>
                    {adSet.name} - {adSet.campaignId?.name || ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
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

            {/* Creative Content */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Contenido Creativo</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Descripción
                  </label>
                  <input
                    type="text"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Envío gratis a todo México"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Call to Action
                    </label>
                    <select
                      name="callToAction"
                      value={formData.callToAction}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="LEARN_MORE">Más información</option>
                      <option value="SHOP_NOW">Comprar ahora</option>
                      <option value="SIGN_UP">Registrarse</option>
                      <option value="CONTACT_US">Contáctanos</option>
                      <option value="GET_QUOTE">Solicitar cotización</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      URL de Destino
                    </label>
                    <input
                      type="url"
                      name="linkUrl"
                      value={formData.linkUrl}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="https://m.me/..."
                    />
                  </div>
                </div>
              </div>
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
            {ad ? 'Actualizar' : 'Crear'} Anuncio
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdModal;
