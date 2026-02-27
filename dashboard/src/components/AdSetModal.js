import React, { useState, useEffect } from 'react';
import ProductTreeSelector from './ProductTreeSelector';
import CatalogUpload from './CatalogUpload';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const AUDIENCE_TYPES = [
  { value: 'homeowner', label: 'Hogar/Jardín' },
  { value: 'farmer', label: 'Agricultor' },
  { value: 'greenhouse', label: 'Invernadero/Vivero' },
  { value: 'business', label: 'Negocio' },
  { value: 'contractor', label: 'Instalador/Contratista' },
  { value: 'reseller', label: 'Revendedor' }
];

const EXPERIENCE_LEVELS = [
  { value: 'beginner', label: 'Principiante' },
  { value: 'practical', label: 'Práctico' },
  { value: 'expert', label: 'Experto' }
];

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

const CTA_OPTIONS = [
  { value: '', label: 'Sin CTA' },
  { value: 'SEND_MESSAGE', label: 'Enviar mensaje' },
  { value: 'GET_QUOTE', label: 'Cotizar ahora' },
  { value: 'LEARN_MORE', label: 'Más información' },
  { value: 'SHOP_NOW', label: 'Comprar ahora' },
  { value: 'GET_OFFER', label: 'Obtener oferta' },
  { value: 'CONTACT_US', label: 'Contáctanos' },
  { value: 'ORDER_NOW', label: 'Ordenar ahora' },
  { value: 'SIGN_UP', label: 'Registrarse' }
];

