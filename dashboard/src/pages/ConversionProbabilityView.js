import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' };

function ConversionProbabilityView() {
  const navigate = useNavigate();

  // Mock: leads with predicted conversion probability
  const leads = useMemo(() => [
    { psid: '...84385053', name: 'Carlos M.', product: 'Confeccionada 6x4', messages: 4, probability: 92, status: 'hot' },
    { psid: '...69766019', name: 'Ana R.', product: 'Borde Separador', messages: 6, probability: 85, status: 'hot' },
    { psid: '...49974664', name: 'Miguel A.', product: 'Confeccionada 4x3', messages: 3, probability: 78, status: 'hot' },
    { psid: '...56279694', name: 'Lupita G.', product: 'Rollo Raschel 90%', messages: 2, probability: 65, status: 'warm' },
    { psid: '...28911712', name: 'Roberto S.', product: 'Confeccionada 8x6', messages: 5, probability: 55, status: 'warm' },
    { psid: '...72616546', name: 'Diana P.', product: 'Ground Cover', messages: 1, probability: 35, status: 'cold' },
    { psid: '...10146093', name: 'Jorge L.', product: 'Confeccionada 5x3', messages: 8, probability: 28, status: 'cold' },
    { psid: '...70359910', name: 'Sandra V.', product: 'Borde Separador 18m', messages: 1, probability: 15, status: 'cold' },
  ], []);

  const features = useMemo(() => [
    { name: 'Producto cotizado', importance: 32 },
    { name: 'Clicks en link', importance: 25 },
    { name: '# de mensajes', importance: 18 },
    { name: 'Hora del día', importance: 10 },
    { name: 'Canal (FB/WA)', importance: 8 },
    { name: 'Dispositivo', importance: 7 },
  ], []);

  const distro = useMemo(() => [
    { name: 'Alta (>70%)', value: 3, color: '#10B981' },
    { name: 'Media (40-70%)', value: 2, color: '#F59E0B' },
    { name: 'Baja (<40%)', value: 3, color: '#EF4444' },
  ], []);

  const statusColor = (s) => s === 'hot' ? 'text-green-400' : s === 'warm' ? 'text-amber-400' : 'text-red-400';
  const statusBg = (s) => s === 'hot' ? 'bg-green-500/10 border-green-500/30' : s === 'warm' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Probabilidad de Conversión</h1>
          <p className="text-sm text-gray-400">Regresión logística — predice qué leads comprarán</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Leads calientes (&gt;70%)</p>
          <p className="text-2xl font-bold text-green-400">3</p>
        </div>
        <div className="bg-gray-800/50 border border-amber-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Leads tibios (40-70%)</p>
          <p className="text-2xl font-bold text-amber-400">2</p>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Leads fríos (&lt;40%)</p>
          <p className="text-2xl font-bold text-red-400">3</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Feature importance */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Importancia de variables</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={features} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={v => `${v}%`} />
                <Bar dataKey="importance" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribution donut */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Distribución de probabilidades</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distro} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={4} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {distro.map((d, i) => <Cell key={i} fill={d.color} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Leads table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Leads activos</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-900/50">
            <tr className="text-left text-xs text-gray-400 uppercase">
              <th className="px-6 py-3">Cliente</th>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3 text-right">Mensajes</th>
              <th className="px-4 py-3 text-right">Probabilidad</th>
              <th className="px-4 py-3 text-center">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {leads.map((l, i) => (
              <tr key={i} className="hover:bg-gray-700/20">
                <td className="px-6 py-3 text-sm text-white font-medium">{l.name}</td>
                <td className="px-4 py-3 text-sm text-gray-300">{l.product}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-300">{l.messages}</td>
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

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
        ⚠️ Datos de ejemplo (mock). La implementación real usará regresión logística sobre ClickLogs convertidos vs no convertidos.
      </div>
    </div>
  );
}

export default ConversionProbabilityView;
