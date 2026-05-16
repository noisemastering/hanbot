import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import API from '../api';
import {
  ComposedChart, Bar, Line, Area, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
// KnobControl removed — using sliders instead

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');
const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const CHANNELS = [
  { id: 'all', label: 'Todos', desc: 'Todas las fuentes combinadas' },
  { id: 'online', label: 'Tiendas en línea', desc: 'Todos los marketplaces' },
  { id: 'mercadolibre', label: 'Mercado Libre', desc: 'Ventas de ML' },
  { id: 'manual', label: 'Ventas manuales', desc: 'Registradas en CRM' }
];

const LOADING_STAGES = [
  { text: 'Recopilando datos históricos...', duration: 2000 },
  { text: 'Identificando patrones de venta...', duration: 3000 },
  { text: 'Calculando estacionalidad...', duration: 3000 },
  { text: 'Procesando impacto de campañas...', duration: 2500 },
  { text: 'Generando proyección...', duration: 2000 },
  { text: 'Preparando visualización...', duration: 1500 }
];

function SalesForecastView() {
  // ── Product tree navigation ──
  const [families, setFamilies] = useState([]);
  const [navStack, setNavStack] = useState([]);
  const [currentChildren, setCurrentChildren] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null); // null = not selected yet

  // ── Config ──
  const [channel, setChannel] = useState('all');
  const [days, setDays] = useState(180);

  // ── Data ──
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const dataReady = useRef(false);
  const stageTimer = useRef(null);

  // ── Simulation ("What if") ──
  const [simOpen, setSimOpen] = useState(false);
  const [simWeeks, setSimWeeks] = useState(4);
  const [simParams, setSimParams] = useState(null); // real campaign params from API
  const [sim, setSim] = useState({
    budgetMult: 1,        // multiplier on current daily budget
    adCount: 0,           // additional ads (on top of current)
    adType: 'current',    // 'current' | 'click' | 'presence'
    targetExpansion: 0    // % audience expansion
  });

  // Fetch product tree and sim params
  useEffect(() => {
    fetch(`${API_URL}/product-families/tree`).then(r => r.json()).then(res => {
      if (res.success) {
        const roots = (res.data || []).filter(f => !f.parentId && !f.sellable);
        setFamilies(roots);
        setCurrentChildren(roots);
      }
    }).catch(() => {});

    API.get('/ml/forecast-v2/sim-params').then(res => {
      if (res.data?.success) setSimParams(res.data.data);
    }).catch(() => {});
  }, []);

  const fetchChildren = async (familyId) => {
    try {
      const res = await fetch(`${API_URL}/product-families/${familyId}/children`);
      const d = await res.json();
      if (d.success) return d.data || [];
    } catch {}
    return [];
  };

  const drillInto = async (family) => {
    let children = family.children || await fetchChildren(family._id);
    const nonSellable = children.filter(c => !c.sellable);
    setNavStack(prev => [...prev, { id: family._id, name: family.name }]);
    setCurrentChildren(nonSellable);
  };

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
      fetchChildren(targetId).then(ch => setCurrentChildren(ch.filter(c => !c.sellable)));
    }
  };

  const selectProduct = (id, name) => {
    const pathName = [...navStack.map(n => n.name), name].filter(Boolean).join(' › ');
    setSelectedProduct({ id, name, path: pathName });
  };

  const selectGlobal = () => {
    setSelectedProduct({ id: '', name: 'Global', path: 'Global' });
    setNavStack([]);
    setCurrentChildren(families);
  };

  const changeProduct = () => {
    setSelectedProduct(null);
    setData(null);
    setRevealed(false);
  };

  // ── Theatrical loading sequence ──
  const runLoadingSequence = useCallback(() => {
    setLoading(true);
    setRevealed(false);
    setLoadingStage(0);
    dataReady.current = false;

    let currentStage = 0;
    const advanceStage = () => {
      currentStage++;
      if (currentStage < LOADING_STAGES.length) {
        setLoadingStage(currentStage);
        stageTimer.current = setTimeout(advanceStage, LOADING_STAGES[currentStage].duration);
      } else {
        // All stages done — wait for data if not ready
        const checkData = () => {
          if (dataReady.current) {
            setLoading(false);
            setTimeout(() => setRevealed(true), 300);
          } else {
            setTimeout(checkData, 200);
          }
        };
        checkData();
      }
    };
    stageTimer.current = setTimeout(advanceStage, LOADING_STAGES[0].duration);
  }, []);

  // ── Fetch forecast data ──
  const fetchForecast = useCallback(async (productId, ch, d) => {
    try {
      const params = new URLSearchParams({
        days: d.toString(),
        channel: ch,
        seasonality: 'true'
      });
      if (productId) {
        params.set('productFamilyId', productId);
        params.set('includeSubfamilies', 'true');
      }
      const res = await API.get(`/ml/forecast-v2?${params.toString()}`);
      return res.data?.data || null;
    } catch (err) {
      console.error('Forecast error:', err);
      return null;
    }
  }, []);

  // ── Generate forecast (called explicitly, not on product selection) ──
  const generate = useCallback((productId, ch, d) => {
    runLoadingSequence();
    fetchForecast(productId, ch, d).then(result => {
      setData(result);
      dataReady.current = true;
    });
  }, [runLoadingSequence, fetchForecast]);

  // ── Channel/days change triggers regeneration ──
  const handleChannelChange = (ch) => {
    setChannel(ch);
    if (!selectedProduct) return;
    generate(selectedProduct.id, ch, days);
  };

  const handleDaysChange = (d) => {
    setDays(d);
    setChartZoom('auto');
    if (!selectedProduct) return;
    generate(selectedProduct.id, channel, d);
  };

  // Cleanup
  useEffect(() => () => { if (stageTimer.current) clearTimeout(stageTimer.current); }, []);

  // ── Chart data ──
  // Chart controls
  const [chartZoom, setChartZoom] = useState('auto');
  const [showAdBoost, setShowAdBoost] = useState(true);

  // Auto-select zoom based on period
  const effectiveZoom = chartZoom === 'auto'
    ? (days >= 180 ? 'monthly' : days >= 60 ? 'weekly' : 'daily')
    : chartZoom;

  // Check if ad attribution data exists
  const hasAdData = data?.history?.some(d => d.adRevenue > 0);

  // Daily chart data (raw)
  const dailyChartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.history.map(d => ({
        ...d,
        forecast: null, upper: null, lower: null,
        // For stacked bars: split revenue into organic base + ad boost
        organicBase: showAdBoost && d.adRevenue != null ? Math.round(d.revenue - d.adRevenue) : null,
        adBoost: showAdBoost && d.adRevenue != null ? Math.round(d.adRevenue) : null
      })),
      ...data.forecast.map(d => ({ dateLabel: d.dateLabel, date: d.date, dow: d.dow, revenue: null, movingAvg: null, forecast: d.revenue, upper: d.upper, lower: d.lower, orders: d.orders, organicBase: null, adBoost: null }))
    ];
  }, [data, showAdBoost]);

  // Aggregate daily into weekly
  const weeklyChartData = useMemo(() => {
    if (!dailyChartData.length) return [];
    const weeks = [];
    for (let i = 0; i < dailyChartData.length; i += 7) {
      const chunk = dailyChartData.slice(i, Math.min(i + 7, dailyChartData.length));
      if (chunk.length < 2) continue;
      const hasHistory = chunk.some(d => d.revenue != null);
      const hasForecast = chunk.some(d => d.forecast != null);
      const hasAd = showAdBoost && chunk.some(d => d.adBoost > 0);
      weeks.push({
        dateLabel: chunk[0].dateLabel + '–' + chunk[chunk.length - 1].dateLabel,
        revenue: hasHistory ? chunk.reduce((s, d) => s + (d.revenue || 0), 0) : null,
        movingAvg: null,
        forecast: hasForecast ? chunk.reduce((s, d) => s + (d.forecast || 0), 0) : null,
        upper: hasForecast ? chunk.reduce((s, d) => s + (d.upper || 0), 0) : null,
        lower: hasForecast ? Math.max(0, chunk.reduce((s, d) => s + (d.lower || 0), 0)) : null,
        organicBase: hasAd ? chunk.reduce((s, d) => s + (d.organicBase || 0), 0) : null,
        adBoost: hasAd ? chunk.reduce((s, d) => s + (d.adBoost || 0), 0) : null
      });
    }
    return weeks;
  }, [dailyChartData, showAdBoost]);

  // Monthly from backend — enriched with ad attribution from daily data
  const monthlyChartData = useMemo(() => {
    if (!data?.monthly) return [];

    // Aggregate daily ad data into monthly buckets
    const monthlyAd = {};
    if (showAdBoost && data.history) {
      for (const d of data.history) {
        if (d.adRevenue == null || !d.date) continue;
        const monthKey = d.date.substring(0, 7); // "2025-07"
        if (!monthlyAd[monthKey]) monthlyAd[monthKey] = { ad: 0, organic: 0 };
        monthlyAd[monthKey].ad += d.adRevenue || 0;
        monthlyAd[monthKey].organic += Math.max(0, (d.revenue || 0) - (d.adRevenue || 0));
      }
    }

    // Only show months within the selected period
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;

    return data.monthly
      .filter(m => m.month >= cutoffMonth && (m.revenue > 0 || m.projected > 0))
      .map(m => {
        const ad = monthlyAd[m.month];
        return {
          dateLabel: m.label,
          revenue: m.revenue,
          movingAvg: null,
          forecast: m.projected || null,
          upper: null,
          lower: null,
          organicBase: ad ? Math.round(ad.organic) : null,
          adBoost: ad ? Math.round(ad.ad) : null
        };
      });
  }, [data, showAdBoost, days]);

  const baseChartData = effectiveZoom === 'monthly' ? monthlyChartData
    : effectiveZoom === 'weekly' ? weeklyChartData
    : dailyChartData;

  // ── Simulation: compute "what if" forecast line ──
  const simActive = simOpen && (sim.budgetMult !== 1 || sim.adCount > 0 || sim.adType !== 'current' || sim.targetExpansion > 0);

  // ── CAMPAIGN SIMULATION MODEL ──
  // Generates a week-by-week projection for a campaign of N weeks.
  // Shape emerges from the data: short campaigns ≈ linear, long ones → S-curve with fatigue.

  const simModel = useMemo(() => {
    if (!data) return null;

    const totalRevenue = data.totalHistoryRevenue || 0;
    const adRevenue = data.metaAttribution?.totalAdRevenue || 0;
    const organicRevenue = Math.max(0, totalRevenue - adRevenue);
    const adPct = totalRevenue > 0 ? adRevenue / totalRevenue : 0;
    const historyDays = data.history?.length || 1;

    // Weekly averages from actual data
    const weeklyOrganic = (organicRevenue / historyDays) * 7;
    const weeklyAdRevenue = (adRevenue / historyDays) * 7;

    // Market ceiling estimation
    let ceilingMult;
    if (adPct < 0.1) ceilingMult = 5;
    else if (adPct < 0.2) ceilingMult = 3.5;
    else if (adPct < 0.35) ceilingMult = 2.5;
    else ceilingMult = 1.8;

    const weeklyCeiling = weeklyOrganic + weeklyAdRevenue * ceilingMult;
    const currentPosition = weeklyAdRevenue > 0 ? weeklyAdRevenue / (weeklyCeiling - weeklyOrganic) : 0;

    // Seasonality multipliers per month (from backend or default to 1)
    const seasonMults = {};
    if (data.seasonSummary) {
      data.seasonSummary.forEach(s => { seasonMults[s.month] = s.multiplier; });
    }

    return {
      weeklyOrganic, weeklyAdRevenue, weeklyCeiling, ceilingMult,
      adPct, currentPosition, organicRevenue, adRevenue, totalRevenue,
      historyDays, seasonMults
    };
  }, [data]);

  // Generate week-by-week campaign projection
  const campaignProjection = useMemo(() => {
    if (!simModel) return null;
    const { weeklyOrganic, weeklyAdRevenue, weeklyCeiling, seasonMults } = simModel;

    // Knob effects using real campaign parameters
    const currentAds = simParams?.summary?.totalActiveAds || 1;
    const totalNewAds = currentAds + sim.adCount;

    // Budget: diminishing returns via power function
    const budgetEffect = Math.pow(sim.budgetMult, 0.7);

    // More ads expand reach (ceiling goes up), diminishing per ad
    const adsExpansion = totalNewAds > currentAds ? Math.pow(totalNewAds / currentAds, 0.5) : 1;

    // Ad type modifier:
    // Click campaigns convert directly but saturate faster
    // Presence campaigns build awareness, slower but wider reach
    const typeEffect = sim.adType === 'click' ? 1.2 : sim.adType === 'presence' ? 0.8 : 1;
    const typeFatigueRate = sim.adType === 'click' ? 1.3 : sim.adType === 'presence' ? 0.7 : 1;

    // Target expansion widens audience = higher ceiling
    const targetEffect = 1 + (sim.targetExpansion / 100) * 0.6; // 60% of expansion translates to reach

    // Adjusted ceiling
    const adjCeiling = (weeklyCeiling - weeklyOrganic) * adsExpansion * targetEffect + weeklyOrganic;
    const maxAdRev = adjCeiling - weeklyOrganic;

    // Base weekly ad revenue at simulated budget
    const baseSimAdRev = weeklyAdRevenue * budgetEffect * typeEffect;

    const weeks = [];
    let cumulativeRevenue = 0;

    for (let w = 0; w < simWeeks; w++) {
      const campaignDate = new Date();
      campaignDate.setDate(campaignDate.getDate() + w * 7);
      const monthIdx = campaignDate.getMonth();
      const monthLabel = MONTH_LABELS[monthIdx];

      // Seasonality for this week's month
      const seasonMult = seasonMults[monthLabel] || 1;

      // Audience fatigue: effectiveness decays over time
      // Click ads fatigue faster (typeFatigueRate > 1), presence ads fatigue slower
      const baseFatigue = w < 2 ? 1.0 : w < 4 ? 0.92 : w < 8 ? 0.78 : Math.max(0.5, 0.65 - (w - 8) * 0.02);
      const fatigueFactor = Math.max(0.3, 1 - (1 - baseFatigue) * typeFatigueRate);

      // Saturation: can't exceed ceiling even with infinite spend
      const rawAdRev = baseSimAdRev * fatigueFactor * seasonMult;
      const cappedAdRev = Math.min(rawAdRev, maxAdRev * fatigueFactor);

      // Organic stays stable with slight seasonal influence
      const weekOrganic = weeklyOrganic * seasonMult;

      const weekTotal = weekOrganic + Math.max(0, cappedAdRev);
      cumulativeRevenue += weekTotal;

      // Baseline (what would happen without changes — current spend)
      const baselineAdRev = Math.min(weeklyAdRevenue * fatigueFactor * seasonMult, maxAdRev * fatigueFactor);
      const baselineTotal = weekOrganic + baselineAdRev;

      weeks.push({
        week: w + 1,
        label: `Sem ${w + 1}`,
        dateRange: `${campaignDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`,
        month: monthLabel,
        baseline: Math.round(baselineTotal),
        simulated: Math.round(weekTotal),
        organic: Math.round(weekOrganic),
        adContribution: Math.round(Math.max(0, cappedAdRev)),
        fatigue: Math.round(fatigueFactor * 100),
        seasonality: +seasonMult.toFixed(2),
        cumulative: Math.round(cumulativeRevenue)
      });
    }

    // Summary
    const totalBaseline = weeks.reduce((s, w) => s + w.baseline, 0);
    const totalSimulated = weeks.reduce((s, w) => s + w.simulated, 0);
    const totalAdContribution = weeks.reduce((s, w) => s + w.adContribution, 0);

    // Marginal return: what happens if budget goes up 10% more
    const marginalBudgetEffect = Math.pow(sim.budgetMult + 0.1, 0.7);
    const marginalAdRev = weeklyAdRevenue * marginalBudgetEffect * typeEffect;
    const marginalDelta = weeks.reduce((s, w) => {
      const mRaw = marginalAdRev * (w.fatigue / 100) * w.seasonality;
      const mCapped = Math.min(mRaw, maxAdRev * (w.fatigue / 100));
      return s + Math.max(0, mCapped);
    }, 0) - totalAdContribution;

    // Curve shape description
    let curveShape;
    const lastWeekRatio = weeks.length > 1 ? weeks[weeks.length - 1].simulated / weeks[0].simulated : 1;
    if (simWeeks <= 2) curveShape = 'Casi lineal — campaña corta, no hay tiempo para saturación';
    else if (lastWeekRatio > 0.85) curveShape = 'Crecimiento sostenido — buena duración para este nivel de inversión';
    else if (lastWeekRatio > 0.6) curveShape = 'Rendimiento decreciente — la fatiga reduce el impacto en las últimas semanas';
    else curveShape = 'Saturación severa — considera acortar la campaña o refrescar el creative';

    return {
      weeks, totalBaseline, totalSimulated, totalAdContribution,
      marginalReturn: Math.round(marginalDelta / simWeeks),
      curveShape,
      currentPosition: simModel.currentPosition
    };
  }, [simModel, sim, simWeeks, simParams]);

  const chartData = useMemo(() => {
    if (!simActive || !campaignProjection) return baseChartData;

    // Apply campaign projection multiplier to the forecast line
    const totalMultiplier = campaignProjection.totalBaseline > 0
      ? campaignProjection.totalSimulated / campaignProjection.totalBaseline
      : 1;

    return baseChartData.map(d => ({
      ...d,
      simForecast: d.forecast != null ? Math.round(d.forecast * totalMultiplier) : null
    }));
  }, [baseChartData, simActive, campaignProjection]);

  // Simulated totals
  const simTotalForecast = useMemo(() => {
    if (!simActive || !campaignProjection) return null;
    return campaignProjection.totalSimulated;
  }, [simActive, campaignProjection]);

  const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  // ── RENDER: Product not selected yet ──
  if (!selectedProduct) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
        <p className="text-gray-400 mb-6">Selecciona un producto para generar la proyección</p>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">¿Para qué producto es la proyección?</h3>

          {/* Family grid */}
          {families.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-block w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-500 mt-2">Cargando productos...</p>
            </div>
          ) : (
          <>
          {/* Global option — same row as families, not full width */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <button onClick={selectGlobal}
              className="p-4 rounded-xl border text-left transition-all bg-primary-500/5 border-primary-500/30 hover:border-primary-500/50 hover:bg-primary-500/10">
              <p className="text-sm font-medium text-white">Global</p>
              <p className="text-xs text-gray-500 mt-0.5">Todos los productos</p>
            </button>
          </div>

          {/* Breadcrumbs */}
          {navStack.length > 0 && (
            <div className="flex items-center gap-1 text-sm flex-wrap mb-3">
              <button onClick={() => navigateBack(-1)} className="text-primary-400 hover:text-primary-300">Inicio</button>
              {navStack.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  <span className="text-gray-600">›</span>
                  {i < navStack.length - 1 ? (
                    <button onClick={() => navigateBack(i)} className="text-primary-400 hover:text-primary-300">{node.name}</button>
                  ) : (
                    <span className="text-white font-medium">{node.name}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Back + select current */}
          {navStack.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => navigateBack(navStack.length - 2)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-700/50 transition-colors">
                ← Regresar
              </button>
              <button onClick={() => selectProduct(navStack[navStack.length - 1].id, navStack[navStack.length - 1].name)}
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
          </>
          )}
        </div>
      </div>
    );
  }

  // ── RENDER: Product selected, pick channel to start ──
  if (selectedProduct && !data && !loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-1">Pronóstico de Ventas</h1>
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm text-primary-400 font-medium">{selectedProduct.path}</span>
          <button onClick={changeProduct} className="text-xs text-gray-500 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700/50 transition-colors">Cambiar</button>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">¿Qué canal de venta quieres analizar?</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CHANNELS.map(ch => (
              <button key={ch.id} onClick={() => { setChannel(ch.id); generate(selectedProduct.id, ch.id, days); }}
                className="p-4 rounded-xl border text-left transition-all bg-gray-900/30 border-gray-700/50 hover:border-primary-500/50 hover:bg-primary-500/5">
                <p className="text-sm font-medium text-white">{ch.label}</p>
                <p className="text-xs text-gray-500 mt-1">{ch.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Loading sequence ──
  if (loading) {
    const progress = ((loadingStage + 1) / LOADING_STAGES.length) * 100;
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
        <p className="text-gray-400 mb-6">{selectedProduct.path}</p>

        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <div className="w-full max-w-md space-y-6">
            {/* Animated brain/gear icon */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl">🧠</span>
                </div>
              </div>
            </div>

            {/* Stage text */}
            <p className="text-center text-white font-medium text-lg animate-pulse">
              {LOADING_STAGES[loadingStage]?.text || 'Finalizando...'}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-gray-700/50 rounded-full h-2">
              <div className="bg-gradient-to-r from-primary-500 to-purple-500 h-2 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progress}%` }} />
            </div>

            {/* Stage indicators */}
            <div className="space-y-1">
              {LOADING_STAGES.map((stage, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                  i < loadingStage ? 'text-green-400' : i === loadingStage ? 'text-primary-400' : 'text-gray-600'
                }`}>
                  <span>{i < loadingStage ? '✓' : i === loadingStage ? '●' : '○'}</span>
                  <span>{stage.text.replace('...', '')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Results ──
  return (
    <div className={`transition-opacity duration-700 pb-20 ${revealed ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Pronóstico de Ventas</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary-400 font-medium">{selectedProduct.path}</span>
            <button onClick={changeProduct} className="text-xs text-gray-500 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700/50 transition-colors">
              Cambiar
            </button>
          </div>
        </div>
      </div>

      {/* Controls bar: channel + backtrace */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Channel selector */}
          <div className="flex gap-1">
            {CHANNELS.map(ch => (
              <button key={ch.id} onClick={() => handleChannelChange(ch.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  channel === ch.id ? 'bg-primary-500 text-white' : 'bg-gray-900/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
                title={ch.desc}>
                {ch.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-gray-700" />

          {/* Backtrace date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Historial:</span>
            {[30, 90, 180, 365, 730].map(d => (
              <button key={d} onClick={() => handleDaysChange(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  days === d ? 'bg-purple-600 text-white' : 'bg-gray-900/50 text-gray-500 hover:text-white hover:bg-gray-700/50'
                }`}>
                {d >= 730 ? '2a' : d >= 365 ? '1a' : d >= 180 ? '6m' : `${d}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!data || data.history.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-gray-400">No hay datos suficientes para este filtro.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Ingresos ({days >= 730 ? '2a' : days >= 365 ? '1a' : days >= 180 ? '6m' : days + 'd'})</p>
              <p className="text-2xl font-bold text-green-400">{fmt(data.totalHistoryRevenue)}</p>
            </div>
            <div className={`bg-gray-800/50 border rounded-xl p-5 ${simActive ? 'border-amber-500/30' : 'border-purple-500/20'}`}>
              <p className="text-xs text-gray-400">Proyección 14 días</p>
              {simActive && simTotalForecast != null ? (
                <>
                  <p className="text-2xl font-bold text-amber-400">{fmt(simTotalForecast)}</p>
                  <p className="text-xs text-gray-500">Base: {fmt(data.totalForecastRevenue)}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-purple-400">{fmt(data.totalForecastRevenue)}</p>
              )}
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

          {/* Attribution cards */}
          {data.metaAttribution && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                <p className="text-xs text-gray-400">Atribuidas a Ads</p>
                <p className="text-xl font-bold text-blue-400">{fmt(data.metaAttribution.totalAdRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">{data.metaAttribution.adRevenuePercent}% del total</p>
              </div>
              <div className="bg-gray-700/30 border border-gray-600/30 rounded-xl p-4">
                <p className="text-xs text-gray-400">Sin atribución</p>
                <p className="text-xl font-bold text-gray-300">{fmt(data.metaAttribution.totalOrganicRevenue)}</p>
                <p className="text-xs text-gray-500 mt-1">{(100 - data.metaAttribution.adRevenuePercent).toFixed(1)}% — sin link tracked</p>
              </div>
              {data.manualSales && data.manualSales.totalOrders > 0 && (
                <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
                  <p className="text-xs text-gray-400">Ventas manuales</p>
                  <p className="text-xl font-bold text-orange-400">{fmt(data.manualSales.totalRevenue)}</p>
                  <p className="text-xs text-gray-500 mt-1">{data.manualSales.totalOrders} ventas</p>
                </div>
              )}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4" title={`R² = ${data.r2} — mide qué tan predecible es el patrón de ventas. Valores bajos son normales en retail porque las ventas diarias varían mucho.`}>
                <p className="text-xs text-gray-400">Predictibilidad</p>
                <p className={`text-xl font-bold ${data.r2 >= 0.7 ? 'text-green-400' : data.r2 >= 0.4 ? 'text-cyan-400' : 'text-purple-400'}`}>
                  {data.r2 >= 0.7 ? 'Alta' : data.r2 >= 0.4 ? 'Moderada' : 'Variable'}
                </p>
                <p className="text-xs text-gray-500 mt-1">{data.r2 >= 0.7 ? 'Patrón de ventas estable' : data.r2 >= 0.4 ? 'Ventas con algo de variación' : 'Ventas con mucha variación diaria — normal en retail'}</p>
              </div>
            </div>
          )}

          {/* Main chart */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-white">Proyección integrada</h2>
                <div className="flex gap-1 bg-gray-900/50 rounded-lg p-0.5">
                  {[['monthly', 'Mes'], ['weekly', 'Sem'], ['daily', 'Día']].map(([z, label]) => (
                    <button key={z} onClick={() => setChartZoom(z)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${effectiveZoom === z ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                {showAdBoost && hasAdData ? (
                  <>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Sin atribución</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> Boost de Ads</span>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Real</span>
                )}
                {effectiveZoom === 'daily' && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cyan-500 inline-block" /> Promedio 7d</span>}
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block" /> Proyección</span>
                {simActive && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Simulación</span>}
                {hasAdData && (
                  <button onClick={() => setShowAdBoost(v => !v)}
                    className={`ml-2 px-2 py-0.5 rounded text-xs transition-all ${showAdBoost ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-gray-700/50 text-gray-500'}`}>
                    {showAdBoost ? 'Ocultar boost' : 'Mostrar boost'}
                  </button>
                )}
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(600, chartData.length * (effectiveZoom === 'daily' ? 16 : effectiveZoom === 'weekly' ? 40 : 60)) }}>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload || {};
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label} {d.dow ? `(${d.dow})` : ''}</p>
                            {d.revenue != null && !showAdBoost && <p style={{ color: '#10B981' }}>Real: {fmt(d.revenue)}</p>}
                            {d.revenue != null && showAdBoost && d.organicBase != null && (
                              <>
                                <p style={{ color: '#10B981' }}>Sin atribución: {fmt(d.organicBase)}</p>
                                <p style={{ color: '#3B82F6' }}>Boost de Ads: {fmt(d.adBoost)}</p>
                                <p style={{ color: '#9CA3AF' }}>Total: {fmt(d.revenue)}</p>
                              </>
                            )}
                            {d.revenue != null && showAdBoost && d.organicBase == null && <p style={{ color: '#10B981' }}>Real: {fmt(d.revenue)}</p>}
                            {d.movingAvg != null && <p style={{ color: '#06B6D4' }}>Promedio 7d: {fmt(d.movingAvg)}</p>}
                            {d.forecast != null && <p style={{ color: '#8B5CF6' }}>Proyección: {fmt(d.forecast)}</p>}
                            {d.simForecast != null && <p style={{ color: '#F59E0B' }}>Simulación: {fmt(d.simForecast)} ({d.simForecast > d.forecast ? '+' : ''}{((d.simForecast - d.forecast) / d.forecast * 100).toFixed(0)}%)</p>}
                            {d.upper != null && <p style={{ color: '#9CA3AF' }}>Rango: {fmt(d.lower)} – {fmt(d.upper)}</p>}
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                    <Area type="monotone" dataKey="upper" stroke="none" fill="#8B5CF6" fillOpacity={0.08} connectNulls={false} />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="#1F2937" fillOpacity={1} connectNulls={false} />
                    {showAdBoost && hasAdData ? (
                      <>
                        <Bar dataKey="organicBase" name="Sin atribución" stackId="rev" fill="#10B981" fillOpacity={0.7} />
                        <Bar dataKey="adBoost" name="Boost de Ads" stackId="rev" fill="#3B82F6" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                      </>
                    ) : (
                      <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                    )}
                    {effectiveZoom === 'daily' && (
                      <Line type="monotone" dataKey="movingAvg" name="Promedio 7d" stroke="#06B6D4" strokeWidth={2} dot={false} connectNulls={false} />
                    )}
                    <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                    {simActive && (
                      <Line type="monotone" dataKey="simForecast" name="Simulación" stroke="#F59E0B" strokeWidth={2.5} dot={{ fill: '#F59E0B', r: 3, stroke: '#F59E0B' }} connectNulls={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── SIMULATION PANEL ("What if") ── */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl mb-8 mt-[30px]">
            <button onClick={() => setSimOpen(v => !v)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-700/20 transition-colors">
              <div className="flex items-center gap-3">
                <span className="text-lg">🎛️</span>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-white">¿Qué pasaría si...?</h3>
                  <p className="text-xs text-gray-500">Ajusta parámetros para simular el impacto en la proyección</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {simActive && simTotalForecast != null && (
                  <span className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    Simulación: {fmt(simTotalForecast)} ({simTotalForecast > data.totalForecastRevenue ? '+' : ''}{((simTotalForecast - data.totalForecastRevenue) / data.totalForecastRevenue * 100).toFixed(0)}%)
                  </span>
                )}
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${simOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {simOpen && (
              <div className="px-6 pt-6 pb-6 border-t border-gray-700/50 space-y-5">
                {/* Global scope warning */}
                {selectedProduct?.id === '' && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2 text-xs text-amber-300 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>Estás simulando a nivel global — los cambios se aplican proporcionalmente a todos los productos. Para una simulación más precisa, selecciona un producto específico.</span>
                  </div>
                )}

                {/* Duration selector */}
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Duración de la campaña</label>
                  <div className="flex gap-2">
                    {[1, 2, 4, 8, 12, 24].map(w => (
                      <button key={w} onClick={() => setSimWeeks(w)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${simWeeks === w ? 'bg-primary-500 text-white' : 'bg-gray-900/50 text-gray-500 hover:text-white hover:bg-gray-700/50'}`}>
                        {w >= 12 ? `${Math.round(w / 4)} meses` : w === 1 ? '1 sem' : `${w} sem`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Current campaign info */}
                {simParams?.summary && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="px-2 py-1 rounded bg-gray-700/50 text-gray-300">Presupuesto actual: <span className="text-white font-medium">{fmt(simParams.summary.totalDailyBudget)}/día</span></span>
                    <span className="px-2 py-1 rounded bg-gray-700/50 text-gray-300">Anuncios activos: <span className="text-white font-medium">{simParams.summary.totalActiveAds}</span></span>
                    <span className="px-2 py-1 rounded bg-gray-700/50 text-gray-300">Tipo: <span className="text-white font-medium">{simParams.summary.adTypes.click > simParams.summary.adTypes.presence ? 'Mayormente clics' : simParams.summary.adTypes.presence > simParams.summary.adTypes.click ? 'Mayormente presencia' : 'Mixto'}</span></span>
                    {simParams.summary.targetLocations?.length > 0 && (
                      <span className="px-2 py-1 rounded bg-gray-700/50 text-gray-300">Target: <span className="text-white font-medium">{simParams.summary.targetLocations.slice(0, 3).join(', ')}{simParams.summary.targetLocations.length > 3 ? '...' : ''}</span></span>
                    )}
                  </div>
                )}

                {/* Controls */}
                {(() => {
                  // Sweet spot calculations based on campaign duration
                  // Short campaigns can push harder, long ones need restraint
                  const budgetSweet = simWeeks <= 2 ? 1.8 : simWeeks <= 4 ? 1.4 : simWeeks <= 8 ? 1.2 : 1.1;
                  const adsSweet = simWeeks <= 2 ? 2 : simWeeks <= 4 ? 4 : simWeeks <= 8 ? 6 : 8;
                  const targetSweet = simWeeks <= 2 ? 10 : simWeeks <= 4 ? 20 : simWeeks <= 8 ? 35 : 50;

                  // Helper: render a slider with sweet spot dot
                  const SliderWithDot = ({ label, value, min, max, step, sweetSpot, color, valueLabel, minLabel, maxLabel, onChange }) => {
                    const sweetPct = ((sweetSpot - min) / (max - min)) * 100;
                    return (
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs text-gray-400">{label}</label>
                          <span className={`text-xs font-mono ${color}`}>{valueLabel}</span>
                        </div>
                        <div className="relative">
                          <input type="range" min={min} max={max} step={step} value={value}
                            onChange={onChange}
                            className={`w-full cursor-pointer ${color.replace('text-', 'accent-')}`} />
                          {/* Sweet spot dot */}
                          <div className="absolute top-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `calc(${sweetPct}% - 4px)` }}
                            title={`Punto óptimo para ${simWeeks} semanas`}>
                            <div className="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-amber-400/30" />
                          </div>
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                          <span>{minLabel}</span>
                          <span className="text-amber-400/60">●  óptimo</span>
                          <span>{maxLabel}</span>
                        </div>
                      </div>
                    );
                  };

                  return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <SliderWithDot label="Presupuesto" value={sim.budgetMult} min={0} max={3} step={0.01}
                      sweetSpot={budgetSweet} color="text-blue-400"
                      valueLabel={sim.budgetMult === 1 ? 'Actual' : sim.budgetMult === 0 ? 'Sin ads' : (sim.budgetMult > 1 ? '+' : '') + Math.round((sim.budgetMult - 1) * 100) + '%'}
                      minLabel="Sin ads" maxLabel="3x"
                      onChange={e => setSim(s => ({ ...s, budgetMult: parseFloat(e.target.value) }))} />

                    <SliderWithDot label="Anuncios" value={sim.adCount} min={0} max={20} step={1}
                      sweetSpot={adsSweet} color="text-orange-400"
                      valueLabel={String((simParams?.summary?.totalActiveAds || 0) + sim.adCount)}
                      minLabel={`${simParams?.summary?.totalActiveAds || '?'} actual`} maxLabel="+20"
                      onChange={e => setSim(s => ({ ...s, adCount: parseInt(e.target.value) }))} />

                    <SliderWithDot label="Ampliar target" value={sim.targetExpansion} min={0} max={100} step={1}
                      sweetSpot={targetSweet} color="text-green-400"
                      valueLabel={sim.targetExpansion === 0 ? 'Actual' : '+' + sim.targetExpansion + '%'}
                      minLabel="Actual" maxLabel="+100%"
                      onChange={e => setSim(s => ({ ...s, targetExpansion: parseInt(e.target.value) }))} />

                    {/* Ad type — no slider, just toggle */}
                    <div className="bg-gray-900/50 rounded-lg p-4">
                      <label className="text-xs text-gray-400 block mb-3">Tipo de anuncio</label>
                      <div className="flex gap-1">
                        {[
                          ['current', `${simParams?.summary?.adTypes?.click > simParams?.summary?.adTypes?.presence ? 'Clics' : simParams?.summary?.adTypes?.presence > simParams?.summary?.adTypes?.click ? 'Presencia' : 'Mixto'} (actual)`],
                          ['click', 'Clics'],
                          ['presence', 'Presencia']
                        ].map(([val, label]) => (
                          <button key={val} onClick={() => setSim(s => ({ ...s, adType: val }))}
                            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${sim.adType === val ? 'bg-amber-500 text-white' : 'bg-gray-800 text-gray-500 hover:text-white'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  );
                })()}

                <div className="flex justify-end">
                  <button onClick={() => { setSim({ budgetMult: 1, adCount: 0, adType: 'current', targetExpansion: 0 }); setSimWeeks(4); }}
                    className="text-xs text-gray-500 hover:text-white px-3 py-1 rounded hover:bg-gray-700/50 transition-colors">
                    ↺ Restablecer todo
                  </button>
                </div>

                {/* Campaign week-by-week projection */}
                {campaignProjection && (
                  <div className="space-y-4">
                    {/* Campaign curve chart */}
                    <div className="bg-gray-900/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-gray-400">Proyección semana a semana — {simWeeks} semanas</p>
                        <p className="text-xs text-gray-500 italic">{campaignProjection.curveShape}</p>
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={campaignProjection.weeks} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                          <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                          <Tooltip contentStyle={tooltipStyle}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const w = payload[0]?.payload;
                              if (!w) return null;
                              return (
                                <div style={tooltipStyle} className="p-3 text-sm">
                                  <p className="text-white font-medium mb-1">{label} — {w.dateRange}</p>
                                  <p style={{ color: '#8B5CF6' }}>Base: {fmt(w.baseline)}</p>
                                  <p style={{ color: '#F59E0B' }}>Simulación: {fmt(w.simulated)}</p>
                                  <p style={{ color: '#10B981' }}>Orgánico: {fmt(w.organic)}</p>
                                  <p style={{ color: '#3B82F6' }}>Ads: {fmt(w.adContribution)}</p>
                                  <p style={{ color: '#9CA3AF' }}>Fatiga: {w.fatigue}% | Temporada: {w.seasonality}x</p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="organic" name="Orgánico" stackId="sim" fill="#10B981" fillOpacity={0.5} />
                          <Bar dataKey="adContribution" name="Ads" stackId="sim" fill="#3B82F6" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                          <Line type="monotone" dataKey="baseline" name="Sin cambios" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500/50 inline-block" /> Orgánico</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500/70 inline-block" /> Aporte de Ads</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-px bg-purple-500 inline-block" /> Sin cambios</span>
                      </div>
                    </div>

                    {/* Summary row */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Sin cambios ({simWeeks} sem)</p>
                        <p className="text-sm font-medium text-purple-400">{fmt(campaignProjection.totalBaseline)}</p>
                      </div>
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Con simulación</p>
                        <p className="text-sm font-bold text-amber-400">{fmt(campaignProjection.totalSimulated)}</p>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Diferencia</p>
                        <p className={`text-sm font-bold ${campaignProjection.totalSimulated >= campaignProjection.totalBaseline ? 'text-green-400' : 'text-red-400'}`}>
                          {campaignProjection.totalSimulated >= campaignProjection.totalBaseline ? '+' : ''}{fmt(campaignProjection.totalSimulated - campaignProjection.totalBaseline)}
                        </p>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Ventas proyectadas</p>
                        <p className="text-sm font-bold text-white">{fmt(campaignProjection.marginalReturn)}/sem</p>
                      </div>
                    </div>

                    {/* Market position */}
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-gray-400">Posición en el mercado</p>
                        <p className="text-xs text-gray-500">{Math.round(campaignProjection.currentPosition * 100)}% de saturación</p>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div className="bg-gradient-to-r from-green-500 via-amber-500 to-red-500 h-2 rounded-full" style={{ width: `${Math.min(100, campaignProjection.currentPosition * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-600 text-center">Modelo con fatiga de audiencia, estacionalidad y techo de mercado. Doble clic en un control para restablecer.</p>
              </div>
            )}
          </div>

          {/* Seasonality breakdown */}
          {data.seasonSummary && (() => {
            // Season colors and labels (Mexico / Northern Hemisphere)
            const SEASONS = {
              'Ene': { season: 'Invierno', color: '#60A5FA', emoji: '❄️' },
              'Feb': { season: 'Invierno', color: '#60A5FA', emoji: '❄️' },
              'Mar': { season: 'Primavera', color: '#34D399', emoji: '🌱' },
              'Abr': { season: 'Primavera', color: '#34D399', emoji: '🌱' },
              'May': { season: 'Primavera', color: '#34D399', emoji: '🌱' },
              'Jun': { season: 'Verano', color: '#FBBF24', emoji: '☀️' },
              'Jul': { season: 'Verano', color: '#FBBF24', emoji: '☀️' },
              'Ago': { season: 'Verano', color: '#FBBF24', emoji: '☀️' },
              'Sep': { season: 'Otoño', color: '#F97316', emoji: '🍂' },
              'Oct': { season: 'Otoño', color: '#F97316', emoji: '🍂' },
              'Nov': { season: 'Otoño', color: '#F97316', emoji: '🍂' },
              'Dic': { season: 'Invierno', color: '#60A5FA', emoji: '❄️' }
            };
            const enriched = data.seasonSummary.map(d => ({
              ...d,
              label: `${d.month}`,
              ...(SEASONS[d.month] || { season: '', color: '#F59E0B' })
            }));
            // Best season
            const seasonAvgs = {};
            enriched.forEach(d => {
              if (!seasonAvgs[d.season]) seasonAvgs[d.season] = [];
              seasonAvgs[d.season].push(d.multiplier);
            });
            const bestSeason = Object.entries(seasonAvgs)
              .map(([s, vals]) => ({ season: s, avg: vals.reduce((a, b) => a + b, 0) / vals.length }))
              .sort((a, b) => b.avg - a.avg)[0];

            return (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Estacionalidad</h2>
              <p className="text-sm text-gray-500 mb-4">
                Multiplicador por mes — la mejor temporada es <span className="text-white font-medium">{bestSeason?.season}</span> ({(bestSeason?.avg || 0).toFixed(2)}x promedio)
              </p>
              {/* Season legend */}
              <div className="flex gap-4 mb-3 text-xs text-gray-400">
                <span>❄️ Invierno (Dic–Feb)</span>
                <span>🌱 Primavera (Mar–May)</span>
                <span>☀️ Verano (Jun–Ago)</span>
                <span>🍂 Otoño (Sep–Nov)</span>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={enriched} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} domain={[0, 'auto']} />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(v, name, props) => [v.toFixed(2) + 'x', props.payload.season]}
                    />
                    <ReferenceLine y={1} stroke="#6B7280" strokeDasharray="4 4" />
                    <Bar dataKey="multiplier" name="Multiplicador" radius={[4, 4, 0, 0]}>
                      {enriched.map((d, i) => (
                        <Cell key={i} fill={d.color} fillOpacity={d.multiplier >= 1 ? 0.8 : 0.4} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            );
          })()}

          {/* DOW pattern */}
          {data.dowSummary && (() => {
            const bestDayAvg = Math.max(...data.dowSummary.map(d => d.avg));
            const worstDayAvg = Math.min(...data.dowSummary.map(d => d.avg));
            const bestDayName = data.dowSummary.find(d => d.avg === bestDayAvg)?.day;
            const worstDayName = data.dowSummary.find(d => d.avg === worstDayAvg)?.day;
            return (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Patrón semanal</h2>
              <p className="text-sm text-gray-500 mb-4">
                Mejor día: <span className="text-green-400 font-medium">{bestDayName}</span> ({fmt(bestDayAvg)}) — Peor día: <span className="text-red-400 font-medium">{worstDayName}</span> ({fmt(worstDayAvg)})
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dowSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => [fmt(v), 'Promedio']} />
                    <Bar dataKey="avg" name="Promedio" radius={[4, 4, 0, 0]}>
                      {data.dowSummary.map((d, i) => (
                        <Cell key={i}
                          fill={d.avg === bestDayAvg ? '#10B981' : d.avg === worstDayAvg ? '#EF4444' : '#06B6D4'}
                          fillOpacity={d.avg === bestDayAvg || d.avg === worstDayAvg ? 0.9 : 0.5}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            );
          })()}

          {/* Monthly breakdown */}
          {data.monthly && data.monthly.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Desglose mensual</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.monthly} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label}</p>
                            <p style={{ color: '#10B981' }}>Ingresos: {fmt(d.revenue)}</p>
                            {d.isPartial && d.projected && <p style={{ color: '#8B5CF6' }}>Proyección mes: {fmt(d.projected)}</p>}
                            <p style={{ color: '#9CA3AF' }}>Órdenes: {d.orders} | Ticket: {fmt(d.avgOrder)}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="projected" name="Proyección" fill="#8B5CF6" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
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
