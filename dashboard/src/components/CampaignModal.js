import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
import ProductTreeSelector from './ProductTreeSelector';
import CatalogUpload from './CatalogUpload';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Options for dropdowns
const TRAFFIC_SOURCES = [
  { value: 'facebook_ad', label: 'Facebook Ad' },
  { value: 'instagram_ad', label: 'Instagram Ad' },
  { value: 'google_ad', label: 'Google Ad' },
  { value: 'organic', label: 'Orgánico' },
  { value: 'referral', label: 'Referido' },
  { value: 'direct', label: 'Directo' }
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
  { value: '', label: 'Sin oferta', group: '' },
  // Shipping & Delivery
  { value: 'envio_gratis', label: 'Envío gratis (productos seleccionados)', group: 'Envío' },
  { value: 'entrega_24_48', label: 'Entrega en 24-48 hrs (productos seleccionados)', group: 'Envío' },
  { value: 'envio_mex_usa', label: 'Envío a todo México y Estados Unidos', group: 'Envío' },
  // Pricing
  { value: 'precio_mayoreo', label: 'Precio de mayoreo', group: 'Precio' },
  { value: 'precio_fabrica', label: 'Precio especial de Fábrica', group: 'Precio' },
  { value: 'precio_mayoristas', label: 'Precio especial a mayoristas', group: 'Precio' },
  // Discounts
  { value: 'descuento_50', label: '50% descuento', group: 'Descuento' },
  { value: 'descuento_temporada', label: '10% descuento por temporada', group: 'Descuento' },
  // Financing
  { value: 'meses_sin_intereses', label: 'Hasta 12 meses sin intereses', group: 'Financiamiento' },
  { value: 'pago_seguro', label: 'Pago seguro', group: 'Financiamiento' },
  // Value-add
  { value: 'variedad_medidas', label: 'Variedad de medidas', group: 'Valor agregado' },
  { value: 'asesoria', label: 'Asesoría profesional', group: 'Valor agregado' },
  { value: 'resenas_favorables', label: 'Reseñas favorables de miles de clientes', group: 'Valor agregado' },
  // Urgency
  { value: 'oferta_limitada', label: 'Oferta por tiempo limitado', group: 'Urgencia' }
];

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

const CONVERSATION_GOALS = [
  { value: 'cotizacion', label: 'Cotización', desc: 'Recopilar datos y pasar a humano' },
  { value: 'venta_directa', label: 'Venta Directa', desc: 'Enviar link de Mercado Libre' },
  { value: 'lead_capture', label: 'Captura de Lead', desc: 'Obtener datos de contacto' },
  { value: 'informacion', label: 'Información', desc: 'Solo informar' }
];

const TONE_OPTIONS = [
  { value: 'amigable', label: 'Amigable' },
  { value: 'profesional', label: 'Profesional' },
  { value: 'claro_directo', label: 'Claro y directo' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'empatico', label: 'Empático' }
];

const MUST_NOT_OPTIONS = [
  { value: 'inventar_precios', label: 'Inventar precios' },
  { value: 'prometer_disponibilidad', label: 'Prometer disponibilidad sin confirmar' },
  { value: 'descuentos_no_autorizados', label: 'Ofrecer descuentos no autorizados' },
  { value: 'mentir', label: 'Mentir' },
  { value: 'dar_info_incorrecta', label: 'Dar información incorrecta' },
  { value: 'ignorar_preguntas', label: 'Ignorar preguntas del cliente' },
  { value: 'ser_insistente', label: 'Ser demasiado insistente' },
  { value: 'hablar_competencia', label: 'Hablar mal de la competencia' },
  { value: 'prometer_tiempos', label: 'Prometer tiempos de entrega sin confirmar' }
];

