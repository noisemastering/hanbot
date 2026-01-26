import React, { useState, useEffect } from 'react';
import ProductTreeSelector from './ProductTreeSelector';
import CatalogUpload from './CatalogUpload';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Ad angles - same as CampaignModal for consistency
const AD_ANGLES = [
  { value: 'problem_pain', label: '☀️ Problema/Dolor', desc: 'Resuelve un problema del cliente' },
  { value: 'price_value', label: '💰 Precio/Valor', desc: 'Enfocado en precio accesible' },
  { value: 'quality', label: '⭐ Calidad', desc: 'Enfocado en calidad/durabilidad' },
  { value: 'urgency', label: '⏰ Urgencia', desc: 'Oferta por tiempo limitado' },
  { value: 'social_proof', label: '👥 Prueba Social', desc: 'Testimonios y casos de éxito' },
  { value: 'convenience', label: '🚚 Conveniencia', desc: 'Facilidad de compra o envío' },
  { value: 'bulk_b2b', label: '🏢 Mayoreo/B2B', desc: 'Enfoque en negocios y distribuidores' },
  { value: 'diy_ease', label: '🔧 Fácil Instalación', desc: 'Hazlo tú mismo, fácil de usar' },
  { value: 'comparison', label: '🔄 Comparación', desc: 'Mejor que las alternativas' }
];

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

// Helper function to get product info by ID from tree
function getProductById(productTree, id) {
  let found = null;

  function traverse(products, path = []) {
    for (const product of products) {
      const currentPath = [...path, product.name];
      if (product._id === id) {
        found = { ...product, fullPath: currentPath.join(' > ') };
        return;
      }
      if (product.children && product.children.length > 0) {
        traverse(product.children, currentPath);
      }
    }
  }

  traverse(productTree);
  return found;
}

