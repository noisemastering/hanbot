import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

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
  const distro = [
    { name: `Alta (${summary.hot})`, value: summary.hot, color: '#10B981' },
    { name: `Media (${summary.warm})`, value: summary.warm, color: '#F59E0B' },
    { name: `Baja (${summary.cold})`, value: summary.cold, color: '#EF4444' },
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
          <p className="text-xs text-gray-400">Alta probabilidad (&gt;70%)</p>
          <p className="text-2xl font-bold text-green-400">{summary.hot}</p>
        </div>
        <div className="bg-gray-800/50 border border-amber-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Media probabilidad (40-70%)</p>
          <p className="text-2xl font-bold text-amber-400">{summary.warm}</p>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Baja probabilidad (&lt;40%)</p>
          <p className="text-2xl font-bold text-red-400">{summary.cold}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity breakdown */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Actividad de leads</h2>
          <div className="space-y-4">
            {(() => {
              const withClicks = leads.filter(l => l.clicks > 0).length;
              const noClicks = leads.filter(l => l.clicks === 0).length;
              const recent24h = leads.filter(l => l.hoursAgo < 24).length;
              const recent72h = leads.filter(l => l.hoursAgo >= 24 && l.hoursAgo < 72).length;
              const older = leads.filter(l => l.hoursAgo >= 72).length;
              const multiLink = leads.filter(l => l.links >= 3).length;
              const stats = [
                { label: 'Hicieron click en link', value: withClicks, total: leads.length, color: 'bg-green-500' },
                { label: 'No hicieron click', value: noClicks, total: leads.length, color: 'bg-red-500' },
                { label: 'Activos últimas 24h', value: recent24h, total: leads.length, color: 'bg-blue-500' },
                { label: 'Activos hace 1-3 días', value: recent72h, total: leads.length, color: 'bg-amber-500' },
                { label: 'Más de 3 días sin actividad', value: older, total: leads.length, color: 'bg-gray-500' },
                { label: 'Revisaron 3+ productos', value: multiLink, total: leads.length, color: 'bg-purple-500' },
              ];
              return stats.map((s, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{s.label}</span>
                    <span className="text-white font-medium">{s.value} <span className="text-gray-500">({s.total > 0 ? Math.round(s.value / s.total * 100) : 0}%)</span></span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full">
                    <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.total > 0 ? (s.value / s.total * 100) : 0}%` }}></div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
        {/* Distribution donut */}
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
                        {l.status === 'hot' ? 'Alta' : l.status === 'warm' ? 'Media' : 'Baja'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* What is this */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">¿Qué es esto?</h2>
        <p className="text-sm text-gray-300 mb-4">
          Esta vista analiza a las personas que recibieron un link de compra del bot pero <span className="text-white font-medium">aún no han comprado</span>.
          A cada una le asigna un puntaje de probabilidad de que termine comprando, basado en su comportamiento.
        </p>
        <h3 className="text-sm font-semibold text-white mb-2">¿Cómo se calcula?</h3>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-4 py-2">Señal</th>
                <th className="px-4 py-2">Peso</th>
                <th className="px-4 py-2">Lógica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              <tr><td className="px-4 py-2 text-gray-300">Tasa base</td><td className="px-4 py-2 text-purple-400">{summary.baseRate}%</td><td className="px-4 py-2 text-gray-400">Porcentaje histórico de leads que compran</td></tr>
              <tr><td className="px-4 py-2 text-gray-300">Hizo click en link</td><td className="px-4 py-2 text-green-400">+25%</td><td className="px-4 py-2 text-gray-400">Fue a Mercado Libre — intención de compra fuerte</td></tr>
              <tr><td className="px-4 py-2 text-gray-300">3+ links generados</td><td className="px-4 py-2 text-green-400">+10%</td><td className="px-4 py-2 text-gray-400">Revisó varios productos — está comparando</td></tr>
              <tr><td className="px-4 py-2 text-gray-300">5+ links generados</td><td className="px-4 py-2 text-green-400">+5%</td><td className="px-4 py-2 text-gray-400">Muy activo — probablemente va a comprar</td></tr>
              <tr><td className="px-4 py-2 text-gray-300">Activo hace &lt;24h</td><td className="px-4 py-2 text-blue-400">+15%</td><td className="px-4 py-2 text-gray-400">Todavía está comprando</td></tr>
              <tr><td className="px-4 py-2 text-gray-300">Activo hace 24-72h</td><td className="px-4 py-2 text-amber-400">+5%</td><td className="px-4 py-2 text-gray-400">Puede regresar</td></tr>
            </tbody>
          </table>
        </div>
        <h3 className="text-sm font-semibold text-white mb-2">Clasificación</h3>
        <div className="flex gap-4 mb-4">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500"></span><span className="text-sm text-gray-300"><span className="text-white">Alta</span> (&gt;70%) — priorizar seguimiento</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-500"></span><span className="text-sm text-gray-300"><span className="text-white">Media</span> (40-70%) — podría comprar con seguimiento</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500"></span><span className="text-sm text-gray-300"><span className="text-white">Baja</span> (&lt;40%) — probablemente ya no comprará</span></div>
        </div>
        <h3 className="text-sm font-semibold text-white mb-2">¿Para qué sirve?</h3>
        <p className="text-sm text-gray-300 mb-2">
          Si tienes un equipo de ventas que atiende handoffs, esta vista les dice <span className="text-white font-medium">a quién llamar primero</span>.
          Un lead de "Alta" probabilidad al 90% que hizo click hace 1 hora vale la pena contactarlo de inmediato.
          Un lead de "Baja" probabilidad al 20% que recibió un link hace 5 días probablemente ya se fue.
        </p>
        <h3 className="text-sm font-semibold text-white mb-2">Limitaciones</h3>
        <p className="text-sm text-gray-400">
          No es un modelo de machine learning entrenado — es un sistema de scoring por pesos fijos.
          Un modelo real (regresión logística) aprendería los pesos automáticamente de los datos históricos.
          Con tu tasa de conversión actual del {summary.baseRate}%, la mayoría de leads con actividad reciente salen como "Alta".
          Es más útil cuando la tasa de conversión es baja y hay que priorizar.
        </p>
      </div>
    </div>
  );
}

export default ConversionProbabilityView;
