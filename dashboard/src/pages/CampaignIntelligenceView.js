import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const PRIORITY = {
  high: { label: 'Alta', color: 'bg-red-500/10 border-red-500/30 text-red-400' },
  medium: { label: 'Media', color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  low: { label: 'Baja', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  info: { label: 'Info', color: 'bg-gray-500/10 border-gray-500/30 text-gray-400' }
};

const CATEGORIES = {
  cross_sell: { label: 'Desalineación de producto', icon: '🔀' },
  fatigue: { label: 'Fatiga de anuncio', icon: '📉' },
  budget: { label: 'Reasignación de presupuesto', icon: '💰' },
  opportunity: { label: 'Oportunidad sin explotar', icon: '🚀' },
  performance: { label: 'Rendimiento', icon: '📊' }
};

function formatMoney(n) {
  if (n == null) return '-';
  return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

/**
 * Detect ad fatigue from daily performance data.
 * Splits the ad's daily data into first half vs second half.
 * If second half metrics are significantly lower, ad is fatigued.
 */
function detectFatigue(ad) {
  const daily = ad.daily || [];
  if (daily.length < 10) return null; // Not enough data

  const mid = Math.floor(daily.length / 2);
  const firstHalf = daily.slice(0, mid);
  const secondHalf = daily.slice(mid);

  const avg = (arr, key) => {
    const vals = arr.map(d => d[key] || 0);
    return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  };

  const firstRevenue = avg(firstHalf, 'revenue');
  const secondRevenue = avg(secondHalf, 'revenue');
  const firstClicks = avg(firstHalf, 'clicks');
  const secondClicks = avg(secondHalf, 'clicks');

  // Revenue decline > 30%
  if (firstRevenue > 0 && secondRevenue < firstRevenue * 0.7) {
    const decline = ((firstRevenue - secondRevenue) / firstRevenue * 100).toFixed(0);
    return {
      type: 'revenue_decline',
      decline: Number(decline),
      firstHalfAvg: Math.round(firstRevenue),
      secondHalfAvg: Math.round(secondRevenue),
      daysRunning: daily.length
    };
  }

  // Click decline > 40%
  if (firstClicks > 0 && secondClicks < firstClicks * 0.6) {
    const decline = ((firstClicks - secondClicks) / firstClicks * 100).toFixed(0);
    return {
      type: 'click_decline',
      decline: Number(decline),
      daysRunning: daily.length
    };
  }

  return null;
}

/**
 * Detect performance cycles in daily data.
 * Looks for alternating peaks and valleys.
 */
function detectCycles(daily) {
  if (!daily || daily.length < 14) return null;

  // Calculate 7-day moving averages
  const movingAvg = [];
  for (let i = 6; i < daily.length; i++) {
    const window = daily.slice(i - 6, i + 1);
    const avg = window.reduce((s, d) => s + (d.revenue || 0), 0) / 7;
    movingAvg.push({ date: daily[i].date, avg });
  }

  // Find peaks and valleys
  const peaks = [];
  const valleys = [];
  for (let i = 1; i < movingAvg.length - 1; i++) {
    if (movingAvg[i].avg > movingAvg[i - 1].avg && movingAvg[i].avg > movingAvg[i + 1].avg) {
      peaks.push(i);
    }
    if (movingAvg[i].avg < movingAvg[i - 1].avg && movingAvg[i].avg < movingAvg[i + 1].avg) {
      valleys.push(i);
    }
  }

  if (peaks.length >= 2) {
    const gaps = [];
    for (let i = 1; i < peaks.length; i++) {
      gaps.push(peaks[i] - peaks[i - 1]);
    }
    const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    if (avgCycle >= 7 && avgCycle <= 30) {
      // Determine where we are in the cycle
      const lastPeak = peaks[peaks.length - 1];
      const daysSincePeak = movingAvg.length - 1 - lastPeak;
      const phase = daysSincePeak < avgCycle / 2 ? 'declining' : 'recovering';
      return { cycleDays: avgCycle, phase, daysSincePeak };
    }
  }

  return null;
}

/**
 * Generate all recommendations from the data.
 */
function generateRecommendations(spendData, productData, perfData) {
  const recommendations = [];
  const ads = spendData?.ads || [];
  const products = productData?.products || [];
  const perfAds = perfData?.ads || [];

  // ─── CROSS-SELL DETECTION ───
  for (const ad of ads) {
    if (ad.crossSellPct > 50 && ad.conversions >= 3) {
      // Find the top cross-sell product
      const crossProducts = (ad.products || [])
        .filter(p => p.product !== ad.targetProduct)
        .sort((a, b) => b.revenue - a.revenue);

      if (crossProducts.length > 0) {
        const top = crossProducts[0];
        recommendations.push({
          category: 'cross_sell',
          priority: ad.crossSellPct > 70 ? 'high' : 'medium',
          ad: ad.name,
          title: `"${ad.name}" vende más ${top.product} que ${ad.targetProduct || 'su producto objetivo'}`,
          detail: `${ad.crossSellPct.toFixed(0)}% de las ventas son de productos diferentes al anunciado. El producto más vendido es ${top.product} (${top.count} ventas, ${formatMoney(top.revenue)}).`,
          action: `Considera crear un anuncio dedicado para ${top.product} y ajustar el creative de "${ad.name}" para alinearlo mejor con su audiencia.`
        });
      }
    }
  }

  // ─── AD FATIGUE DETECTION ───
  for (const perfAd of perfAds) {
    const fatigue = detectFatigue(perfAd);
    if (fatigue) {
      const adSpendInfo = ads.find(a => a.adId === perfAd.adId);
      recommendations.push({
        category: 'fatigue',
        priority: fatigue.decline > 50 ? 'high' : 'medium',
        ad: perfAd.name,
        title: `"${perfAd.name}" muestra fatiga — ${fatigue.type === 'revenue_decline' ? 'ingresos' : 'clics'} cayeron ${fatigue.decline}%`,
        detail: fatigue.type === 'revenue_decline'
          ? `Promedio diario pasó de ${formatMoney(fatigue.firstHalfAvg)} a ${formatMoney(fatigue.secondHalfAvg)} en ${fatigue.daysRunning} días.`
          : `Los clics cayeron ${fatigue.decline}% en la segunda mitad del periodo (${fatigue.daysRunning} días activo).`,
        action: adSpendInfo?.spend > 0
          ? `Pausa este anuncio por 5-7 días y luego reactívalo, o refresca el creative (imagen/texto).`
          : `Considera pausar este anuncio temporalmente.`
      });
    }

    // Cycle detection
    const cycle = detectCycles(perfAd.daily);
    if (cycle) {
      recommendations.push({
        category: 'fatigue',
        priority: 'low',
        ad: perfAd.name,
        title: `"${perfAd.name}" tiene ciclos de ~${cycle.cycleDays} días`,
        detail: `Detectamos un patrón cíclico. Actualmente en fase ${cycle.phase === 'declining' ? 'de declive' : 'de recuperación'} (${cycle.daysSincePeak} días desde el último pico).`,
        action: cycle.phase === 'declining'
          ? `Estás en fase baja. Considera pausar ${Math.max(1, cycle.cycleDays - cycle.daysSincePeak)} días y reactivar cuando el ciclo suba.`
          : `Estás en fase de recuperación. Mantén el anuncio activo, debería mejorar pronto.`
      });
    }
  }

  // ─── BUDGET REALLOCATION ───
  const adsWithROI = ads.filter(a => a.roi > 0 && a.spend > 0).sort((a, b) => b.roi - a.roi);
  const adsWithLowROI = ads.filter(a => a.spend > 0 && (a.efficiency === 'diminishing' || a.roi < 2));
  const adsWithHighROI = ads.filter(a => a.roi >= 5 && a.spend > 0);

  if (adsWithLowROI.length > 0 && adsWithHighROI.length > 0) {
    const worst = adsWithLowROI[0];
    const best = adsWithHighROI[0];
    recommendations.push({
      category: 'budget',
      priority: 'high',
      title: `Reasigna presupuesto de "${worst.name}" a "${best.name}"`,
      detail: `"${worst.name}" tiene ROI de ${worst.roi ? worst.roi.toFixed(1) : '0'}x con ${formatMoney(worst.spend)} invertidos. "${best.name}" tiene ROI de ${best.roi.toFixed(1)}x — cada peso invertido rinde ${best.roi.toFixed(1)}x más.`,
      action: `Reduce el presupuesto de "${worst.name}" y redirige a "${best.name}" para maximizar el retorno.`
    });
  }

  // Best performing per-dollar
  if (adsWithROI.length > 0) {
    const best = adsWithROI[0];
    recommendations.push({
      category: 'budget',
      priority: 'info',
      title: `Tu mejor inversión: "${best.name}" (ROI ${best.roi.toFixed(1)}x)`,
      detail: `Con ${formatMoney(best.spend)} invertidos generó ${formatMoney(best.revenue)} en ingresos. Cada peso invertido retornó ${best.roi.toFixed(1)} pesos.`,
      action: `Considera escalar el presupuesto de este anuncio gradualmente.`
    });
  }

  // ─── PRODUCT OPPORTUNITIES ───
  // Products selling organically with no ad spend
  const organicProducts = products.filter(p => p.driver === 'organic' && p.totalOrders >= 3);
  for (const prod of organicProducts.slice(0, 3)) {
    recommendations.push({
      category: 'opportunity',
      priority: 'medium',
      title: `${prod.name} vende sin publicidad — oportunidad sin explotar`,
      detail: `${prod.totalOrders} ventas y ${formatMoney(prod.totalRevenue)} en ingresos sin inversión en ads. Tendencia: ${prod.trend > 0 ? '+' : ''}${prod.trend.toFixed(0)}%.`,
      action: `Crea un anuncio dedicado para ${prod.name}. Si ya vende orgánicamente, con publicidad el crecimiento puede ser significativo.`
    });
  }

  // Products with high trend but low spend
  const trendingProducts = products
    .filter(p => p.trend > 20 && p.totalOrders >= 5)
    .sort((a, b) => b.trend - a.trend);
  for (const prod of trendingProducts.slice(0, 2)) {
    if (!organicProducts.find(o => o.name === prod.name)) {
      recommendations.push({
        category: 'opportunity',
        priority: 'medium',
        title: `${prod.name} está en tendencia alcista (+${prod.trend.toFixed(0)}%)`,
        detail: `${prod.totalOrders} ventas, tendencia de +${prod.trend.toFixed(0)}% con ${prod.adSpend > 0 ? formatMoney(prod.adSpend) + ' en ads' : 'sin inversión en ads'}.`,
        action: prod.adSpend > 0
          ? `Escala la inversión en ads para ${prod.name} mientras la tendencia siga positiva.`
          : `Lanza un anuncio para ${prod.name} para capitalizar la tendencia.`
      });
    }
  }

  // Runner-up sizes — products ranked #2-5 by revenue that lack dedicated ads
  const productsByRevenue = [...products].sort((a, b) => b.totalRevenue - a.totalRevenue);
  for (let i = 1; i < Math.min(5, productsByRevenue.length); i++) {
    const prod = productsByRevenue[i];
    if (prod.driver === 'organic' && prod.totalOrders >= 2) {
      recommendations.push({
        category: 'opportunity',
        priority: prod.totalOrders >= 5 ? 'medium' : 'low',
        title: `Runner-up: ${prod.name} es el #${i + 1} en ventas sin anuncio dedicado`,
        detail: `${formatMoney(prod.totalRevenue)} en ingresos (${prod.totalOrders} ventas). El #1 es ${productsByRevenue[0].name} con ${formatMoney(productsByRevenue[0].totalRevenue)}.`,
        action: `Crea un anuncio para ${prod.name} para convertir estas ventas orgánicas en un canal pagado rentable.`
      });
    }
  }

  // ─── PERFORMANCE ALERTS ───
  // Ads with zero conversions but spending
  const zeroConversionAds = ads.filter(a => a.spend > 500 && a.conversions === 0);
  for (const ad of zeroConversionAds) {
    recommendations.push({
      category: 'performance',
      priority: 'high',
      title: `"${ad.name}" tiene ${formatMoney(ad.spend)} invertidos y 0 conversiones`,
      detail: `${ad.impressions?.toLocaleString() || 0} impresiones y ${ad.fbClicks || 0} clics sin ninguna venta.`,
      action: `Revisa el flujo de conversación asignado, el targeting, y el creative. Si no mejora en 5 días, pausa.`
    });
  }

  // Products with declining trend — group affected ads, check if still active
  const decliningProducts = new Map();
  for (const ad of ads) {
    if (ad.conversions >= 5 && ad.products?.length > 0) {
      const sortedProducts = [...ad.products].sort((a, b) => b.revenue - a.revenue);
      const mainProduct = sortedProducts[0];
      // Only associate this ad with the product if it's the primary one (>40% of revenue)
      const adTotalRevenue = sortedProducts.reduce((s, p) => s + (p.revenue || 0), 0);
      if (adTotalRevenue > 0 && mainProduct.revenue / adTotalRevenue < 0.4) continue;
      const prodData = products.find(p => p.name === mainProduct.product);
      if (prodData && prodData.trend < -20) {
        // Check if this ad has recent activity (last 7 days)
        const perfAd = perfAds.find(p => p.adId === ad.adId);
        const daily = perfAd?.daily || [];
        const last7 = daily.slice(-7);
        const recentActivity = last7.some(d => (d.clicks || 0) > 0 || (d.revenue || 0) > 0);

        if (!decliningProducts.has(mainProduct.product)) {
          decliningProducts.set(mainProduct.product, { prodData, activeAds: [], inactiveAds: [] });
        }
        const entry = decliningProducts.get(mainProduct.product);
        const adDetail = {
          name: ad.name,
          spend: ad.spend || 0,
          conversions: ad.conversions || 0,
          revenue: ad.revenue || 0,
          roi: ad.roi || 0,
          active: recentActivity
        };
        if (recentActivity) {
          entry.activeAds.push(adDetail);
        } else {
          entry.inactiveAds.push(adDetail);
        }
      }
    }
  }
  for (const [productName, { prodData, activeAds, inactiveAds }] of decliningProducts) {
    const allAds = [...activeAds, ...inactiveAds];
    if (activeAds.length > 0) {
      recommendations.push({
        category: 'performance',
        priority: 'medium',
        title: `Las ventas de ${productName} están cayendo (-${Math.abs(prodData.trend).toFixed(0)}%) con anuncios activos`,
        detail: `${activeAds.length} activo${activeAds.length > 1 ? 's' : ''}${inactiveAds.length > 0 ? `, ${inactiveAds.length} pausado${inactiveAds.length > 1 ? 's' : ''}` : ''}.`,
        action: `Evalúa si la demanda bajó estacionalmente o si los anuncios necesitan refrescarse. Considera pausar los de menor ROI.`,
        productDetail: { daily: prodData.daily || [], ads: allAds, productName }
      });
    } else if (inactiveAds.length > 0) {
      recommendations.push({
        category: 'performance',
        priority: 'info',
        title: `Las ventas de ${productName} bajaron (-${Math.abs(prodData.trend).toFixed(0)}%) — anuncios pausados`,
        detail: `Los ${inactiveAds.length} anuncios que vendían ${productName} están inactivos. La caída es esperada.`,
        action: `Si quieres recuperar ventas de ${productName}, reactiva al menos un anuncio.`,
        productDetail: { daily: prodData.daily || [], ads: allAds, productName }
      });
    }
  }

  return recommendations.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    return (order[a.priority] || 3) - (order[b.priority] || 3);
  });
}

export default function CampaignIntelligenceView() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [spendData, setSpendData] = useState(null);
  const [productData, setProductData] = useState(null);
  const [perfData, setPerfData] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - period);
      const dateFrom = from.toISOString().split('T')[0];
      const dateTo = now.toISOString().split('T')[0];

      const [spendRes, productRes, perfRes] = await Promise.all([
        fetch(`${API_URL}/ml/spend-optimization?days=${period}`),
        fetch(`${API_URL}/ml/forecast-by-product?days=${period}`),
        fetch(`${API_URL}/analytics/ad-performance?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      ]);

      const [spend, product, perf] = await Promise.all([
        spendRes.json(),
        productRes.json(),
        perfRes.json()
      ]);

      setSpendData(spend.data || spend);
      setProductData(product.data || product);
      setPerfData(perf);
    } catch (err) {
      console.error('Error fetching intelligence data:', err);
    } finally {
      setLoading(false);
    }
  };

  const recommendations = useMemo(() => {
    if (!spendData || !productData || !perfData) return [];
    return generateRecommendations(spendData, productData, perfData);
  }, [spendData, productData, perfData]);

  const filteredRecs = filterCategory === 'all'
    ? recommendations
    : recommendations.filter(r => r.category === filterCategory);

  // Count by category
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const r of recommendations) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }
    return counts;
  }, [recommendations]);

  // Count by priority
  const priorityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, info: 0 };
    for (const r of recommendations) {
      counts[r.priority] = (counts[r.priority] || 0) + 1;
    }
    return counts;
  }, [recommendations]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 mt-4">Analizando datos de campaña...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Inteligencia de Campaña</h1>
          <p className="text-gray-400 mt-2">Recomendaciones basadas en el análisis de tus datos reales</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={period} onChange={e => setPeriod(Number(e.target.value))}
            className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm">
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          <button onClick={fetchData}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm">
            Reanalizar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{priorityCounts.high}</p>
          <p className="text-xs text-red-300 mt-1">Prioridad alta</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{priorityCounts.medium}</p>
          <p className="text-xs text-amber-300 mt-1">Prioridad media</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{priorityCounts.low}</p>
          <p className="text-xs text-blue-300 mt-1">Prioridad baja</p>
        </div>
        <div className="bg-gray-500/10 border border-gray-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-400">{priorityCounts.info}</p>
          <p className="text-xs text-gray-300 mt-1">Informativas</p>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setFilterCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${filterCategory === 'all' ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600'}`}>
          Todas ({recommendations.length})
        </button>
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          categoryCounts[key] > 0 && (
            <button key={key} onClick={() => setFilterCategory(key)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${filterCategory === key ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600'}`}>
              {cat.icon} {cat.label} ({categoryCounts[key]})
            </button>
          )
        ))}
      </div>

      {/* Recommendations */}
      {filteredRecs.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-2xl mb-2">✅</p>
          <h3 className="text-lg font-semibold text-white mb-2">Sin recomendaciones pendientes</h3>
          <p className="text-gray-400">Tus campañas se ven bien con los datos disponibles</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecs.map((rec, i) => {
            const cat = CATEGORIES[rec.category] || {};
            const pri = PRIORITY[rec.priority] || PRIORITY.info;
            const isExpanded = expandedIdx === i;

            return (
              <div key={i}
                className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-gray-600/50 transition-colors cursor-pointer"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">{cat.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${pri.color}`}>
                          {pri.label}
                        </span>
                        <span className="text-xs text-gray-500">{cat.label}</span>
                      </div>
                      <h4 className="text-sm font-medium text-white">{rec.title}</h4>
                      {!isExpanded && (
                        <p className="text-xs text-gray-500 mt-1 truncate">{rec.detail}</p>
                      )}
                    </div>
                    <svg className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 ml-8 space-y-3">
                      <p className="text-sm text-gray-300">{rec.detail}</p>

                      {/* Product detail: trend chart + ad table */}
                      {rec.productDetail && (
                        <div className="space-y-3">
                          {/* Trend chart */}
                          {rec.productDetail.daily.length > 0 && (
                            <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4">
                              <p className="text-xs text-gray-400 mb-2">Tendencia de {rec.productDetail.productName}</p>
                              <ResponsiveContainer width="100%" height={120}>
                                <LineChart data={rec.productDetail.daily}>
                                  <XAxis dataKey="dateLabel" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
                                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} width={45} />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }}
                                    labelStyle={{ color: '#fff' }}
                                    formatter={(v) => [formatMoney(v), 'Ingresos']}
                                  />
                                  <Line type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* Ad breakdown table */}
                          {rec.productDetail.ads.length > 0 && (
                            <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-700/50">
                                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Anuncio</th>
                                    <th className="px-3 py-2 text-center text-gray-500 font-medium">Estado</th>
                                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Inversión</th>
                                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Ventas</th>
                                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Ingresos</th>
                                    <th className="px-3 py-2 text-right text-gray-500 font-medium">ROI</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/30">
                                  {rec.productDetail.ads.map((ad, j) => (
                                    <tr key={j} className={ad.active ? '' : 'opacity-50'}>
                                      <td className="px-3 py-2 text-gray-300 truncate max-w-[180px]" title={ad.name}>{ad.name}</td>
                                      <td className="px-3 py-2 text-center">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ad.active ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-gray-500/10 text-gray-500 border border-gray-500/30'}`}>
                                          {ad.active ? 'Activo' : 'Pausado'}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-400">{formatMoney(ad.spend)}</td>
                                      <td className="px-3 py-2 text-right text-gray-300">{ad.conversions}</td>
                                      <td className="px-3 py-2 text-right text-gray-300">{formatMoney(ad.revenue)}</td>
                                      <td className="px-3 py-2 text-right text-gray-300">{ad.roi > 0 ? ad.roi.toFixed(1) + 'x' : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                        <p className="text-xs text-green-400 font-medium mb-1">Acción sugerida</p>
                        <p className="text-sm text-green-300">{rec.action}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* How it works */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mt-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase mb-3">Cómo funciona</h3>
        <div className="text-sm text-gray-400 space-y-2">
          <p>Este análisis cruza tres fuentes de datos: inversión publicitaria, desempeño por producto y rendimiento diario de cada anuncio.</p>
          <p><strong className="text-gray-300">Desalineación:</strong> Detecta cuando un anuncio vende productos diferentes al anunciado — una señal de que el creative o targeting no coincide con la audiencia.</p>
          <p><strong className="text-gray-300">Fatiga:</strong> Compara la primera mitad del periodo contra la segunda. Si los clics o ingresos caen significativamente, el anuncio necesita pausa o refresh.</p>
          <p><strong className="text-gray-300">Ciclos:</strong> Algunos anuncios tienen rendimiento cíclico (picos y valles cada N días). Identificar el patrón permite pausar estratégicamente.</p>
          <p><strong className="text-gray-300">Oportunidades:</strong> Productos que venden orgánicamente sin inversión en ads son candidatos ideales para escalar con publicidad.</p>
        </div>
      </div>
    </div>
  );
}