const OFFER_HOOK_OPTIONS = [
  { value: '', label: 'Sin oferta' },
  { value: 'envio_gratis', label: 'Envío gratis (productos seleccionados)' },
  { value: 'entrega_24_48', label: 'Entrega en 24-48 hrs (productos seleccionados)' },
  { value: 'envio_mex_usa', label: 'Envío a todo México y Estados Unidos' },
  { value: 'precio_mayoreo', label: 'Precio de mayoreo' },
  { value: 'precio_fabrica', label: 'Precio especial de Fábrica' },
  { value: 'precio_mayoristas', label: 'Precio especial a mayoristas' },
  { value: 'descuento_50', label: '50% descuento' },
  { value: 'descuento_temporada', label: '10% descuento por temporada' },
  { value: 'meses_sin_intereses', label: 'Hasta 12 meses sin intereses' },
  { value: 'pago_seguro', label: 'Pago seguro' },
  { value: 'variedad_medidas', label: 'Variedad de medidas' },
  { value: 'asesoria', label: 'Asesoría profesional' },
  { value: 'resenas_favorables', label: 'Reseñas favorables de miles de clientes' },
  { value: 'oferta_limitada', label: 'Oferta por tiempo limitado' }
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

function AdSetModal({ adSet, campaigns, parentCampaignId, onSave, onClose }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    fbAdSetId: '',
    campaignId: parentCampaignId || '',
    status: 'ACTIVE',
    optimizationGoal: 'LINK_CLICKS',
    billingEvent: 'IMPRESSIONS',
    dailyBudget: '',
    locations: 'Mexico',
    ageMin: '25',
    ageMax: '60',
    genders: '',
    interests: '',
    behaviors: '',
    customAudiences: '',
    placements: 'facebook_feed,instagram_feed',
    productIds: [],
    flowRef: '',
    audienceType: '',
    experienceLevel: '',
    adAngle: '',
    adSummary: '',
    adCta: '',
    adOfferHook: ''
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [flows, setFlows] = useState([]);
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
        genders: adSet.targeting?.genders?.join(', ') || '',
        interests: adSet.targeting?.interests?.join(', ') || '',
        behaviors: adSet.targeting?.behaviors?.join(', ') || '',
        customAudiences: adSet.targeting?.customAudiences?.join(', ') || '',
        placements: adSet.placements?.join(',') || 'facebook_feed,instagram_feed',
        productIds: adSet.productIds?.map(p => p._id || p) || [],
        flowRef: adSet.flowRef || '',
        audienceType: adSet.audience?.type || '',
        experienceLevel: adSet.audience?.experienceLevel || '',
        adAngle: adSet.adContext?.angle || '',
        adSummary: adSet.adContext?.summary || '',
        adCta: adSet.adContext?.cta || '',
        adOfferHook: adSet.adContext?.offerHook || ''
      });
      setCurrentCatalog(adSet.catalog || null);
    }
  }, [adSet]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Filter to only include sellable products
    const allSellableIds = collectSellableProductIds(productFamilies);
    const sellableProductIds = formData.productIds.filter(id => allSellableIds.includes(id));

    const payload = {
      name: formData.name,
      fbAdSetId: formData.fbAdSetId,
      campaignId: formData.campaignId,
      status: formData.status,
      optimizationGoal: formData.optimizationGoal,
      billingEvent: formData.billingEvent,
      dailyBudget: formData.dailyBudget ? parseFloat(formData.dailyBudget) : undefined,
      productIds: sellableProductIds, // Only save sellable products
      flowRef: formData.flowRef || null,
      audience: {
        type: formData.audienceType || null,
        experienceLevel: formData.experienceLevel || null
      },
      adContext: {
        angle: formData.adAngle || null,
        summary: formData.adSummary || null,
        cta: formData.adCta || null,
        offerHook: formData.adOfferHook || null
      },
      targeting: {
        locations: formData.locations.split(',').map(l => l.trim()),
        ageMin: parseInt(formData.ageMin),
        ageMax: parseInt(formData.ageMax),
        genders: formData.genders.split(',').map(g => g.trim()).filter(Boolean),
        interests: formData.interests.split(',').map(i => i.trim()).filter(Boolean),
        behaviors: formData.behaviors.split(',').map(b => b.trim()).filter(Boolean),
        customAudiences: formData.customAudiences.split(',').map(c => c.trim()).filter(Boolean)
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
            {adSet ? t('adSetModal.edit') : t('adSets.addAdSet')}
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
                  {t('adSetModal.name')} *
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
                  {t('adSetModal.fbAdSetId')} *
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
                {t('adSetModal.campaign')} *
              </label>
              <select
                name="campaignId"
                value={formData.campaignId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('adSetModal.selectCampaignOption')}</option>
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
                  {t('adSetModal.status')}
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="ACTIVE">{t('adSetModal.statusActive')}</option>
                  <option value="PAUSED">{t('adSetModal.statusPaused')}</option>
                  <option value="ARCHIVED">{t('adSetModal.statusArchived')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.dailyBudget')}
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
                const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                const campaignFlow = selectedCampaign?.flowRef;
                if (campaignFlow) {
                  const flowName = flows.find(f => f.key === campaignFlow)?.name || campaignFlow;
                  return (
                    <p className="text-xs text-blue-400 mt-1">
                      Heredado de Campaña ({selectedCampaign.name}): {flowName}
                    </p>
                  );
                }
                return (
                  <p className="text-xs text-gray-500 mt-1">
                    Fuerza un flujo de conversacion para los anuncios de este ad set
                  </p>
                );
              })()}
            </div>

            {/* Audiencia */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Audiencia</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tipo de audiencia
                  </label>
                  <select
                    name="audienceType"
                    value={formData.audienceType}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Sin especificar</option>
                    {AUDIENCE_TYPES.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                  {!formData.audienceType && (() => {
                    const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                    const campaignAudienceType = selectedCampaign?.audience?.type;
                    if (campaignAudienceType) {
                      const label = AUDIENCE_TYPES.find(a => a.value === campaignAudienceType)?.label || campaignAudienceType;
                      return (
                        <p className="text-xs text-blue-400 mt-1">
                          Heredado de Campaña ({selectedCampaign.name}): {label}
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Nivel de experiencia
                  </label>
                  <select
                    name="experienceLevel"
                    value={formData.experienceLevel}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Sin especificar</option>
                    {EXPERIENCE_LEVELS.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                  {!formData.experienceLevel && (() => {
                    const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                    const campaignExpLevel = selectedCampaign?.audience?.experienceLevel;
                    if (campaignExpLevel) {
                      const label = EXPERIENCE_LEVELS.find(l => l.value === campaignExpLevel)?.label || campaignExpLevel;
                      return (
                        <p className="text-xs text-blue-400 mt-1">
                          Heredado de Campaña ({selectedCampaign.name}): {label}
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            </div>

            {/* Contexto del Anuncio */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Contexto del Anuncio</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Angulo del anuncio
                  </label>
                  <select
                    name="adAngle"
                    value={formData.adAngle}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Sin especificar</option>
                    {AD_ANGLES.map(a => (
                      <option key={a.value} value={a.value}>{a.label} - {a.desc}</option>
                    ))}
                  </select>
                  {!formData.adAngle && (() => {
                    const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                    const campaignAngle = selectedCampaign?.ad?.angle;
                    if (campaignAngle) {
                      const label = AD_ANGLES.find(a => a.value === campaignAngle)?.label || campaignAngle;
                      return (
                        <p className="text-xs text-blue-400 mt-1">
                          Heredado de Campaña ({selectedCampaign.name}): {label}
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Resumen del anuncio
                  </label>
                  <textarea
                    name="adSummary"
                    value={formData.adSummary}
                    onChange={handleChange}
                    rows={2}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Ej: Malla sombra al mejor precio con envío gratis"
                  />
                  {!formData.adSummary && (() => {
                    const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                    const campaignSummary = selectedCampaign?.ad?.summary;
                    if (campaignSummary) {
                      return (
                        <p className="text-xs text-blue-400 mt-1">
                          Heredado de Campaña ({selectedCampaign.name}): {campaignSummary}
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      CTA
                    </label>
                    <select
                      name="adCta"
                      value={formData.adCta}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {CTA_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {!formData.adCta && (() => {
                      const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                      const campaignCta = selectedCampaign?.ad?.cta;
                      if (campaignCta) {
                        const label = CTA_OPTIONS.find(o => o.value === campaignCta)?.label || campaignCta;
                        return (
                          <p className="text-xs text-blue-400 mt-1">
                            Heredado de Campaña ({selectedCampaign.name}): {label}
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Oferta / Hook
                    </label>
                    <select
                      name="adOfferHook"
                      value={formData.adOfferHook}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {OFFER_HOOK_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {!formData.adOfferHook && (() => {
                      const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                      const campaignHook = selectedCampaign?.ad?.offerHook;
                      if (campaignHook) {
                        const label = OFFER_HOOK_OPTIONS.find(o => o.value === campaignHook)?.label || campaignHook;
                        return (
                          <p className="text-xs text-blue-400 mt-1">
                            Heredado de Campaña ({selectedCampaign.name}): {label}
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Targeting */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adSetModal.targeting')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('adSetModal.locations')}
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
                      {t('adSetModal.ageMin')}
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
                      {t('adSetModal.ageMax')}
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

              {/* Genders */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.genders')}
                </label>
                <input
                  type="text"
                  name="genders"
                  value={formData.genders}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('adSetModal.gendersPlaceholder')}
                />
              </div>

              {/* Interests */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.interests')}
                </label>
                <input
                  type="text"
                  name="interests"
                  value={formData.interests}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('adSetModal.interestsPlaceholder')}
                />
              </div>

              {/* Behaviors */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.behaviors')}
                </label>
                <input
                  type="text"
                  name="behaviors"
                  value={formData.behaviors}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('adSetModal.behaviorsPlaceholder')}
                />
              </div>

              {/* Custom Audiences */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.customAudiences')}
                </label>
                <input
                  type="text"
                  name="customAudiences"
                  value={formData.customAudiences}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('adSetModal.customAudiencesPlaceholder')}
                />
              </div>
            </div>

            {/* Optimization */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('adSetModal.optimizationGoal')}
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
                  {t('adSetModal.billingEvent')}
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
                {t('adSetModal.placements')}
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
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adSetModal.associatedProducts')}</h3>
              {(() => {
                const selectedCampaign = campaigns.find(c => c._id === formData.campaignId);
                const inheritedProductIds = selectedCampaign?.productIds?.map(p => p._id || p) || [];
                return (
                  <ProductTreeSelector
                    selectedProducts={formData.productIds}
                    inheritedProducts={inheritedProductIds}
                    inheritedFrom={selectedCampaign ? `Campaña: ${selectedCampaign.name}` : null}
                    onToggle={handleProductToggle}
                    products={productFamilies}
                    loading={productsLoading}
                  />
                );
              })()}
              <p className="text-xs text-gray-400 mt-2">
                {t('adSetModal.productsNote')}
              </p>
            </div>

            {/* Catalog Upload */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              {adSet?._id ? (
                <CatalogUpload
                  entityType="adset"
                  entityId={adSet._id}
                  currentCatalog={currentCatalog}
                  onUploadSuccess={(catalog) => { setCurrentCatalog(catalog); fetchExistingCatalogs(); }}
                  onDeleteSuccess={() => setCurrentCatalog(null)}
                  existingCatalogs={existingCatalogs}
                  onSelectExisting={async (cat) => {
                    try {
                      const res = await fetch(`${API_URL}/uploads/catalog/adset/${adSet._id}`, {
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
                    if (adSet.campaignId?.catalog?.url) return `Campaña: ${adSet.campaignId?.name || 'Padre'}`;
                    if (globalCatalog?.url) return 'Catálogo Global';
                    return null;
                  })()}
                  inheritedCatalog={(() => {
                    if (currentCatalog) return null;
                    if (adSet.campaignId?.catalog?.url) return adSet.campaignId.catalog;
                    if (globalCatalog?.url) return globalCatalog;
                    return null;
                  })()}
                />
              ) : (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                  <p className="text-amber-400 text-sm">
                    {t('adSetModal.saveCatalogFirst')}
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
            {adSet ? t('adSetModal.update') : t('common.create')} Ad Set
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdSetModal;
