import React, { useState, useEffect, useMemo } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const PRIORITY = {
  high: { label: 'Alta', color: 'bg-red-500/10 border-red-500/30 text-red-400' },
  medium: { label: 'Media', color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  low: { label: 'Baja', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  info: { label: 'Info', color: 'bg-gray-500/10 border-gray-500/30 text-gray-400' }
};

const CATEGORIES = {
  handoff: { label: 'Handoffs (leads a asesor)', icon: '🤝' },
  fatigue: { label: 'Fatiga de anuncio', icon: '📉' },
  budget: { label: 'Reasignación de presupuesto', icon: '💰' },
  opportunity: { label: 'Oportunidad', icon: '🚀' },
  performance: { label: 'Rendimiento', icon: '📊' }
};

function formatMoney(n) {
  if (n == null) return '-';
  return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

// Human-needed lines close with a person, so a handoff there IS the conversion.
const HUMAN_NEEDED_RE = /rollo|mayoreo|wholesale|ground\s*cover|antimaleza|medida/i;

// Click fatigue: split an ad's daily clicks in half; big drop = saturation.
function detectClickFatigue(daily) {
  if (!daily || daily.length < 10) return null;
  const mid = Math.floor(daily.length / 2);
  const avg = (arr) => arr.reduce((s, d) => s + (d.clicks || 0), 0) / (arr.length || 1);
  const first = avg(daily.slice(0, mid));
  const second = avg(daily.slice(mid));
  if (first > 1 && second < first * 0.6) {
    return { decline: ((first - second) / first * 100).toFixed(0), daysRunning: daily.length };
  }
  return null;
}

// Merge per-ad view: clics (purchase-link clicks) + spend + handoffs, keyed by adId.
function buildAds(spendData, perfData, handoffData) {
  const spendByAd = {};
  (spendData?.ads || []).forEach(a => { spendByAd[String(a.adId)] = a; });
  const hoByAd = {};
  (handoffData || []).forEach(h => { hoByAd[String(h.adId)] = h; });

  return (perfData?.ads || []).map(pa => {
    const id = String(pa.adId);
    const sp = spendByAd[id] || {};
    const ho = hoByAd[id] || { handoffs: 0, wholesale: 0, special: 0, other: 0 };
    const daily = pa.daily || [];
    const clicks = daily.reduce((s, d) => s + (d.clicks || 0), 0);
    const spend = sp.spend || 0;
    const humanNeeded = ho.wholesale > 0 || ho.special > 0 || HUMAN_NEEDED_RE.test(pa.name || '');
    return {
      adId: id, name: pa.name, spend, impressions: sp.impressions || 0,
      clicks, handoffs: ho.handoffs, wholesaleHandoffs: ho.wholesale, specialHandoffs: ho.special,
      daily, humanNeeded,
      cpc: clicks > 0 ? spend / clicks : null,
      costPerHandoff: ho.handoffs > 0 ? spend / ho.handoffs : null
    };
  });
}

// Click + handoff oriented insight engine (no sales / ROI).
function generateRecommendations(spendData, perfData, handoffData) {
  const ads = buildAds(spendData, perfData, handoffData);
  const recs = [];
  if (!ads.length) return recs;

  const CPC_GOOD = 3;   // MXN por clic a link de compra — barato
  const CPC_HIGH = 8;   // caro

  // 1) HANDOFF WINS 🤝 — ads sending people to a human (esp. rollo / mayoreo)
  const handoffAds = ads.filter(a => a.handoffs > 0).sort((a, b) => b.handoffs - a.handoffs);
  for (const a of handoffAds.slice(0, 4)) {
    const parts = [];
    if (a.wholesaleHandoffs) parts.push(`${a.wholesaleHandoffs} de mayoreo/rollo`);
    if (a.specialHandoffs) parts.push(`${a.specialHandoffs} de medida especial`);
    const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
    const isWin = a.humanNeeded || a.wholesaleHandoffs > 0 || a.specialHandoffs > 0;
    recs.push({
      category: 'handoff',
      priority: isWin && a.handoffs >= 3 ? 'medium' : 'info',
      title: `«${a.name}» generó ${a.handoffs} handoff${a.handoffs === 1 ? '' : 's'}${breakdown}`,
      detail: `Cada handoff es un lead caliente que pasó a un asesor${isWin ? ' — en productos que se cierran con humano (rollo, mayoreo, medida especial) esto ES la conversión, no una fuga.' : '.'} ${a.costPerHandoff != null ? `Costo por handoff: ${formatMoney(a.costPerHandoff)}.` : ''}`,
      action: isWin
        ? `Cuenta estos handoffs como conversiones al evaluar «${a.name}». Si el costo por handoff es bajo, sube el presupuesto.`
        : `Revisa por qué estas conversaciones necesitan humano; si es esperado (mayoreo/medida), márcalo como éxito.`
    });
  }

  // 2) ZERO-ENGAGEMENT — spend, but no clics AND no handoffs
  const dead = ads.filter(a => a.spend > 300 && a.clicks === 0 && a.handoffs === 0).sort((a, b) => b.spend - a.spend);
  for (const a of dead.slice(0, 4)) {
    recs.push({
      category: 'budget',
      priority: 'high',
      title: `«${a.name}» gastó ${formatMoney(a.spend)} sin clics ni handoffs`,
      detail: `${(a.impressions || 0).toLocaleString('es-MX')} impresiones y cero interacción útil (ni un clic a link de compra ni un handoff a asesor) en el periodo.`,
      action: `Pausa «${a.name}» o cambia creative/targeting — el gasto no está generando engagement.`
    });
  }

  // 3) BUDGET REALLOCATION — cheapest clic wins
  const withCpc = ads.filter(a => a.cpc != null && a.spend > 200).sort((a, b) => a.cpc - b.cpc);
  if (withCpc.length >= 2) {
    const best = withCpc[0];
    const worst = withCpc[withCpc.length - 1];
    if (worst.cpc > best.cpc * 2 && worst.cpc > CPC_HIGH) {
      recs.push({
        category: 'budget',
        priority: 'medium',
        title: `«${worst.name}» cuesta ${formatMoney(worst.cpc)}/clic vs «${best.name}» ${formatMoney(best.cpc)}/clic`,
        detail: `«${best.name}» compra clics ${(worst.cpc / best.cpc).toFixed(1)}× más barato. Mover presupuesto del caro al barato rinde más engagement por peso.`,
        action: `Reduce el gasto en «${worst.name}» y refuérzalo en «${best.name}».`
      });
    }
  }

  // 4) BEST ENGAGEMENT — cheapest CPC (positive)
  const goodCpc = withCpc.filter(a => a.cpc <= CPC_GOOD);
  if (goodCpc.length) {
    const b = goodCpc[0];
    recs.push({
      category: 'performance',
      priority: 'info',
      title: `Tu compra de clics más eficiente: «${b.name}» (${formatMoney(b.cpc)}/clic)`,
      detail: `${b.clicks.toLocaleString('es-MX')} clics con ${formatMoney(b.spend)} invertidos${b.handoffs ? `, más ${b.handoffs} handoffs` : ''}. Es tu anuncio más barato por clic.`,
      action: `Considera subir el presupuesto de «${b.name}» mientras el CPC se mantenga bajo.`
    });
  }

  // 5) CLICK FATIGUE
  for (const a of ads) {
    const fat = detectClickFatigue(a.daily);
    if (fat) {
      recs.push({
        category: 'fatigue',
        priority: 'medium',
        title: `«${a.name}» muestra fatiga — los clics cayeron ${fat.decline}%`,
        detail: `Los clics de la segunda mitad del periodo cayeron ${fat.decline}% vs. la primera (${fat.daysRunning} días activo). Señal de saturación de audiencia.`,
        action: `Refresca el creative de «${a.name}» o rota la audiencia para recuperar el ritmo de clics.`
      });
    }
  }

  // 6) HANDOFF OPPORTUNITY — human-needed line getting handoffs on little spend
  const oppo = ads.filter(a => a.humanNeeded && a.handoffs >= 2 && a.spend < 500).sort((a, b) => b.handoffs - a.handoffs);
  for (const a of oppo.slice(0, 2)) {
    recs.push({
      category: 'opportunity',
      priority: 'low',
      title: `«${a.name}» genera handoffs de línea humana con poca inversión`,
      detail: `${a.handoffs} handoffs con solo ${formatMoney(a.spend)} invertidos. En rollo/mayoreo cada handoff vale como venta — hay margen para escalar.`,
      action: `Sube el presupuesto de «${a.name}» y mídelo por handoffs, no por ventas en línea.`
    });
  }

  return recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    return (order[a.priority] || 3) - (order[b.priority] || 3);
  });
}

export default function CampaignIntelligenceView() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [spendData, setSpendData] = useState(null);
  const [perfData, setPerfData] = useState(null);
  const [handoffData, setHandoffData] = useState([]);
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

      const [spendRes, perfRes, handoffRes] = await Promise.all([
        fetch(`${API_URL}/ml/spend-optimization?days=${period}`),
        fetch(`${API_URL}/analytics/ad-performance?dateFrom=${dateFrom}&dateTo=${dateTo}`),
        fetch(`${API_URL}/analytics/handoffs-by-ad?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      ]);

      const [spend, perf, handoff] = await Promise.all([
        spendRes.json(),
        perfRes.json(),
        handoffRes.json()
      ]);

      setSpendData(spend.data || spend);
      setPerfData(perf);
      setHandoffData(handoff.data || []);
    } catch (err) {
      console.error('Error fetching intelligence data:', err);
    } finally {
      setLoading(false);
    }
  };

  const recommendations = useMemo(() => {
    if (!spendData || !perfData) return [];
    return generateRecommendations(spendData, perfData, handoffData);
  }, [spendData, perfData, handoffData]);

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

  // Handoff headline (total across ads in the period)
  const totalHandoffs = useMemo(
    () => (handoffData || []).reduce((s, h) => s + (h.handoffs || 0), 0),
    [handoffData]
  );

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 mt-4">Analizando clics y handoffs...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Inteligencia de Campaña</h1>
          <p className="text-gray-400 mt-2">Recomendaciones basadas en clics y handoffs — no en ventas. En rollo y mayoreo, un handoff a un asesor es la conversión.</p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{priorityCounts.high}</p>
          <p className="text-xs text-red-300 mt-1">Prioridad alta</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{priorityCounts.medium}</p>
          <p className="text-xs text-amber-300 mt-1">Prioridad media</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{priorityCounts.low + priorityCounts.info}</p>
          <p className="text-xs text-blue-300 mt-1">Baja / info</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{totalHandoffs}</p>
          <p className="text-xs text-emerald-300 mt-1">Handoffs (leads)</p>
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
          <p className="text-gray-400">Tus campañas se ven bien con los datos de clics y handoffs disponibles</p>
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
          <p>Este análisis mide el éxito por <strong className="text-gray-300">clics</strong> (interés real) y <strong className="text-gray-300">handoffs</strong> (leads que pasan a un asesor), no por ventas en línea — porque productos como rollo y mayoreo se cierran con un humano.</p>
          <p><strong className="text-gray-300">Handoffs:</strong> Cada conversación que pasa a un asesor se atribuye al anuncio que la originó. En líneas humanas (rollo, mayoreo, medida especial) un handoff cuenta como conversión.</p>
          <p><strong className="text-gray-300">Presupuesto:</strong> Compara el costo por clic entre anuncios; mover gasto del caro al barato rinde más engagement por peso. Un anuncio que gasta sin clics ni handoffs es candidato a pausa.</p>
          <p><strong className="text-gray-300">Fatiga:</strong> Compara la primera mitad del periodo contra la segunda. Si los clics caen mucho, el anuncio necesita refresh o rotación de audiencia.</p>
        </div>
      </div>
    </div>
  );
}