function AdModal({ ad, adSets, parentAdSetId, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    fbAdId: '',
    adSetId: parentAdSetId || '',
    status: 'ACTIVE',
    description: '',
    callToAction: 'LEARN_MORE',
    linkUrl: '',
    productIds: [],
    mainProductId: '', // Main product for determining productInterest
    // Ad Intent - for tailoring bot responses
    adAngle: '',
    primaryUse: '',
    audienceType: '',
    offerHook: ''
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [currentCatalog, setCurrentCatalog] = useState(null);

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
    if (ad) {
      setFormData({
        name: ad.name || '',
        fbAdId: ad.fbAdId || '',
        adSetId: ad.adSetId?._id || ad.adSetId || '',
        status: ad.status || 'ACTIVE',
        description: ad.creative?.description || '',
        callToAction: ad.creative?.callToAction || 'LEARN_MORE',
        linkUrl: ad.creative?.linkUrl || '',
        productIds: ad.productIds?.map(p => p._id || p) || [],
        mainProductId: ad.mainProductId?._id || ad.mainProductId || '',
        // Ad Intent fields
        adAngle: ad.adAngle || '',
        primaryUse: ad.adIntent?.primaryUse || '',
        audienceType: ad.adIntent?.audienceType || '',
        offerHook: ad.adIntent?.offerHook || ''
      });
      setCurrentCatalog(ad.catalog || null);
    }
  }, [ad]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Filter to only include sellable products
    const allSellableIds = collectSellableProductIds(productFamilies);
    const sellableProductIds = formData.productIds.filter(id => allSellableIds.includes(id));

    const payload = {
      name: formData.name,
      fbAdId: formData.fbAdId,
      adSetId: formData.adSetId,
      status: formData.status,
      productIds: sellableProductIds, // Only save sellable products
      mainProductId: formData.mainProductId || null, // Main product for productInterest
      creative: {
        description: formData.description,
        callToAction: formData.callToAction,
        linkUrl: formData.linkUrl
      },
      // Ad Intent - for tailoring bot responses
      adAngle: formData.adAngle || null,
      adIntent: {
        primaryUse: formData.primaryUse || null,
        audienceType: formData.audienceType || null,
        offerHook: formData.offerHook || null
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

            {/* Bot Response Customization */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">🤖 Personalización de Respuestas del Bot</h3>
              <p className="text-xs text-gray-400 mb-4">
                Estos campos ayudan al bot a personalizar sus respuestas según el contexto del anuncio.
              </p>

              <div className="space-y-4">
                {/* Ad Angle */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ángulo del Anuncio
                  </label>
                  <select
                    name="adAngle"
                    value={formData.adAngle}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Sin ángulo específico</option>
                    {AD_ANGLES.map(a => (
                      <option key={a.value} value={a.value}>{a.label} - {a.desc}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Primary Use */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Uso Principal
                    </label>
                    <input
                      type="text"
                      name="primaryUse"
                      value={formData.primaryUse}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="ej: protección solar agrícola, sombra para patio"
                    />
                  </div>

                  {/* Audience Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Tipo de Audiencia
                    </label>
                    <input
                      type="text"
                      name="audienceType"
                      value={formData.audienceType}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="ej: agricultor/vivero, dueño de casa, negocio"
                    />
                  </div>
                </div>

                {/* Offer Hook */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    🎁 Gancho de Oferta
                  </label>
                  <input
                    type="text"
                    name="offerHook"
                    value={formData.offerHook}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="ej: envío gratis por tiempo limitado, 10% descuento esta semana"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Este texto se agregará al final de las respuestas del bot cuando sea relevante.
                  </p>
                </div>
              </div>
            </div>

            {/* Products Selection */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Productos Asociados</h3>
              {(() => {
                const selectedAdSet = adSets.find(a => a._id === formData.adSetId);
                // Get inherited products: from AdSet if it has them, otherwise from Campaign
                const adSetProducts = selectedAdSet?.productIds?.map(p => p._id || p) || [];
                const campaignProducts = selectedAdSet?.campaignId?.productIds?.map(p => p._id || p) || [];
                const inheritedProductIds = adSetProducts.length > 0 ? adSetProducts : campaignProducts;
                const inheritedFrom = adSetProducts.length > 0
                  ? `AdSet: ${selectedAdSet?.name}`
                  : (campaignProducts.length > 0 ? `Campaña: ${selectedAdSet?.campaignId?.name}` : null);
                return (
                  <ProductTreeSelector
                    selectedProducts={formData.productIds}
                    inheritedProducts={inheritedProductIds}
                    inheritedFrom={inheritedFrom}
                    onToggle={handleProductToggle}
                    products={productFamilies}
                    loading={productsLoading}
                  />
                );
              })()}
              <p className="text-xs text-gray-400 mt-2">
                Nota: Deja vacío para usar los productos del AdSet o Campaña. Solo se guardarán los productos vendibles seleccionados.
              </p>

              {/* Main Product Selection */}
              {formData.productIds.length > 0 && (
                <div className="mt-4 p-3 bg-gray-900/30 rounded-lg border border-gray-700/50">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Producto Principal (para detección de interés)
                  </label>
                  <select
                    name="mainProductId"
                    value={formData.mainProductId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Usar primer producto de la lista</option>
                    {formData.productIds.map(id => {
                      const product = getProductById(productFamilies, id);
                      return product ? (
                        <option key={id} value={id}>
                          {product.fullPath}
                        </option>
                      ) : null;
                    })}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Este producto determina cómo el bot identifica el tipo de producto del anuncio.
                  </p>
                </div>
              )}
            </div>

            {/* Catalog Upload */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Catálogo PDF</h3>
              {ad?._id ? (
                <CatalogUpload
                  entityType="ad"
                  entityId={ad._id}
                  currentCatalog={currentCatalog}
                  onUploadSuccess={(catalog) => setCurrentCatalog(catalog)}
                  onDeleteSuccess={() => setCurrentCatalog(null)}
                  inheritedFrom={!currentCatalog && (ad.adSetId?.catalog?.url || ad.adSetId?.campaignId?.catalog?.url) ?
                    (ad.adSetId?.catalog?.url ? `AdSet: ${ad.adSetId?.name}` : `Campaña: ${ad.adSetId?.campaignId?.name}`) : null
                  }
                />
              ) : (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                  <p className="text-amber-400 text-sm">
                    Primero guarda el Anuncio para poder subir un catálogo.
                  </p>
                </div>
              )}
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
