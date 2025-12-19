import React, { useState, useEffect } from 'react';
import ProductTreeSelector from './ProductTreeSelector';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Helper function to collect only sellable product IDs from tree
function collectSellableProductIds(productTree) {
  let sellableIds = [];

  function traverse(products) {
    products.forEach(product => {
      if (product.sellable) {
        sellableIds.push(product._id);
      }
      if (product.children && product.children.length > 0) {
        traverse(product.children);
      }
    });
  }

  traverse(productTree);
  return sellableIds;
}

// Helper function to filter out unavailable products from tree
function filterAvailableProducts(productTree) {
  return productTree.reduce((acc, product) => {
    // Only include available products
    if (product.available !== false) {
      const filteredProduct = {
        ...product,
        children: product.children ? filterAvailableProducts(product.children) : []
      };
      acc.push(filteredProduct);
    }
    return acc;
  }, []);
}

function CampaignModal({ campaign, onSave, onClose }) {
  const [formData, setFormData] = useState({
    ref: '',
    name: '',
    description: '',
    active: true,
    status: 'ACTIVE',
    startDate: '',
    endDate: '',
    initialMessage: '',
    defaultFlow: 'malla_confeccionada',
    conversionGoal: 'solicitar_cotizacion',
    // Facebook Campaign fields
    fbCampaignId: '',
    fbAdAccountId: '',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudget: '',
    lifetimeBudget: '',
    productIds: []
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);

  // Fetch product families tree on mount
  useEffect(() => {
    const fetchProductFamilies = async () => {
      setProductsLoading(true);
      try {
        const response = await fetch(`${API_URL}/product-families/tree`);
        const data = await response.json();
        if (data.success) {
          setProductFamilies(data.data);
        }
      } catch (error) {
        console.error('Error fetching product families:', error);
      } finally {
        setProductsLoading(false);
      }
    };
    fetchProductFamilies();
  }, []);

  useEffect(() => {
    if (campaign) {
      setFormData({
        ref: campaign.ref || '',
        name: campaign.name || '',
        description: campaign.description || '',
        active: campaign.active !== undefined ? campaign.active : true,
        status: campaign.status || 'ACTIVE',
        startDate: campaign.startDate ? campaign.startDate.split('T')[0] : '',
        endDate: campaign.endDate ? campaign.endDate.split('T')[0] : '',
        initialMessage: campaign.initialMessage || '',
        defaultFlow: campaign.defaultFlow || 'malla_confeccionada',
        conversionGoal: campaign.conversionGoal || 'solicitar_cotizacion',
        fbCampaignId: campaign.fbCampaignId || '',
        fbAdAccountId: campaign.fbAdAccountId || '',
        objective: campaign.objective || 'OUTCOME_TRAFFIC',
        dailyBudget: campaign.dailyBudget || '',
        lifetimeBudget: campaign.lifetimeBudget || '',
        productIds: campaign.productIds?.map(p => p._id || p) || []
      });
    }
  }, [campaign]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate required fields (only for new campaigns)
    if (!campaign && (!formData.ref || formData.ref.trim() === '')) {
      alert('Por favor ingresa un valor para el campo "Ref" (usado para tracking con ?ref=)');
      return;
    }

    // Filter to only include sellable products
    const allSellableIds = collectSellableProductIds(productFamilies);
    const sellableProductIds = formData.productIds.filter(id => allSellableIds.includes(id));

    // Prepare data to save
    const dataToSave = {
      ...formData,
      productIds: sellableProductIds // Only save sellable products
    };

    // When editing, don't send ref field (it's immutable and disabled)
    if (campaign) {
      delete dataToSave.ref;
    }

    onSave(dataToSave);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleProductToggle = (productIds, isSelected) => {
    setFormData(prev => {
      if (isSelected) {
        // Remove these IDs
        return {
          ...prev,
          productIds: prev.productIds.filter(id => !productIds.includes(id))
        };
      } else {
        // Add these IDs (avoiding duplicates)
        const newIds = productIds.filter(id => !prev.productIds.includes(id));
        return {
          ...prev,
          productIds: [...prev.productIds, ...newIds]
        };
      }
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

            {/* Facebook Campaign Settings */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Configuración de Facebook</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    FB Campaign ID
                  </label>
                  <input
                    type="text"
                    name="fbCampaignId"
                    value={formData.fbCampaignId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="120226050770160686"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    FB Ad Account ID
                  </label>
                  <input
                    type="text"
                    name="fbAdAccountId"
                    value={formData.fbAdAccountId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="act_123456789"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Objetivo
                  </label>
                  <select
                    name="objective"
                    value={formData.objective}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="OUTCOME_TRAFFIC">Tráfico</option>
                    <option value="OUTCOME_LEADS">Leads</option>
                    <option value="OUTCOME_SALES">Ventas</option>
                    <option value="OUTCOME_ENGAGEMENT">Engagement</option>
                    <option value="OUTCOME_AWARENESS">Conocimiento</option>
                  </select>
                </div>
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
                    <option value="ACTIVE">Activa</option>
                    <option value="PAUSED">Pausada</option>
                    <option value="ARCHIVED">Archivada</option>
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
                    placeholder="100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Presupuesto Total ($)
                  </label>
                  <input
                    type="number"
                    name="lifetimeBudget"
                    value={formData.lifetimeBudget}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="3000"
                  />
                </div>
              </div>
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

            {/* Products Selection */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Productos Asociados</h3>
              <ProductTreeSelector
                selectedProducts={formData.productIds}
                onToggle={handleProductToggle}
                products={filterAvailableProducts(productFamilies)}
                loading={productsLoading}
              />
              <p className="text-xs text-gray-400 mt-2">
                Nota: Solo se guardarán los productos vendibles seleccionados.
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
            {campaign ? 'Actualizar' : 'Crear'} Campaña
          </button>
        </div>
      </div>
    </div>
  );
}

export default CampaignModal;
