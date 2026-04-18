import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };

function ConversionProbabilityView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    API.get(`/ml/conversion-probability?days=${days}`).then(res => {
      setData(res.data?.data || null);
    }).catch(err => console.error('Conversion error:', err)).finally(() => setLoading(false));
  }, [days]);

  const statusColor = (s) => s === 'hot' ? 'text-green-400' : s === 'warm' ? 'text-amber-400' : 'text-red-400';
  const statusBg = (s) => s === 'hot' ? 'bg-green-500/10 border-green-500/30' : s === 'warm' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30';

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  const summary = data?.summary || { hot: 0, warm: 0, cold: 0, baseRate: 0 };
  const leads = data?.leads || [];
  const features = data?.featureImportance || [];
  const distro = [
    { name: `Caliente (${summary.hot})`, value: summary.hot, color: '#10B981' },
    { name: `Tibio (${summary.warm})`, value: summary.warm, color: '#F59E0B' },
    { name: `Frío (${summary.cold})`, value: summary.cold, color: '#EF4444' },
  ].filter(d => d.value > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Probabilidad de Conversión</h1>
            <p className="text-sm text-gray-400">Scoring de leads — tasa base: {summary.baseRate}% — {data?.totalAnalyzed || 0} analizados</p>
          </div>
        </div>
        <div className="flex gap-2">
          {[3, 7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${days === d ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>{d}d</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Calientes (&gt;70%)</p>
          <p className="text-2xl font-bold text-green-400">{summary.hot}</p>
        </div>
        <div className="bg-gray-800/50 border border-amber-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Tibios (40-70%)</p>
          <p className="text-2xl font-bold text-amber-400">{summary.warm}</p>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Fríos (&lt;40%)</p>
          <p className="text-2xl font-bold text-red-400">{summary.cold}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Importancia de variables</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={features} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={120} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={v => `${v}%`} />
                <Bar dataKey="importance" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Distribución</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distro} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={4} dataKey="value"
                  label={({ name }) => name}>
                  {distro.map((d, i) => <Cell key={i} fill={d.color} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#F3F4F6" }} itemStyle={{ color: "#F3F4F6" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {leads.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Leads activos (top 50)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Links</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Hace</th>
                  <th className="px-4 py-3 text-right">Probabilidad</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {leads.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-white font-medium">{l.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{l.product}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{l.links}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{l.clicks}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-400">{l.hoursAgo < 24 ? `${l.hoursAgo}h` : `${Math.round(l.hoursAgo/24)}d`}</td>
                    <td className={`px-4 py-3 text-right text-sm font-bold ${statusColor(l.status)}`}>{l.probability}%</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded border ${statusBg(l.status)} ${statusColor(l.status)}`}>
                        {l.status === 'hot' ? 'Caliente' : l.status === 'warm' ? 'Tibio' : 'Frío'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Metodología</h2>
        <div className="space-y-2 text-sm text-gray-300">
          <p><span className="text-white font-medium">Modelo:</span> Scoring basado en pesos de actividad (similar a regresión logística simplificada).</p>
          <p><span className="text-white font-medium">Variables:</span> Si hizo click en link (+25%), actividad reciente &lt;24h (+15%), múltiples links (+10-15%), tasa base histórica.</p>
          <p><span className="text-white font-medium">Tasa base:</span> {summary.baseRate}% — porcentaje histórico de leads que compran.</p>
          <p><span className="text-white font-medium">Clasificación:</span> Caliente (&gt;70%), Tibio (40-70%), Frío (&lt;40%).</p>
          <p><span className="text-white font-medium">Uso:</span> Priorizar handoffs humanos hacia leads calientes y optimizar el seguimiento del bot.</p>
        </div>
      </div>
    </div>
  );
}

export default ConversionProbabilityView;
