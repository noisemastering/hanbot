import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import FeatureTip from '../components/FeatureTip';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

function getDaysAgo(d) { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().split('T')[0]; }

function AdSpendOptimizationView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">CPA por anuncio</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ads.filter(a => a.cpa !== null).slice(0, 10).map(a => ({ name: a.name.length > 15 ? a.name.substring(0, 15) + '...' : a.name, cpa: a.cpa, conversions: a.conversions }))} margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#F3F4F6" }} itemStyle={{ color: "#F3F4F6" }} />
                <Bar yAxisId="left" dataKey="cpa" name="CPA" fill="#EF4444" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="conversions" name="Conversiones" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Gasto vs Conversiones</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" dataKey="x" name="Gasto" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <YAxis type="number" dataKey="y" name="Conv." tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <ZAxis type="number" dataKey="z" range={[60, 600]} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={(v, n) => n === 'Gasto' ? `$${v.toLocaleString()}` : v.toLocaleString()} />
                {ads.slice(0, 10).map((a, i) => (
                  <Scatter key={i} name={a.name} data={[{ x: a.spend, y: a.conversions, z: a.revenue }]} fill={COLORS[i % COLORS.length]} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
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
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-4 py-3 text-right">ROI</th>
                <th className="px-4 py-3">Eficiencia</th>
                <th className="px-4 py-3">Recomendación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {ads.map((a, i) => (
                <tr key={i} className="hover:bg-gray-700/20">
                  <td className="px-6 py-3 text-sm text-white font-medium max-w-[200px] truncate" title={a.name}>{a.name}</td>
                  <td className="px-4 py-3 text-right text-sm text-red-400">{fmt(a.spend)}</td>
                  <td className="px-4 py-3 text-right text-sm text-green-400">{a.conversions}</td>
                  <td className="px-4 py-3 text-right text-sm text-white">{a.cpa !== null ? fmt(a.cpa) : '—'}</td>
                  <td className="px-4 py-3 text-right text-sm text-green-400">{a.roi}x</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${effColor[a.efficiency]}`}>{effLabel[a.efficiency]}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{a.recommendation}</td>
                </tr>
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
