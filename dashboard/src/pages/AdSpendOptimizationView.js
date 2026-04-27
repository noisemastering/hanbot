import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import FeatureTip from '../components/FeatureTip';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };

function getDaysAgo(d) { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().split('T')[0]; }

function AdSpendOptimizationView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);
  const [expandedAd, setExpandedAd] = useState(null);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split('T')[0], []);

  useEffect(() => {
    setLoading(true);
    API.get(`/ml/spend-optimization?dateFrom=${dateFrom}&dateTo=${dateTo}`).then(res => {
      setData(res.data?.data || null);
    }).catch(err => console.error('Spend opt error:', err)).finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

  const effLabel = { optimal: 'Óptimo', good: 'Bueno', moderate: 'Moderado', diminishing: 'Decreciente', no_conversions: 'Sin conv.', no_data: 'Sin datos' };
  const effColor = { optimal: 'bg-green-500/10 border-green-500/30 text-green-400', good: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400', moderate: 'bg-amber-500/10 border-amber-500/30 text-amber-400', diminishing: 'bg-red-500/10 border-red-500/30 text-red-400', no_conversions: 'bg-gray-500/10 border-gray-500/30 text-gray-400', no_data: 'bg-gray-500/10 border-gray-500/30 text-gray-400' };

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  const ads = data?.ads || [];
  const totals = data?.totals || {};
  const eff = data?.efficiency || {};

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <FeatureTip id="spend-overview" title="Optimización de gasto" text="Analiza el rendimiento de cada anuncio: cuánto gastas vs cuánto vendes. Te recomienda dónde invertir más y dónde reducir." position="bottom">
            <div>
              <h1 className="text-2xl font-bold text-white">Optimización de Gasto</h1>
              <p className="text-sm text-gray-400">Análisis de rendimientos por anuncio — ROI total: {totals.roi}x</p>
            </div>
          </FeatureTip>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setRange(d)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${range === d ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>{d}d</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs text-gray-400">Gasto total</p>
          <p className="text-xl font-bold text-red-400">{fmt(totals.spend || 0)}</p>
        </div>
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-4">
          <p className="text-xs text-gray-400">Ingresos</p>
          <p className="text-xl font-bold text-green-400">{fmt(totals.revenue || 0)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400">CPA promedio</p>
          <p className="text-xl font-bold text-white">{totals.avgCpa ? fmt(totals.avgCpa) : '—'}</p>
        </div>
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-4">
          <p className="text-xs text-gray-400">Eficientes</p>
          <p className="text-xl font-bold text-green-400">{(eff.optimal || 0) + (eff.good || 0)}</p>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs text-gray-400">Decrecientes</p>
          <p className="text-xl font-bold text-red-400">{(eff.diminishing || 0) + (eff.no_conversions || 0)}</p>
        </div>
      </div>

      {/* Spend vs Revenue chart */}
      {ads.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Inversión vs Ingresos por anuncio</h2>
          <p className="text-sm text-gray-500 mb-4">Rojo = lo que gastas · Verde = lo que vendes · Si el verde es mayor, estás ganando dinero</p>
          <div className="h-80 overflow-x-auto">
            <div style={{ minWidth: Math.max(600, ads.filter(a => a.conversions > 0).length * 80) }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={ads.filter(a => a.spend > 0).slice(0, 15).map(a => ({
                    name: a.name.length > 18 ? a.name.substring(0, 18) + '...' : a.name,
                    fullName: a.name,
                    spend: a.spend,
                    revenue: a.revenue,
                    roi: a.roi
                  }))}
                  margin={{ top: 5, right: 20, bottom: 60, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} angle={-35} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#F3F4F6' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      const profit = d.revenue - d.spend;
                      return (
                        <div style={tooltipStyle} className="p-3 text-sm">
                          <p className="text-white font-medium mb-1">{d.fullName}</p>
                          <p style={{ color: '#EF4444' }}>Inversión: {fmt(d.spend)}</p>
                          <p style={{ color: '#10B981' }}>Ingresos: {fmt(d.revenue)}</p>
                          <p style={{ color: profit >= 0 ? '#10B981' : '#EF4444' }}>
                            {profit >= 0 ? 'Ganancia' : 'Pérdida'}: {fmt(Math.abs(profit))}
                          </p>
                          <p style={{ color: '#9CA3AF' }}>ROI: {d.roi}x</p>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                  <Bar dataKey="spend" name="Inversión" fill="#EF4444" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* What is this */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">¿Cómo leer esta tabla?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-300">
          <div className="space-y-3">
            <div>
              <p className="text-white font-medium mb-1">Gasto</p>
              <p>Lo que Facebook te cobró por mostrar este anuncio.</p>
            </div>
            <div>
              <p className="text-white font-medium mb-1">CPA (Costo por Adquisición)</p>
              <p>Cuánto te costó conseguir cada venta. <span className="text-green-400">Menor = mejor.</span> Se calcula: Gasto ÷ Conversiones.</p>
            </div>
            <div>
              <p className="text-white font-medium mb-1">ROI (Retorno de Inversión)</p>
              <p>Cuánto dinero regresó por cada peso invertido. <span className="text-green-400">ROI de 10x = por cada $1 invertido regresaron $10.</span></p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-white font-medium mb-1">Eficiencia</p>
              <div className="space-y-1">
                <p><span className="text-green-400">Óptimo</span> (ROI ≥ 20x) — Está funcionando muy bien, considera invertir más.</p>
                <p><span className="text-cyan-400">Bueno</span> (ROI ≥ 5x) — Funciona bien, mantener.</p>
                <p><span className="text-amber-400">Moderado</span> (ROI ≥ 1x) — Genera más de lo que cuesta pero podría mejorar.</p>
                <p><span className="text-red-400">Decreciente</span> (ROI &lt; 1x) — Estás perdiendo dinero, reducir o pausar.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Recomendaciones</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-6 py-3">Anuncio</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">Conv.</th>
                <th className="px-4 py-3 text-right">En objetivo</th>
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-4 py-3 text-right">ROI</th>
                <th className="px-4 py-3">Eficiencia</th>
                <th className="px-4 py-3">Recomendación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {ads.map((a, i) => (
                <React.Fragment key={i}>
                  <tr className="hover:bg-gray-700/20 cursor-pointer" onClick={() => setExpandedAd(expandedAd === i ? null : i)}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <svg className={`w-3 h-3 text-gray-500 transition-transform ${expandedAd === i ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        <div>
                          <span className="text-sm text-white font-medium">{a.name}</span>
                          {a.targetProduct && <p className="text-xs text-gray-500">Objetivo: {a.targetProduct}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-red-400">{fmt(a.spend)}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{a.conversions}</td>
                    <td className="px-4 py-3 text-right text-sm">
                      {a.conversions > 0 ? (
                        <span className={a.crossSellPct > 30 ? 'text-amber-400' : 'text-green-400'}>
                          {a.onTarget} <span className="text-gray-500">({100 - a.crossSellPct}%)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white">{a.cpa !== null ? fmt(a.cpa) : '—'}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{a.roi}x</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${effColor[a.efficiency]}`}>{effLabel[a.efficiency]}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{a.recommendation}</td>
                  </tr>
                  {expandedAd === i && a.products?.length > 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 bg-gray-900/30">
                        <div className="flex flex-col gap-3">
                          <p className="text-xs text-gray-400 font-medium uppercase">Desglose de ventas reales</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {a.products.map((p, j) => (
                              <div key={j} className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-3">
                                <p className="text-sm text-white font-medium">{p.product}</p>
                                <p className="text-xs text-gray-400 mt-1">{p.count} ventas · {fmt(p.revenue)}</p>
                                <div className="w-full h-1.5 bg-gray-700 rounded-full mt-2">
                                  <div className="h-full rounded-full bg-green-500" style={{ width: `${a.conversions > 0 ? (p.count / a.conversions * 100) : 0}%` }}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {a.crossSellPct > 0 && (
                            <p className="text-xs text-amber-400">
                              ⚠️ {a.crossSellPct}% de las ventas fueron de un producto diferente al objetivo del anuncio.
                              {a.crossSellPct > 30 && ' Considera ajustar el contenido del anuncio o redirigir el flujo.'}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Metodología</h2>
        <div className="space-y-2 text-sm text-gray-300">
          <p><span className="text-white font-medium">Fuentes:</span> Gasto e impresiones de Facebook Insights API; conversiones e ingresos del sistema de tracking (deduplicados por orderId).</p>
          <p><span className="text-white font-medium">ROI:</span> Ingresos atribuidos al anuncio ÷ Gasto en Facebook. Solo cuenta ventas de clientes que entraron por ese anuncio.</p>
          <p><span className="text-white font-medium">CPA:</span> Gasto ÷ Conversiones. Costo para adquirir un cliente que compra.</p>
          <p><span className="text-white font-medium">Clasificación:</span> Óptimo (ROI ≥ 20x), Bueno (≥ 5x), Moderado (≥ 1x), Decreciente (&lt; 1x).</p>
          <p><span className="text-white font-medium">Uso:</span> Escalar presupuesto en anuncios óptimos, revisar targeting en moderados, pausar los que tienen rendimiento decreciente.</p>
        </div>
      </div>
    </div>
  );
}

export default AdSpendOptimizationView;
