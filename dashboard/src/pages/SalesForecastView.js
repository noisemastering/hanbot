import React, { useState, useEffect, useMemo, useCallback } from 'react';
import API from '../api';
import {
  ComposedChart, Bar, Line, Area, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function SalesForecastView() {
  // ── WIZARD STATE ──
  const [wizardStep, setWizardStep] = useState(1); // 1 = product picker
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState({
    productFamilyId: '',
    productName: 'Global',
    productPath: '',
    channel: 'ml',
    campaignId: '',
    seasonality: false,
    days: 90
  });

  // ── Product tree navigation (same pattern as FlowWizard) ──
  const [families, setFamilies] = useState([]);
  const [navStack, setNavStack] = useState([]);
  const [currentChildren, setCurrentChildren] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState({ id: '', name: 'Global' }); // '' = global

  // ── DATA STATE ──
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  // Fetch product families tree on mount
  useEffect(() => {
    fetch(`${API_URL}/product-families/tree`).then(r => r.json()).then(res => {
      if (res.success) {
        const roots = (res.data || []).filter(f => !f.parentId && !f.sellable);
        setFamilies(roots);
        setCurrentChildren(roots);
      }
    }).catch(() => {});

    setCampaignsLoading(true);
    API.get('/ml/forecast-v2/campaigns').then(res => {
      setCampaigns(res.data?.data || []);
    }).catch(() => {}).finally(() => setCampaignsLoading(false));
  }, []);

  // Fetch children for a node
  const fetchChildren = async (familyId) => {
    try {
      const res = await fetch(`${API_URL}/product-families/${familyId}/children`);
      const data = await res.json();
      if (data.success) return data.data || [];
    } catch {}
    return [];
  };

  // Drill into a family
  const drillInto = async (family) => {
    let children = family.children || await fetchChildren(family._id);
    const nonSellable = children.filter(c => !c.sellable);
    setNavStack(prev => [...prev, { id: family._id, name: family.name }]);
    setCurrentChildren(nonSellable);
  };

  // Navigate back
  const navigateBack = (toIndex) => {
    if (toIndex < 0) {
      setNavStack([]);
      setCurrentChildren(families);
      return;
    }
    const newStack = navStack.slice(0, toIndex);
    setNavStack(newStack);
    const targetId = navStack[toIndex].id;
    const targetFamily = families.find(f => f._id === targetId);
    if (targetFamily?.children) {
      setCurrentChildren(targetFamily.children.filter(c => !c.sellable));
    } else {
      fetchChildren(targetId).then(children => {
        setCurrentChildren(children.filter(c => !c.sellable));
      });
    }
  };

  // Select a product level
  const selectProduct = (id, name) => {
    const pathName = [...navStack.map(n => n.name), name].filter(Boolean).join(' › ');
    setSelectedProduct({ id, name });
    setConfig(c => ({ ...c, productFamilyId: id, productName: name, productPath: pathName }));
  };

  // Select Global
  const selectGlobal = () => {
    setNavStack([]);
    setCurrentChildren(families);
    setSelectedProduct({ id: '', name: 'Global' });
    setConfig(c => ({ ...c, productFamilyId: '', productName: 'Global', productPath: '' }));
  };

  const generateForecast = useCallback(async () => {
    setLoading(true);
    setConfigured(true);
    try {
      const params = new URLSearchParams({
        days: config.days.toString(),
        channel: config.channel,
        seasonality: config.seasonality.toString()
      });
      if (config.productFamilyId) {
        params.set('productFamilyId', config.productFamilyId);
        params.set('includeSubfamilies', 'true');
      }
      if (config.channel === 'campaigns' && config.campaignId) {
        params.set('campaignId', config.campaignId);
      }
      const res = await API.get(`/ml/forecast-v2?${params.toString()}`);
      setData(res.data?.data || null);
    } catch (err) {
      console.error('Forecast error:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [config]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.history.map(d => ({ ...d, forecast: null, upper: null, lower: null })),
      ...data.forecast.map(d => ({ dateLabel: d.dateLabel, dow: d.dow, revenue: null, movingAvg: null, forecast: d.revenue, upper: d.upper, lower: d.lower, orders: d.orders }))
    ];
  }, [data]);

  const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  // ── WIZARD CONFIG PANEL ──
  const configPanel = (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-6">
      {/* Step indicator */}
      <div className="flex gap-1 mb-6">
        {[{ n: 1, label: 'Producto' }, { n: 2, label: 'Canal' }, { n: 3, label: 'Periodo' }].map(s => (
          <div key={s.n} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            wizardStep === s.n ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' :
            wizardStep > s.n ? 'bg-green-500/10 text-green-400' : 'bg-gray-700/30 text-gray-500'
          }`}>
            <span>{wizardStep > s.n ? '✓' : s.n}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step 1: Product picker */}
      {wizardStep === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">¿Para qué producto es la proyección?</h3>

          {/* Global option */}
          <button onClick={() => { selectGlobal(); setWizardStep(2); }}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              selectedProduct.id === '' && navStack.length === 0 ? 'bg-primary-500/10 border-primary-500/50' : 'bg-gray-900/30 border-gray-700/50 hover:border-gray-600'
            }`}>
            <p className="text-sm font-medium text-white">Global</p>
            <p className="text-xs text-gray-500 mt-0.5">Todos los productos combinados</p>
          </button>

          {/* Breadcrumbs */}
          {navStack.length > 0 && (
            <div className="flex items-center gap-1 text-sm flex-wrap">
              <button onClick={() => navigateBack(-1)} className="text-primary-400 hover:text-primary-300 transition-colors">Inicio</button>
              {navStack.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  <span className="text-gray-600">›</span>
                  {i < navStack.length - 1 ? (
                    <button onClick={() => navigateBack(i)} className="text-primary-400 hover:text-primary-300 transition-colors">{node.name}</button>
                  ) : (
                    <span className="text-white font-medium">{node.name}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Select current level button */}
          {navStack.length > 0 && (
            <div className="flex items-center gap-3">
              <button onClick={() => navigateBack(navStack.length - 2)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-700/50 transition-colors">
                ← Regresar
              </button>
              <button onClick={() => { selectProduct(navStack[navStack.length - 1].id, navStack[navStack.length - 1].name); setWizardStep(2); }}
                className="text-sm text-primary-400 hover:text-primary-300 px-3 py-1.5 rounded-lg border border-primary-500/30 hover:bg-primary-500/10 transition-colors ml-auto">
                Seleccionar "{navStack[navStack.length - 1].name}" →
              </button>
            </div>
          )}

          {/* Family grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {currentChildren.map(f => (
              <button key={f._id} onClick={() => drillInto(f)}
                className="p-4 rounded-xl border text-left transition-all bg-gray-900/30 border-gray-700/50 text-gray-300 hover:border-gray-600 hover:bg-gray-800/50">
                <p className="text-sm font-medium text-white">{f.name}</p>
                {f.children && f.children.filter(c => !c.sellable).length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">{f.children.filter(c => !c.sellable).length} subfamilias →</p>
                )}
              </button>
            ))}
            {currentChildren.length === 0 && navStack.length > 0 && (
              <p className="text-sm text-gray-500 col-span-2">No hay subfamilias. Usa "Seleccionar" arriba.</p>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Channel */}
      {wizardStep === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">¿Qué datos quieres analizar?</h3>
          <p className="text-sm text-gray-400">Producto: <span className="text-white font-medium">{config.productPath || config.productName}</span></p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ['ml', 'Mercado Libre', 'Ventas reales de ML (base histórica)'],
              ['manual', 'Ventas manuales', 'Ventas registradas en CRM'],
              ['campaigns', 'Campañas', 'Ventas atribuidas a anuncios de Meta']
            ].map(([val, label, desc]) => (
              <button key={val} onClick={() => { setConfig(c => ({ ...c, channel: val, campaignId: '' })); if (val !== 'campaigns') setWizardStep(3); }}
                className={`p-4 rounded-xl border text-left transition-all ${config.channel === val ? 'bg-primary-500/10 border-primary-500/50 text-white' : 'bg-gray-900/30 border-gray-700/50 text-gray-400 hover:border-gray-600'}`}>
                <p className="font-medium text-white">{label}</p>
                <p className="text-xs text-gray-500 mt-1">{desc}</p>
              </button>
            ))}
          </div>
          {config.channel === 'campaigns' && (
            <div>
              {campaignsLoading ? (
                <div className="animate-pulse bg-gray-700/50 h-10 rounded-lg" />
              ) : (
                <select value={config.campaignId} onChange={e => setConfig(c => ({ ...c, campaignId: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">Todas las campañas</option>
                  {campaigns.map(c => (
                    <option key={c.fbCampaignId} value={c.fbCampaignId}>
                      {c.name} {c.status !== 'ACTIVE' ? `(${c.status})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => setWizardStep(3)}
                className="mt-3 px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm">
                Siguiente →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Period + modifiers */}
      {wizardStep === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Periodo y modificadores</h3>
          <div className="flex flex-wrap gap-2 text-xs mb-2">
            <span className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">{config.productPath || config.productName}</span>
            <span className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
              {config.channel === 'ml' ? 'Mercado Libre' : config.channel === 'manual' ? 'Ventas manuales' : 'Campañas'}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">Periodo de análisis</label>
            <div className="flex gap-2">
              {[30, 60, 90, 180, 365].map(d => (
                <button key={d} onClick={() => setConfig(c => ({ ...c, days: d }))}
                  className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${config.days === d ? 'bg-primary-500 text-white' : 'bg-gray-900/30 border border-gray-700/50 text-gray-400 hover:border-gray-600'}`}>
                  {d >= 365 ? '1 año' : d >= 180 ? '6 meses' : `${d} días`}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all bg-gray-900/30 border-gray-700/50 hover:border-gray-600">
            <input type="checkbox" checked={config.seasonality} onChange={e => setConfig(c => ({ ...c, seasonality: e.target.checked }))}
              className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
            <div>
              <p className="text-sm text-white">Estacionalidad</p>
              <p className="text-xs text-gray-500">Ajuste por mes del año</p>
            </div>
          </label>
        </div>
      )}

      {/* Footer: back + next/generate */}
      <div className="flex justify-between mt-6">
        <button onClick={() => setWizardStep(s => Math.max(1, s - 1))}
          className={`px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors text-sm ${wizardStep === 1 ? 'invisible' : ''}`}>
          ← Anterior
        </button>
        {wizardStep === 3 ? (
          <button onClick={generateForecast} disabled={loading}
            className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium">
            {loading ? 'Generando...' : configured ? 'Regenerar pronóstico' : 'Generar pronóstico'}
          </button>
        ) : (
          <div /> /* spacer — next is handled by clicking options in steps 1 & 2 */
        )}
      </div>
    </div>
  );

  // ── LOADING ──
  if (loading && !data) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
        <p className="text-gray-400 mb-6">Configura y genera tu pronóstico basado en datos reales</p>
        {configPanel}
        <div className="p-12 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 mt-4">Analizando datos...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
      <p className="text-gray-400 mb-6">Configura y genera tu pronóstico basado en datos reales</p>

      {configPanel}

      {/* Not configured yet */}
      {!configured && (
        <div className="p-16 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-4xl mb-4">📊</p>
          <h3 className="text-lg font-semibold text-white mb-2">Configura tu pronóstico</h3>
          <p className="text-gray-400 max-w-md mx-auto">Selecciona la fuente de datos, el producto y el periodo. Luego presiona "Generar pronóstico" para ver las proyecciones.</p>
        </div>
      )}

      {/* No data */}
      {configured && !loading && data && data.history.length === 0 && (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-gray-400">No hay datos suficientes para este filtro. Intenta con un periodo más largo o un producto diferente.</p>
        </div>
      )}

      {/* ── RESULTS ── */}
      {configured && data && data.history.length > 0 && (
        <div className="space-y-6">
          {/* Active config badge */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
              {config.productPath || config.productName}
            </span>
            <span className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
              {config.channel === 'ml' ? 'Mercado Libre' : config.channel === 'manual' ? 'Ventas manuales' : 'Campañas'}
            </span>
            <span className="px-2 py-1 rounded bg-gray-500/10 border border-gray-500/30 text-gray-300">
              {config.days >= 365 ? '1 año' : config.days >= 180 ? '6 meses' : `${config.days} días`}
            </span>
            {config.seasonality && (
              <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                Estacionalidad
              </span>
            )}
            <span className="text-gray-500">R² = {data.r2}</span>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Ingresos ({config.days >= 365 ? '1a' : config.days >= 180 ? '6m' : config.days + 'd'})</p>
              <p className="text-2xl font-bold text-green-400">{fmt(data.totalHistoryRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-purple-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-400">Proyección 14 días</p>
              <p className="text-2xl font-bold text-purple-400">{fmt(data.totalForecastRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Promedio diario</p>
              <p className="text-2xl font-bold text-white">{fmt(data.avgDailyRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Tendencia</p>
              <p className={`text-2xl font-bold ${data.trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {data.trend >= 0 ? '↗' : '↘'} {data.trend > 0 ? '+' : ''}{data.trend}%
              </p>
            </div>
          </div>

          {/* Manual sales summary */}
          {data.manualSales && data.manualSales.totalOrders > 0 && (
            <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4 flex items-center gap-4">
              <span className="text-lg">🏷️</span>
              <div className="flex-1">
                <p className="text-sm text-white font-medium">Ventas manuales incluidas: {data.manualSales.totalOrders} ventas por {fmt(data.manualSales.totalRevenue)}</p>
                <p className="text-xs text-gray-500">Registradas desde CRM. Se incluyen en el total, se separan al segmentar por producto.</p>
              </div>
            </div>
          )}

          {/* Meta attribution summary */}
          {data.metaAttribution && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-5">
                <p className="text-xs text-gray-400">Ingresos por Ads</p>
                <p className="text-xl font-bold text-blue-400">{fmt(data.metaAttribution.totalAdRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">{data.metaAttribution.adRevenuePercent}% del total</p>
              </div>
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
                <p className="text-xs text-gray-400">Ingresos orgánicos</p>
                <p className="text-xl font-bold text-green-400">{fmt(data.metaAttribution.totalOrganicRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">{(100 - data.metaAttribution.adRevenuePercent).toFixed(1)}% del total</p>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-5">
                <p className="text-xs text-gray-400">Ventas por Ads</p>
                <p className="text-xl font-bold text-blue-400">{data.metaAttribution.totalAdOrders}</p>
              </div>
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
                <p className="text-xs text-gray-400">Ventas orgánicas</p>
                <p className="text-xl font-bold text-green-400">{data.metaAttribution.totalOrganicOrders}</p>
              </div>
            </div>
          )}

          {/* Main chart: daily + forecast */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Ingresos diarios + proyección</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Real</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cyan-500 inline-block"></span> Promedio 7d</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Proyección</span>
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(800, chartData.length * 18) }}>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload || {};
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label} {d.dow ? `(${d.dow})` : ''}</p>
                            {d.revenue != null && <p style={{ color: '#10B981' }}>Real: {fmt(d.revenue)}</p>}
                            {d.movingAvg != null && <p style={{ color: '#06B6D4' }}>Promedio 7d: {fmt(d.movingAvg)}</p>}
                            {d.forecast != null && <p style={{ color: '#8B5CF6' }}>Proyección: {fmt(d.forecast)}</p>}
                            {d.upper != null && <p style={{ color: '#9CA3AF' }}>Rango: {fmt(d.lower)} – {fmt(d.upper)}</p>}
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                    <Area type="monotone" dataKey="upper" stroke="none" fill="#8B5CF6" fillOpacity={0.08} connectNulls={false} />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="#1F2937" fillOpacity={1} connectNulls={false} />
                    <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="movingAvg" name="Promedio 7d" stroke="#06B6D4" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Seasonality chart (if enabled) */}
          {data.seasonSummary && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Estacionalidad mensual</h2>
              <p className="text-sm text-gray-500 mb-4">Multiplicador por mes — valores &gt;1 indican meses fuertes, &lt;1 meses débiles</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.seasonSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} domain={[0, 'auto']} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v.toFixed(2) + 'x', 'Multiplicador']} />
                    <ReferenceLine y={1} stroke="#6B7280" strokeDasharray="4 4" />
                    <Bar dataKey="multiplier" name="Multiplicador" radius={[4, 4, 0, 0]}
                      fill="#F59E0B"
                      // Color bars based on value
                      label={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* DOW pattern */}
          {data.dowSummary && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Patrón por día de la semana</h2>
              <p className="text-sm text-gray-500 mb-4">Promedio de ingresos según el día</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dowSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(v), 'Promedio']} />
                    <Bar dataKey="avg" name="Promedio" fill="#06B6D4" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Monthly breakdown */}
          {data.monthly && data.monthly.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Ingresos por mes</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.monthly} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label}</p>
                            <p style={{ color: '#10B981' }}>Ingresos: {fmt(d.revenue)}</p>
                            {d.isPartial && d.projected && <p style={{ color: '#8B5CF6' }}>Proyectado mes: {fmt(d.projected)}</p>}
                            <p style={{ color: '#9CA3AF' }}>Órdenes: {d.orders} | Ticket: {fmt(d.avgOrder)}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="projected" name="Proyección mes" fill="#8B5CF6" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="px-4 py-2">Mes</th>
                      <th className="px-4 py-2 text-right">Ingresos</th>
                      <th className="px-4 py-2 text-right">Órdenes</th>
                      <th className="px-4 py-2 text-right">Ticket Prom.</th>
                      <th className="px-4 py-2 text-right">Proyección</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {data.monthly.map((m, i) => (
                      <tr key={i} className="hover:bg-gray-700/20">
                        <td className="px-4 py-2 text-sm text-white font-medium">{m.label} {m.isPartial && <span className="text-xs text-gray-500">(parcial)</span>}</td>
                        <td className="px-4 py-2 text-right text-sm text-green-400">{fmt(m.revenue)}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{m.orders}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{fmt(m.avgOrder)}</td>
                        <td className="px-4 py-2 text-right text-sm text-purple-400">{m.projected ? fmt(m.projected) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Weekly trend */}
          {data.weeks && data.weeks.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Tendencia semanal</h2>
              <p className="text-sm text-gray-500 mb-4">R² = {data.r2} — pendiente: {fmt(data.slope)}/semana</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.weeks} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => fmt(v)} />
                    <Line type="monotone" dataKey="revenue" name="Ingresos" stroke="#8B5CF6" strokeWidth={2.5} dot={{ fill: '#8B5CF6', r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SalesForecastView;
