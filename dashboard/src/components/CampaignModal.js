import React, { useState, useEffect } from 'react';
import ProductTreeSelector from './ProductTreeSelector';

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
  { value: 'problem_pain', label: 'Problema/Dolor', desc: 'Evita quemaduras en tus cultivos' },
  { value: 'price_value', label: 'Precio/Valor', desc: 'Desde $320' },
  { value: 'quality', label: 'Calidad', desc: 'La mejor malla del mercado' },
  { value: 'urgency', label: 'Urgencia', desc: 'Últimas piezas' },
  { value: 'social_proof', label: 'Prueba Social', desc: 'Miles de clientes satisfechos' },
  { value: 'convenience', label: 'Conveniencia', desc: 'Envío gratis a todo México' }
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

const DEFAULT_MUST_NOT = [
  'inventar precios',
  'prometer disponibilidad sin confirmar',
  'ofrecer descuentos no autorizados'
];

const DEFAULT_SHOULD_DO = [
  'confirmar el producto de interés',
  'preguntar medidas si aplica',
  'ofrecer ayuda de asesor si es necesario'
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
      tone: 'claro, directo y útil',
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

    // Legacy product IDs
    productIds: [],

    // New campaign products
    products: []
  });

  const [productFamilies, setProductFamilies] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  // New rule inputs
  const [newMustNot, setNewMustNot] = useState('');
  const [newShouldDo, setNewShouldDo] = useState('');

  // New campaign product
  const [newProduct, setNewProduct] = useState({
    sku: '',
    name: '',
    category: '',
    primaryBenefit: '',
    commonUses: '',
    soldBy: '',
    requiresQuote: false,
    mlLink: ''
  });

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
          tone: campaign.responseGuidelines?.tone || 'claro, directo y útil',
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

        productIds: campaign.productIds?.map(p => p._id || p) || [],
        products: campaign.products || []
      });
    }
  }, [campaign]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!campaign && (!formData.ref || formData.ref.trim() === '')) {
      alert('Por favor ingresa un valor para el campo "Ref"');
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

    onSave(dataToSave);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData({
      ...formData,
      [parent]: {
        ...formData[parent],
        [field]: value
      }
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
      setFormData({
        ...formData,
        responseGuidelines: {
          ...formData.responseGuidelines,
          mustNot: [...formData.responseGuidelines.mustNot, newMustNot.trim()]
        }
      });
      setNewMustNot('');
    }
  };

  const removeMustNot = (index) => {
    setFormData({
      ...formData,
      responseGuidelines: {
        ...formData.responseGuidelines,
        mustNot: formData.responseGuidelines.mustNot.filter((_, i) => i !== index)
      }
    });
  };

  const addShouldDo = () => {
    if (newShouldDo.trim()) {
      setFormData({
        ...formData,
        responseGuidelines: {
          ...formData.responseGuidelines,
          shouldDo: [...formData.responseGuidelines.shouldDo, newShouldDo.trim()]
        }
      });
      setNewShouldDo('');
    }
  };

  const removeShouldDo = (index) => {
    setFormData({
      ...formData,
      responseGuidelines: {
        ...formData.responseGuidelines,
        shouldDo: formData.responseGuidelines.shouldDo.filter((_, i) => i !== index)
      }
    });
  };

  // Campaign Products management
  const addCampaignProduct = () => {
    if (newProduct.sku && newProduct.name) {
      const productToAdd = {
        sku: newProduct.sku,
        name: newProduct.name,
        category: newProduct.category || undefined,
        primaryBenefit: newProduct.primaryBenefit || undefined,
        commonUses: newProduct.commonUses ? newProduct.commonUses.split(',').map(s => s.trim()) : [],
        constraints: {
          soldBy: newProduct.soldBy || undefined,
          requiresQuote: newProduct.requiresQuote
        },
        mlLink: newProduct.mlLink || undefined
      };

      setFormData({
        ...formData,
        products: [...formData.products, productToAdd]
      });

      setNewProduct({
        sku: '',
        name: '',
        category: '',
        primaryBenefit: '',
        commonUses: '',
        soldBy: '',
        requiresQuote: false,
        mlLink: ''
      });
    }
  };

  const removeCampaignProduct = (index) => {
    setFormData({
      ...formData,
      products: formData.products.filter((_, i) => i !== index)
    });
  };

  const tabs = [
    { id: 'basic', label: 'Básico' },
    { id: 'ad', label: 'Anuncio' },
    { id: 'audience', label: 'Audiencia' },
    { id: 'products', label: 'Productos' },
    { id: 'guidelines', label: 'Guías IA' },
    { id: 'facebook', label: 'Facebook' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {campaign ? 'Editar Campaña' : 'Nueva Campaña'}
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
              onClick={() => setActiveTab(tab.id)}
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Referencia (Ref) *</label>
                  <input
                    type="text"
                    name="ref"
                    value={formData.ref}
                    onChange={handleChange}
                    required
                    disabled={!!campaign}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    placeholder="malla_agricola_2025"
                  />
                  <p className="text-xs text-gray-500 mt-1">URL: ?ref=valor</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Nombre *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Malla Sombra Agrícola"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Descripción</label>
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
                  <label className="block text-sm font-medium text-gray-300 mb-2">Fuente de Tráfico</label>
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
                  <label className="block text-sm font-medium text-gray-300 mb-2">Meta de Conversación</label>
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
                  <label className="block text-sm font-medium text-gray-300 mb-2">Estado</label>
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
                    <span className="text-sm font-medium text-gray-300">Activa</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Fecha Inicio</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Fecha Fin</label>
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
                <label className="block text-sm font-medium text-gray-300 mb-2">Mensaje Inicial</label>
                <textarea
                  name="initialMessage"
                  value={formData.initialMessage}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  placeholder="¡Hola! Vi que te interesa la malla sombra..."
                />
              </div>
            </div>
          )}

          {/* Ad Tab */}
          {activeTab === 'ad' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Ángulo del Anuncio</label>
                <select
                  value={formData.ad.angle}
                  onChange={(e) => handleNestedChange('ad', 'angle', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                >
                  <option value="">Seleccionar...</option>
                  {AD_ANGLES.map(a => (
                    <option key={a.value} value={a.value}>{a.label} - {a.desc}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Resumen del Anuncio</label>
                <textarea
                  value={formData.ad.summary}
                  onChange={(e) => handleNestedChange('ad', 'summary', e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  placeholder="Protección solar para evitar quemaduras en cultivos"
                />
                <p className="text-xs text-gray-500 mt-1">Breve descripción del mensaje del anuncio</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Call to Action (CTA)</label>
                  <input
                    type="text"
                    value={formData.ad.cta}
                    onChange={(e) => handleNestedChange('ad', 'cta', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                    placeholder="Cotizar ahora"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Oferta/Gancho</label>
                  <input
                    type="text"
                    value={formData.ad.offerHook}
                    onChange={(e) => handleNestedChange('ad', 'offerHook', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                    placeholder="Envío gratis, 20% descuento, Desde $320"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audience Tab */}
          {activeTab === 'audience' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Tipo de Audiencia</label>
                  <select
                    value={formData.audience.type}
                    onChange={(e) => handleNestedChange('audience', 'type', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="">Seleccionar...</option>
                    {AUDIENCE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Nivel de Experiencia</label>
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
                <h4 className="text-sm font-medium text-gray-300 mb-2">Nota sobre la audiencia</h4>
                <p className="text-xs text-gray-500">
                  El tipo de audiencia ayuda al bot a ajustar el tono y las recomendaciones.
                  Por ejemplo, un agricultor recibe información técnica mientras que un hogar recibe consejos prácticos.
                </p>
              </div>
            </div>
          )}

          {/* Products Tab */}
          {activeTab === 'products' && (
            <div className="space-y-4">
              {/* Campaign Products (new) */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Productos de la Campaña (para IA)</h3>

                {formData.products.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {formData.products.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg">
                        <div>
                          <span className="font-medium text-white">{p.name}</span>
                          <span className="text-gray-500 text-sm ml-2">({p.sku})</span>
                          {p.constraints?.requiresQuote && (
                            <span className="ml-2 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">Requiere cotización</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCampaignProduct(idx)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new product form */}
                <div className="p-4 bg-gray-900/30 rounded-lg space-y-3">
                  <h4 className="text-sm font-medium text-gray-400">Agregar producto</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newProduct.sku}
                      onChange={(e) => setNewProduct({...newProduct, sku: e.target.value})}
                      placeholder="SKU (ej: MS-80-AGR)"
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                    />
                    <input
                      type="text"
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                      placeholder="Nombre"
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                    />
                  </div>
                  <input
                    type="text"
                    value={newProduct.primaryBenefit}
                    onChange={(e) => setNewProduct({...newProduct, primaryBenefit: e.target.value})}
                    placeholder="Beneficio principal"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newProduct.soldBy}
                      onChange={(e) => setNewProduct({...newProduct, soldBy: e.target.value})}
                      placeholder="Se vende por (metro, rollo, pieza)"
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                    />
                    <input
                      type="text"
                      value={newProduct.mlLink}
                      onChange={(e) => setNewProduct({...newProduct, mlLink: e.target.value})}
                      placeholder="Link ML (opcional)"
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newProduct.requiresQuote}
                        onChange={(e) => setNewProduct({...newProduct, requiresQuote: e.target.checked})}
                        className="w-4 h-4 rounded bg-gray-800 border-gray-700"
                      />
                      <span className="text-sm text-gray-400">Requiere cotización (no venta directa)</span>
                    </label>
                    <button
                      type="button"
                      onClick={addCampaignProduct}
                      className="px-3 py-1 bg-primary-500 text-white rounded text-sm hover:bg-primary-600"
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              </div>

              {/* Legacy ProductIds */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Productos del Catálogo (legacy)</h3>
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
                <label className="block text-sm font-medium text-gray-300 mb-2">Tono de Respuesta</label>
                <input
                  type="text"
                  value={formData.responseGuidelines.tone}
                  onChange={(e) => handleNestedChange('responseGuidelines', 'tone', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  placeholder="claro, directo y útil"
                />
              </div>

              {/* Must Not */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">El bot NO DEBE...</label>
                <div className="space-y-2 mb-2">
                  {formData.responseGuidelines.mustNot.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-red-900/20 border border-red-800/30 rounded">
                      <span className="text-red-300 text-sm">{rule}</span>
                      <button type="button" onClick={() => removeMustNot(idx)} className="text-red-400 hover:text-red-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newMustNot}
                    onChange={(e) => setNewMustNot(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addMustNot())}
                    placeholder="Agregar regla..."
                    className="flex-1 px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white text-sm"
                  />
                  <button type="button" onClick={addMustNot} className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
                    Agregar
                  </button>
                </div>
              </div>

              {/* Should Do */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">El bot DEBE...</label>
                <div className="space-y-2 mb-2">
                  {formData.responseGuidelines.shouldDo.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-green-900/20 border border-green-800/30 rounded">
                      <span className="text-green-300 text-sm">{rule}</span>
                      <button type="button" onClick={() => removeShouldDo(idx)} className="text-green-400 hover:text-green-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newShouldDo}
                    onChange={(e) => setNewShouldDo(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addShouldDo())}
                    placeholder="Agregar regla..."
                    className="flex-1 px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-white text-sm"
                  />
                  <button type="button" onClick={addShouldDo} className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Facebook Tab */}
          {activeTab === 'facebook' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">FB Campaign ID</label>
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
                  <label className="block text-sm font-medium text-gray-300 mb-2">FB Ad Account ID</label>
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
                  <label className="block text-sm font-medium text-gray-300 mb-2">Objetivo</label>
                  <select
                    name="objective"
                    value={formData.objective}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="OUTCOME_TRAFFIC">Tráfico</option>
                    <option value="OUTCOME_LEADS">Leads</option>
                    <option value="OUTCOME_SALES">Ventas</option>
                    <option value="OUTCOME_ENGAGEMENT">Engagement</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Presupuesto Diario ($)</label>
                  <input
                    type="number"
                    name="dailyBudget"
                    value={formData.dailyBudget}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Presupuesto Total ($)</label>
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