const SHOULD_DO_OPTIONS = [
  { value: 'confirmar_producto', label: 'Confirmar el producto de interés' },
  { value: 'preguntar_medidas', label: 'Preguntar medidas si aplica' },
  { value: 'ofrecer_asesor', label: 'Ofrecer ayuda de asesor si es necesario' },
  { value: 'ayudar', label: 'Ayudar al cliente' },
  { value: 'ser_claro', label: 'Ser claro en las respuestas' },
  { value: 'dar_opciones', label: 'Dar opciones al cliente' },
  { value: 'confirmar_ubicacion', label: 'Confirmar ubicación para envío' },
  { value: 'preguntar_uso', label: 'Preguntar el uso que le dará al producto' },
  { value: 'ofrecer_alternativas', label: 'Ofrecer alternativas si no hay stock' },
  { value: 'agradecer', label: 'Agradecer al cliente' }
];

const DEFAULT_MUST_NOT = ['inventar_precios', 'prometer_disponibilidad', 'descuentos_no_autorizados'];
const DEFAULT_SHOULD_DO = ['confirmar_producto', 'preguntar_medidas', 'ofrecer_asesor'];

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
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    // Basic Info
    ref: '',
    name: '',
    description: '',
    active: true,
    status: 'ACTIVE',
    startDate: '',
    endDate: '',

    // Traffic Source
    trafficSource: 'facebook_ad',

    // Ad Context
    ad: {
      angle: '',
      summary: '',
      cta: '',
      offerHook: ''
    },

    // Audience
    audience: {
      type: '',
      experienceLevel: 'practical'
    },

    // Conversation Goal
    conversationGoal: 'cotizacion',

    // Response Guidelines
    responseGuidelines: {
      tone: 'claro_directo',
      mustNot: [...DEFAULT_MUST_NOT],
      shouldDo: [...DEFAULT_SHOULD_DO]
    },

    // Initial Messaging
    initialMessage: '',
    followupPrompts: [],

    // Facebook Integration
    fbCampaignId: '',
    fbAdAccountId: '',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudget: '',
    lifetimeBudget: '',

    // Product IDs from catalog
    productIds: []
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [currentCatalog, setCurrentCatalog] = useState(null);

  // New rule inputs
  const [newMustNot, setNewMustNot] = useState('');
  const [newShouldDo, setNewShouldDo] = useState('');

  // Existing catalogs for the picker dropdown
  const [existingCatalogs, setExistingCatalogs] = useState([]);
  const [catalogsFetched, setCatalogsFetched] = useState(false);


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

        trafficSource: campaign.trafficSource || 'facebook_ad',

        ad: {
          angle: campaign.ad?.angle || '',
          summary: campaign.ad?.summary || '',
          cta: campaign.ad?.cta || '',
          offerHook: campaign.ad?.offerHook || ''
        },

        audience: {
          type: campaign.audience?.type || '',
          experienceLevel: campaign.audience?.experienceLevel || 'practical'
        },

        conversationGoal: campaign.conversationGoal || 'cotizacion',

        responseGuidelines: {
          tone: campaign.responseGuidelines?.tone || 'claro_directo',
          mustNot: campaign.responseGuidelines?.mustNot || [...DEFAULT_MUST_NOT],
          shouldDo: campaign.responseGuidelines?.shouldDo || [...DEFAULT_SHOULD_DO]
        },

        initialMessage: campaign.initialMessage || '',
        followupPrompts: campaign.followupPrompts || [],

        fbCampaignId: campaign.fbCampaignId || '',
        fbAdAccountId: campaign.fbAdAccountId || '',
        objective: campaign.objective || 'OUTCOME_TRAFFIC',
        dailyBudget: campaign.dailyBudget || '',
        lifetimeBudget: campaign.lifetimeBudget || '',

        productIds: campaign.productIds?.map(p => p._id || p) || []
      });
      setCurrentCatalog(campaign.catalog || null);
    }
  }, [campaign]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!campaign && (!formData.ref || formData.ref.trim() === '')) {
      alert(t('campaignModal.refRequired'));
      return;
    }

    const allSellableIds = collectSellableProductIds(productFamilies);
    const sellableProductIds = formData.productIds.filter(id => allSellableIds.includes(id));

    const dataToSave = {
      ...formData,
      productIds: sellableProductIds
    };

    if (campaign) {
      delete dataToSave.ref;
    }

    console.log('=== CAMPAIGN MODAL SUBMIT ===');
    console.log('formData.ad:', JSON.stringify(formData.ad, null, 2));
    console.log('dataToSave.ad:', JSON.stringify(dataToSave.ad, null, 2));
    console.log('Full dataToSave:', JSON.stringify(dataToSave, null, 2));
    onSave(dataToSave);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleNestedChange = (parent, field, value) => {
    console.log(`handleNestedChange: ${parent}.${field} = "${value}"`);
    setFormData(prev => {
      const newState = {
        ...prev,
        [parent]: {
          ...prev[parent],
          [field]: value
        }
      };
      console.log(`New ${parent}:`, JSON.stringify(newState[parent], null, 2));
      return newState;
    });
  };

  const handleProductToggle = (productIds, isSelected) => {
    setFormData(prev => {
      if (isSelected) {
        return {
          ...prev,
          productIds: prev.productIds.filter(id => !productIds.includes(id))
        };
      } else {
        const newIds = productIds.filter(id => !prev.productIds.includes(id));
        return {
          ...prev,
          productIds: [...prev.productIds, ...newIds]
        };
      }
    });
  };

  // Add/Remove rules
  const addMustNot = () => {
    if (newMustNot.trim()) {
      setFormData(prev => ({
        ...prev,
        responseGuidelines: {
          ...prev.responseGuidelines,
          mustNot: [...prev.responseGuidelines.mustNot, newMustNot.trim()]
        }
      }));
      setNewMustNot('');
    }
  };

  const removeMustNot = (index) => {
    setFormData(prev => ({
      ...prev,
      responseGuidelines: {
        ...prev.responseGuidelines,
        mustNot: prev.responseGuidelines.mustNot.filter((_, i) => i !== index)
      }
    }));
  };

  const addShouldDo = () => {
    if (newShouldDo.trim()) {
      setFormData(prev => ({
        ...prev,
        responseGuidelines: {
          ...prev.responseGuidelines,
          shouldDo: [...prev.responseGuidelines.shouldDo, newShouldDo.trim()]
        }
      }));
      setNewShouldDo('');
    }
  };

  const removeShouldDo = (index) => {
    setFormData(prev => ({
      ...prev,
      responseGuidelines: {
        ...prev.responseGuidelines,
        shouldDo: prev.responseGuidelines.shouldDo.filter((_, i) => i !== index)
      }
    }));
  };


  const tabs = [
    { id: 'basic', label: t('campaignModal.tabBasic') },
    { id: 'ad', label: t('campaignModal.tabAd') },
    { id: 'audience', label: t('campaignModal.tabAudience') },
    { id: 'products', label: t('campaignModal.tabProducts') },
    { id: 'guidelines', label: t('campaignModal.tabGuidelines') },
    { id: 'catalog', label: t('campaignModal.tabCatalog') },
    { id: 'facebook', label: t('campaignModal.tabFacebook') }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {campaign ? t('campaignModal.edit') : t('campaigns.addCampaign')}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-2 border-b border-gray-700/50 flex space-x-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                // Fetch existing catalogs when catalog tab is opened
                if (tab.id === 'catalog' && !catalogsFetched) {
                  setCatalogsFetched(true);
                  fetch(`${API_URL}/uploads/catalogs`)
                    .then(r => r.json())
                    .then(data => {
                      if (data.success) {
                        // Filter out current campaign's own catalog
                        setExistingCatalogs(data.data.filter(c =>
                          !(c.entityType === 'Campaña' && c.entityId === campaign?._id)
                        ));
                      }
                    })
                    .catch(err => console.error('Error fetching catalogs:', err));
                }
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.refLabel')}</label>
                  <input
                    type="text"
                    name="ref"
                    value={formData.ref}
                    onChange={handleChange}
                    required
                    disabled={!!campaign}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    placeholder={t('campaignModal.refPlaceholder')}
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('campaignModal.refHint')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.nameRequired')}</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('campaignModal.namePlaceholderExample')}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('common.description')}</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={2}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.trafficSource')}</label>
                  <select
                    name="trafficSource"
                    value={formData.trafficSource}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {TRAFFIC_SOURCES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.conversationGoal')}</label>
                  <select
                    name="conversationGoal"
                    value={formData.conversationGoal}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {CONVERSATION_GOALS.map(g => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {CONVERSATION_GOALS.find(g => g.value === formData.conversationGoal)?.desc}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('common.status')}</label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="ACTIVE">{t('campaignModal.statusActive')}</option>
                    <option value="PAUSED">{t('campaignModal.statusPaused')}</option>
                    <option value="ARCHIVED">{t('campaignModal.statusArchived')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="active"
                      checked={formData.active}
                      onChange={handleChange}
                      className="w-5 h-5 rounded bg-gray-900/50 border-gray-700 text-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-300">{t('campaignModal.activeCheckbox')}</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.startDateLabel')}</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.endDateLabel')}</label>
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.initialMessage')}</label>
                <textarea
                  name="initialMessage"
                  value={formData.initialMessage}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  placeholder={t('campaignModal.initialMessagePlaceholder')}
                />
              </div>
            </div>
          )}

          {/* Ad Tab */}
          {activeTab === 'ad' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.adAngle')}</label>
                <select
                  value={formData.ad.angle}
                  onChange={(e) => handleNestedChange('ad', 'angle', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                >
                  <option value="">{t('campaignModal.selectOption')}</option>
                  {AD_ANGLES.map(a => (
                    <option key={a.value} value={a.value}>{a.label} - {a.desc}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.adSummary')}</label>
                <textarea
                  value={formData.ad.summary}
                  onChange={(e) => handleNestedChange('ad', 'summary', e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  placeholder={t('campaignModal.adSummaryPlaceholder')}
                />
                <p className="text-xs text-gray-500 mt-1">{t('campaignModal.adSummaryHint')}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.ctaLabel')}</label>
                  <select
                    value={formData.ad.cta}
                    onChange={(e) => handleNestedChange('ad', 'cta', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    {CTA_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.offerHook')}</label>
                  <select
                    value={formData.ad.offerHook}
                    onChange={(e) => handleNestedChange('ad', 'offerHook', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    {OFFER_HOOK_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Audience Tab */}
          {activeTab === 'audience' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.audienceType')}</label>
                  <select
                    value={formData.audience.type}
                    onChange={(e) => handleNestedChange('audience', 'type', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="">{t('campaignModal.selectOption')}</option>
                    {AUDIENCE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.experienceLevel')}</label>
                  <select
                    value={formData.audience.experienceLevel}
                    onChange={(e) => handleNestedChange('audience', 'experienceLevel', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    {EXPERIENCE_LEVELS.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-sm font-medium text-gray-300 mb-2">{t('campaignModal.audienceNoteTitle')}</h4>
                <p className="text-xs text-gray-500">
                  {t('campaignModal.audienceNoteText')}
                </p>
              </div>
            </div>
          )}

          {/* Products Tab */}
          {activeTab === 'products' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('campaignModal.productsTitle')}</h3>
                <p className="text-xs text-gray-500 mb-4">{t('campaignModal.productsHint')}</p>
                <ProductTreeSelector
                  selectedProducts={formData.productIds}
                  onToggle={handleProductToggle}
                  products={filterAvailableProducts(productFamilies)}
                  loading={productsLoading}
                />
              </div>
            </div>
          )}

          {/* Guidelines Tab */}
          {activeTab === 'guidelines' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.responseTone')}</label>
                <select
                  value={formData.responseGuidelines.tone}
                  onChange={(e) => handleNestedChange('responseGuidelines', 'tone', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                >
                  {TONE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Must Not */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.mustNot')}</label>
                <div className="space-y-2 mb-2">
                  {formData.responseGuidelines.mustNot.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-red-900/20 border border-red-800/30 rounded">
                      <span className="text-red-300 text-sm">{MUST_NOT_OPTIONS.find(o => o.value === rule)?.label || rule}</span>
                      <button type="button" onClick={() => removeMustNot(idx)} className="text-red-400 hover:text-red-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <select
                    value={newMustNot}
                    onChange={(e) => setNewMustNot(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white text-sm"
                  >
                    <option value="">{t('campaignModal.selectRule')}</option>
                    {MUST_NOT_OPTIONS.filter(opt => !formData.responseGuidelines.mustNot.includes(opt.value)).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={addMustNot} className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
                    {t('common.add')}
                  </button>
                </div>
              </div>

              {/* Should Do */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.shouldDo')}</label>
                <div className="space-y-2 mb-2">
                  {formData.responseGuidelines.shouldDo.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-green-900/20 border border-green-800/30 rounded">
                      <span className="text-green-300 text-sm">{SHOULD_DO_OPTIONS.find(o => o.value === rule)?.label || rule}</span>
                      <button type="button" onClick={() => removeShouldDo(idx)} className="text-green-400 hover:text-green-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <select
                    value={newShouldDo}
                    onChange={(e) => setNewShouldDo(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white text-sm"
                  >
                    <option value="">{t('campaignModal.selectRule')}</option>
                    {SHOULD_DO_OPTIONS.filter(opt => !formData.responseGuidelines.shouldDo.includes(opt.value)).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={addShouldDo} className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                    {t('common.add')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Catalog Tab */}
          {activeTab === 'catalog' && (
            <div className="space-y-4">
              {campaign?._id ? (
                <CatalogUpload
                  entityType="campaign"
                  entityId={campaign._id}
                  currentCatalog={currentCatalog}
                  onUploadSuccess={(catalog) => setCurrentCatalog(catalog)}
                  onDeleteSuccess={() => setCurrentCatalog(null)}
                  existingCatalogs={existingCatalogs}
                  onSelectExisting={async ({ url, name }) => {
                    try {
                      const response = await fetch(`${API_URL}/uploads/catalog/campaign/${campaign._id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url, name })
                      });
                      const data = await response.json();
                      if (data.success) {
                        setCurrentCatalog(data.data.catalog);
                      }
                    } catch (err) {
                      console.error('Error assigning existing catalog:', err);
                    }
                  }}
                />
              ) : (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                  <p className="text-amber-400 text-sm">
                    {t('campaignModal.catalogSaveFirst')}
                  </p>
                </div>
              )}
              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-sm font-medium text-gray-300 mb-2">{t('campaignModal.catalogNoteTitle')}</h4>
                <p className="text-xs text-gray-500">
                  {t('campaignModal.catalogNoteText')}
                </p>
              </div>
            </div>
          )}

          {/* Facebook Tab */}
          {activeTab === 'facebook' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.fbCampaignId')}</label>
                  <input
                    type="text"
                    name="fbCampaignId"
                    value={formData.fbCampaignId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                    placeholder="120226050770160686"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.fbAdAccountId')}</label>
                  <input
                    type="text"
                    name="fbAdAccountId"
                    value={formData.fbAdAccountId}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                    placeholder="act_123456789"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.objectiveLabel')}</label>
                  <select
                    name="objective"
                    value={formData.objective}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="OUTCOME_TRAFFIC">{t('campaignModal.objectiveTraffic')}</option>
                    <option value="OUTCOME_LEADS">{t('campaignModal.objectiveLeads')}</option>
                    <option value="OUTCOME_SALES">{t('campaignModal.objectiveSales')}</option>
                    <option value="OUTCOME_ENGAGEMENT">{t('campaignModal.objectiveEngagement')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.dailyBudget')}</label>
                  <input
                    type="number"
                    name="dailyBudget"
                    value={formData.dailyBudget}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('campaignModal.lifetimeBudget')}</label>
                  <input
                    type="number"
                    name="lifetimeBudget"
                    value={formData.lifetimeBudget}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Modal Footer - inside form */}
          <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-2 mt-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              {campaign ? t('campaignModal.update') : t('common.create')} {t('common.campaign')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CampaignModal;
