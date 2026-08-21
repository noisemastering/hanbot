import React, { useMemo } from 'react';

// Puntuación vs. mercado mexicano — benchmarks de anuncios de Facebook (ecommerce/retail MX, MXN).
// Editable aquí si tienes metas propias. reliable=true → dato directo de Facebook;
// reliable=false → depende de la correlación (sesgado por el subconteo de ventas).
export default function MarketScoreCard({ spend = 0, impressions = 0, clicks = 0, conversions = 0, revenue = 0 }) {
  const metrics = useMemo(() => {
    const B = [
      { key: 'ctr',  label: 'CTR',        benchmark: 1.0, unit: '%', higher: true,  reliable: true,  value: impressions ? (clicks / impressions) * 100 : null,
        tip: 'CTR (Click-Through Rate): de cada 100 personas que vieron el anuncio, cuántas hicieron clic. Más alto = el anuncio atrae mejor. Fórmula: clicks ÷ impresiones.' },
      { key: 'cpc',  label: 'CPC',        benchmark: 5,   unit: '$', higher: false, reliable: true,  value: clicks ? spend / clicks : null,
        tip: 'CPC (Costo Por Clic): cuánto pagas, en promedio, por cada clic. Más bajo = más eficiente. Fórmula: gasto ÷ clicks.' },
      { key: 'cpm',  label: 'CPM',        benchmark: 70,  unit: '$', higher: false, reliable: true,  value: impressions ? (spend / impressions) * 1000 : null,
        tip: 'CPM (Costo Por Mil impresiones): cuánto cuesta que mil personas vean el anuncio. Más bajo = mejor alcance por peso. Fórmula: gasto ÷ impresiones × 1000.' },
      { key: 'conv', label: 'Conversión', benchmark: 1.5, unit: '%', higher: true,  reliable: false, value: clicks ? (conversions / clicks) * 100 : null,
        tip: 'Tasa de conversión: de quienes hicieron clic, qué porcentaje terminó comprando. Más alto = mejor. Fórmula: conversiones ÷ clicks. (Depende de la correlación: se ve más baja de lo real.)' },
      { key: 'cpa',  label: 'CPA',        benchmark: 300, unit: '$', higher: false, reliable: false, value: conversions ? spend / conversions : null,
        tip: 'CPA (Costo Por Adquisición): cuánto gastas en publicidad por cada venta. Más bajo = mejor. Fórmula: gasto ÷ conversiones. (Depende de la correlación: se ve más alto de lo real.)' },
      { key: 'roas', label: 'ROAS',       benchmark: 2.5, unit: 'x', higher: true,  reliable: false, value: spend ? revenue / spend : null,
        tip: 'ROAS (Return On Ad Spend): pesos de ingreso por cada peso gastado en anuncios. 2.5x = ganas $2.50 por cada $1. Más alto = mejor. Fórmula: ingresos ÷ gasto. (Depende de la correlación: se ve más bajo de lo real.)' },
    ];
    return B.map((m) => {
      if (m.value == null) return { ...m, rating: null, delta: null };
      const ratio = m.higher ? m.value / m.benchmark : m.benchmark / m.value;
      const rating = ratio >= 1.15 ? 'bueno' : ratio >= 0.85 ? 'promedio' : 'bajo';
      const delta = Math.round((ratio - 1) * 100);
      return { ...m, rating, delta };
    });
  }, [spend, impressions, clicks, conversions, revenue]);

  const badge = { bueno: 'bg-green-500/20 text-green-400', promedio: 'bg-amber-500/20 text-amber-400', bajo: 'bg-red-500/20 text-red-400' };
  const label = { bueno: 'Bueno', promedio: 'Promedio', bajo: 'Bajo' };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-semibold text-white">Puntuación vs. mercado</h2>
        <span className="text-xs text-gray-500">benchmarks de anuncios · ecommerce México</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">Cómo se compara el desempeño en el periodo contra el promedio del mercado mexicano.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {metrics.map((m) => {
          const fmtVal = (v) => m.unit === '$' ? `$${Math.round(v).toLocaleString('es-MX')}` : m.unit === 'x' ? `${v.toFixed(1)}x` : `${v.toFixed(1)}%`;
          const fmtBench = m.unit === '$' ? `$${m.benchmark.toLocaleString('es-MX')}` : m.unit === 'x' ? `${m.benchmark}x` : `${m.benchmark}%`;
          return (
            <div key={m.key} className={`rounded-lg p-4 border ${m.reliable ? 'bg-gray-900/40 border-gray-700/50' : 'bg-gray-900/20 border-gray-700/30'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  {m.label}
                  <span className="relative group inline-flex">
                    <svg className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-20 w-56 rounded-lg bg-gray-900 border border-gray-700 p-2.5 text-[11px] leading-snug text-gray-200 shadow-xl">
                      {m.tip}
                    </span>
                  </span>
                  {!m.reliable && <span className="text-[10px] text-gray-600">atribuido</span>}
                </span>
                {m.rating && <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${badge[m.rating]}`}>{label[m.rating]}</span>}
              </div>
              <p className={`text-2xl font-bold ${m.reliable ? 'text-white' : 'text-gray-400'}`}>{m.value != null ? fmtVal(m.value) : '—'}</p>
              <p className="text-xs text-gray-500 mt-1">
                mercado: {fmtBench}
                {m.delta != null && <span className={`ml-2 font-medium ${m.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>{m.delta >= 0 ? '+' : ''}{m.delta}%</span>}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-600 mt-4">CTR, CPC y CPM vienen directo de Facebook (confiables). Conversión, CPA y ROAS dependen de la correlación (marcados “atribuido”) — al subcontar ventas, se ven peor de lo real; tómalos como piso.</p>
    </div>
  );
}
