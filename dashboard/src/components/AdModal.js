import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
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
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    fbAdId: '',
    postId: '',
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
    offerHook: '',
    // Creative extras
    headline: '',
    body: '',
    imageUrl: '',
    videoUrl: '',
    // UTM tracking
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    utmTerm: '',
    // Bot flow
    flowRef: ''
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [flows, setFlows] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [currentCatalog, setCurrentCatalog] = useState(null);
  const [existingCatalogs, setExistingCatalogs] = useState([]);
  const [globalCatalog, setGlobalCatalog] = useState(null);

  const fetchExistingCatalogs = async () => {
    try {
      const response = await fetch(`${API_URL}/uploads/catalogs`);
      const data = await response.json();
      if (data.success) setExistingCatalogs(data.data || []);
    } catch (error) {
      console.error('Error fetching existing catalogs:', error);
    }
  };

  // Fetch product families tree + existing catalogs + global catalog on mount
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
    const fetchGlobalCatalog = async () => {
      try {
        const response = await fetch(`${API_URL}/uploads/catalog/global`);
        const data = await response.json();
        if (data.success) setGlobalCatalog(data.data?.catalog || null);
      } catch (error) {
        console.error('Error fetching global catalog:', error);
      }
    };
    const fetchFlows = async () => {
      try {
        const response = await fetch(`${API_URL}/flows?active=true`);
        const data = await response.json();
        if (data.success) setFlows(data.data);
      } catch (error) {
        console.error('Error fetching flows:', error);
      }
    };
    fetchProductFamilies();
    fetchExistingCatalogs();
    fetchGlobalCatalog();
    fetchFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ad) {
      setFormData({
        name: ad.name || '',
        fbAdId: ad.fbAdId || '',
        postId: ad.postId || '',
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
        offerHook: ad.adIntent?.offerHook || '',
        // Creative extras
        headline: ad.creative?.headline || '',
        body: ad.creative?.body || '',
        imageUrl: ad.creative?.imageUrl || '',
        videoUrl: ad.creative?.videoUrl || '',
        // UTM tracking
        utmSource: ad.tracking?.utmSource || '',
        utmMedium: ad.tracking?.utmMedium || '',
        utmCampaign: ad.tracking?.utmCampaign || '',
        utmContent: ad.tracking?.utmContent || '',
        utmTerm: ad.tracking?.utmTerm || '',
        flowRef: ad.flowRef || ''
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
      postId: formData.postId || null,
      adSetId: formData.adSetId,
      status: formData.status,
      productIds: sellableProductIds, // Only save sellable products
      mainProductId: formData.mainProductId || null, // Main product for productInterest
      creative: {
        description: formData.description,
        callToAction: formData.callToAction,
        linkUrl: formData.linkUrl,
        headline: formData.headline,
        body: formData.body,
        imageUrl: formData.imageUrl,
        videoUrl: formData.videoUrl
      },
      // Ad Intent - for tailoring bot responses
      adAngle: formData.adAngle || null,
      adIntent: {
        primaryUse: formData.primaryUse || null,
        audienceType: formData.audienceType || null,
        offerHook: formData.offerHook || null
      },
      tracking: {
        utmSource: formData.utmSource || null,
        utmMedium: formData.utmMedium || null,
        utmCampaign: formData.utmCampaign || null,
        utmContent: formData.utmContent || null,
        utmTerm: formData.utmTerm || null
      },
      flowRef: formData.flowRef || null
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
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {ad ? t('adModal.edit') : t('adModal.create')}
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
                  {t('adModal.nameRequired')}
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('adModal.namePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adModal.fbAdIdRequired')}
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

            {/* Post ID for comment-initiated conversations */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Post ID
              </label>
              <input
                type="text"
                name="postId"
                value={formData.postId}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="pfbid02abc123..."
              />
              <p className="text-xs text-gray-400 mt-1">
                ID del post de Facebook asociado a este anuncio (para conversaciones desde comentarios)
              </p>
            </div>

            {/* AdSet Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('adModal.adSetRequired')}
              </label>
              <select
                name="adSetId"
                value={formData.adSetId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('adModal.selectAdSetOption')}</option>
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
                {t('common.status')}
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="ACTIVE">{t('adModal.statusActive')}</option>
                <option value="PAUSED">{t('adModal.statusPaused')}</option>
                <option value="ARCHIVED">{t('adModal.statusArchived')}</option>
              </select>
            </div>

            {/* Bot Flow */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Flujo del bot
              </label>
              <select
                name="flowRef"
                value={formData.flowRef}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Automatico (detectar por producto)</option>
                {flows.map(flow => (
                  <option key={flow.key} value={flow.key}>
                    {flow.name}
                  </option>
                ))}
              </select>
              {/* Inherited flow hint */}
              {!formData.flowRef && (() => {
                const selectedAdSet = adSets.find(a => a._id === formData.adSetId);
                const adSetFlow = selectedAdSet?.flowRef;
                const campaignFlow = selectedAdSet?.campaignId?.flowRef;
                if (adSetFlow) {
                  const flowName = flows.find(f => f.key === adSetFlow)?.name || adSetFlow;
                  return (
                    <p className="text-xs text-blue-400 mt-1">
                      Heredado de AdSet ({selectedAdSet.name}): {flowName}
                    </p>
                  );
                }
                if (campaignFlow) {
                  const flowName = flows.find(f => f.key === campaignFlow)?.name || campaignFlow;
                  return (
                    <p className="text-xs text-blue-400 mt-1">
                      Heredado de Campaña ({selectedAdSet?.campaignId?.name}): {flowName}
                    </p>
                  );
                }
                return (
                  <p className="text-xs text-gray-500 mt-1">
                    Fuerza un flujo de conversacion para este anuncio
                  </p>
                );
              })()}
            </div>

            {/* Creative Content */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adModal.creativeContent')}</h3>

              <div className="space-y-4">
                {/* Headline */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.headline')}
                  </label>
                  <input
                    type="text"
                    name="headline"
                    value={formData.headline}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('adModal.headlinePlaceholder')}
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.body')}
                  </label>
                  <textarea
                    name="body"
                    value={formData.body}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('adModal.bodyPlaceholder')}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.descriptionLabel')}
                  </label>
                  <input
                    type="text"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('adModal.descriptionPlaceholder')}
                  />
                </div>

                {/* Image URL & Video URL */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.imageUrl')}
                    </label>
                    <input
                      type="text"
                      name="imageUrl"
                      value={formData.imageUrl}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('adModal.imageUrlPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.videoUrl')}
                    </label>
                    <input
                      type="text"
                      name="videoUrl"
                      value={formData.videoUrl}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.callToActionLabel')}
                    </label>
                    <select
                      name="callToAction"
                      value={formData.callToAction}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="LEARN_MORE">{t('adModal.ctaLearnMore')}</option>
                      <option value="SHOP_NOW">{t('adModal.ctaShopNow')}</option>
                      <option value="SIGN_UP">{t('adModal.ctaSignUp')}</option>
                      <option value="CONTACT_US">{t('adModal.ctaContactUs')}</option>
                      <option value="GET_QUOTE">{t('adModal.ctaGetQuote')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.destinationUrl')}
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
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adModal.botCustomization')}</h3>
              <p className="text-xs text-gray-400 mb-4">
                {t('adModal.botCustomizationHint')}
              </p>

              <div className="space-y-4">
                {/* Ad Angle */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.adAngle')}
                  </label>
                  <select
                    name="adAngle"
                    value={formData.adAngle}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">{t('adModal.noAngle')}</option>
                    {AD_ANGLES.map(a => (
                      <option key={a.value} value={a.value}>{a.label} - {a.desc}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Primary Use */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.primaryUse')}
                    </label>
                    <input
                      type="text"
                      name="primaryUse"
                      value={formData.primaryUse}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('adModal.primaryUsePlaceholder')}
                    />
                  </div>

                  {/* Audience Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('adModal.audienceTypeLabel')}
                    </label>
                    <input
                      type="text"
                      name="audienceType"
                      value={formData.audienceType}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('adModal.audienceTypePlaceholder')}
                    />
                  </div>
                </div>

                {/* Offer Hook */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.offerHookLabel')}
                  </label>
                  <input
                    type="text"
                    name="offerHook"
                    value={formData.offerHook}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('adModal.offerHookPlaceholder')}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {t('adModal.offerHookHint')}
                  </p>
                </div>
              </div>
            </div>

            {/* Products Selection */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adModal.associatedProducts')}</h3>
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
                {t('adModal.productsNote')}
              </p>

              {/* Main Product Selection */}
              {formData.productIds.length > 0 && (
                <div className="mt-4 p-3 bg-gray-900/30 rounded-lg border border-gray-700/50">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adModal.mainProduct')}
                  </label>
                  <select
                    name="mainProductId"
                    value={formData.mainProductId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">{t('adModal.useFirstProduct')}</option>
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
                    {t('adModal.mainProductHint')}
                  </p>
                </div>
              )}
            </div>

            {/* Tracking (UTMs) */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adModal.tracking')}</h3>
              <p className="text-xs text-gray-400 mb-3">{t('adModal.trackingHint')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('adModal.utmSource')}</label>
                  <input
                    type="text"
                    name="utmSource"
                    value={formData.utmSource}
                    onChange={handleChange}
                    className="w-full px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="facebook"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('adModal.utmMedium')}</label>
                  <input
                    type="text"
                    name="utmMedium"
                    value={formData.utmMedium}
                    onChange={handleChange}
                    className="w-full px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="cpc"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('adModal.utmCampaign')}</label>
                  <input
                    type="text"
                    name="utmCampaign"
                    value={formData.utmCampaign}
                    onChange={handleChange}
                    className="w-full px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="spring_sale"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('adModal.utmContent')}</label>
                  <input
                    type="text"
                    name="utmContent"
                    value={formData.utmContent}
                    onChange={handleChange}
                    className="w-full px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="banner_v2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('adModal.utmTerm')}</label>
                  <input
                    type="text"
                    name="utmTerm"
                    value={formData.utmTerm}
                    onChange={handleChange}
                    className="w-full px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="malla_sombra"
                  />
                </div>
              </div>
            </div>

            {/* Catalog Upload */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              {ad?._id ? (
                <CatalogUpload
                  entityType="ad"
                  entityId={ad._id}
                  currentCatalog={currentCatalog}
                  onUploadSuccess={(catalog) => { setCurrentCatalog(catalog); fetchExistingCatalogs(); }}
                  onDeleteSuccess={() => setCurrentCatalog(null)}
                  existingCatalogs={existingCatalogs}
                  onSelectExisting={async (cat) => {
                    try {
                      const res = await fetch(`${API_URL}/uploads/catalog/ad/${ad._id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: cat.url, name: cat.name })
                      });
                      const data = await res.json();
                      if (data.success) setCurrentCatalog(data.data.catalog);
                    } catch (err) { console.error('Error assigning catalog:', err); }
                  }}
                  inheritedFrom={(() => {
                    if (currentCatalog) return null;
                    // Climb: AdSet → Campaign → Global
                    if (ad.adSetId?.catalog?.url) return `AdSet: ${ad.adSetId?.name}`;
                    if (ad.adSetId?.campaignId?.catalog?.url) return `Campaña: ${ad.adSetId?.campaignId?.name}`;
                    if (globalCatalog?.url) return 'Catálogo Global';
                    return null;
                  })()}
                  inheritedCatalog={(() => {
                    if (currentCatalog) return null;
                    if (ad.adSetId?.catalog?.url) return ad.adSetId.catalog;
                    if (ad.adSetId?.campaignId?.catalog?.url) return ad.adSetId.campaignId.catalog;
                    if (globalCatalog?.url) return globalCatalog;
                    return null;
                  })()}
                />
              ) : (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                  <p className="text-amber-400 text-sm">
                    {t('adModal.catalogSaveFirst')}
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
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {ad ? t('adModal.updateAd') : t('common.create')} {t('common.ad')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdModal;
