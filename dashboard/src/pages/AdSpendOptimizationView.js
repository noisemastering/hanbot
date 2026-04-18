import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' };
const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

function AdSpendOptimizationView() {
  const navigate = useNavigate();

  const ads = useMemo(() => [
    { name: 'pROMO 4X6', spend: 5680, conversions: 1685, revenue: 1227193, cpa: 3.37, roi: 216, efficiency: 'optimal' },
    { name: 'Distribuidores', spend: 2884, conversions: 48, revenue: 38463, cpa: 60, roi: 13, efficiency: 'moderate' },
    { name: 'Comparativa', spend: 1200, conversions: 25, revenue: 13390, cpa: 48, roi: 11, efficiency: 'moderate' },
    { name: 'Como llega reel', spend: 850, conversions: 15, revenue: 12054, cpa: 57, roi: 14, efficiency: 'moderate' },
    { name: 'Carrusel', spend: 720, conversions: 14, revenue: 10698, cpa: 51, roi: 15, efficiency: 'moderate' },
    { name: 'Borde Separador', spend: 2100, conversions: 2, revenue: 960, cpa: 1050, roi: 0.5, efficiency: 'diminishing' },
  ], []);

  const cpaChart = useMemo(() => ads.map(a => ({
    name: a.name.length > 15 ? a.name.substring(0, 15) + '...' : a.name,
    spend: a.spend,
    cpa: Math.round(a.cpa),
    conversions: a.conversions,
    color: a.efficiency === 'optimal' ? '#10B981' : a.efficiency === 'moderate' ? '#F59E0B' : '#EF4444'
  })), [ads]);

  const scatterData = useMemo(() => ads.map((a, i) => ({
    name: a.name,
    x: a.spend,
    y: a.conversions,
    z: a.revenue,
    color: COLORS[i % COLORS.length]
  })), [ads]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Optimización de Gasto</h1>
          <p className="text-sm text-gray-400">Análisis de rendimientos decrecientes por anuncio</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400">Gasto total</p>
          <p className="text-2xl font-bold text-red-400">$30,863</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400">CPA promedio</p>
          <p className="text-2xl font-bold text-white">$17.80</p>
        </div>
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Ads eficientes</p>
          <p className="text-2xl font-bold text-green-400">1</p>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Ads con rendimiento decreciente</p>
          <p className="text-2xl font-bold text-red-400">1</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPA per ad */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">CPA por anuncio</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cpaChart} margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar yAxisId="left" dataKey="cpa" name="CPA" fill="#EF4444" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="conversions" name="Conversiones" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Spend vs Conversions scatter */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Gasto vs Conversiones</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" dataKey="x" name="Gasto" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <YAxis type="number" dataKey="y" name="Conversiones" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <ZAxis type="number" dataKey="z" range={[80, 800]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => n === 'Gasto' ? `$${v.toLocaleString()}` : v.toLocaleString()} />
                {scatterData.map((s, i) => (
                  <Scatter key={i} name={s.name} data={[s]} fill={s.color} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Recomendaciones</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-900/50">
            <tr className="text-left text-xs text-gray-400 uppercase">
              <th className="px-6 py-3">Anuncio</th>
              <th className="px-4 py-3 text-right">Gasto</th>
              <th className="px-4 py-3 text-right">CPA</th>
              <th className="px-4 py-3 text-right">ROI</th>
              <th className="px-4 py-3">Eficiencia</th>
              <th className="px-4 py-3">Recomendación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {ads.map((a, i) => (
              <tr key={i} className="hover:bg-gray-700/20">
                <td className="px-6 py-3 text-sm text-white font-medium">{a.name}</td>
                <td className="px-4 py-3 text-right text-sm text-red-400">${a.spend.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-sm text-white">${Math.round(a.cpa)}</td>
                <td className="px-4 py-3 text-right text-sm text-green-400">{a.roi}x</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded border ${
                    a.efficiency === 'optimal' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    a.efficiency === 'moderate' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    {a.efficiency === 'optimal' ? 'Óptimo' : a.efficiency === 'moderate' ? 'Moderado' : 'Decreciente'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {a.efficiency === 'optimal' ? 'Escalar presupuesto ↑' :
                   a.efficiency === 'moderate' ? 'Mantener y optimizar' :
                   'Reducir o pausar ↓'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
        ⚠️ Datos de ejemplo (mock). La implementación real analizará la curva de rendimiento de cada anuncio con regresión lineal sobre gasto vs conversiones diarias.
      </div>
    </div>
  );
}

export default AdSpendOptimizationView;
