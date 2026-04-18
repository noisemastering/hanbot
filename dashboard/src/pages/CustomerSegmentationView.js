import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' };
const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

function CustomerSegmentationView() {
  const navigate = useNavigate();

  const segments = useMemo(() => [
    { name: 'Hogar Urbano', count: 620, avgOrder: 690, topProduct: 'Confeccionada 6x4', topState: 'Edoméx', gender: '55% M / 45% F', color: COLORS[0] },
    { name: 'Agricultor Mayoreo', count: 340, avgOrder: 2800, topProduct: 'Rollo Raschel 4.2x100', topState: 'Jalisco', gender: '82% M / 18% F', color: COLORS[1] },
    { name: 'Revendedor', count: 180, avgOrder: 4500, topProduct: 'Rollo Raschel 90%', topState: 'Nuevo León', gender: '71% M / 29% F', color: COLORS[2] },
    { name: 'Jardín Premium', count: 410, avgOrder: 1200, topProduct: 'Borde Separador 54m', topState: 'CDMX', gender: '38% M / 62% F', color: COLORS[3] },
    { name: 'Compra Única', count: 184, avgOrder: 480, topProduct: 'Confeccionada 4x3', topState: 'Puebla', gender: '60% M / 40% F', color: COLORS[4] },
  ], []);

  const scatterData = useMemo(() => segments.map(s => ({
    name: s.name, x: s.avgOrder, y: s.count, z: s.avgOrder * s.count, color: s.color
  })), [segments]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Segmentación de Clientes</h1>
          <p className="text-sm text-gray-400">K-Means clustering por estado, género, producto y monto de compra</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Segment distribution donut */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Distribución de segmentos</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={segments.map(s => ({ name: s.name, value: s.count }))} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {segments.map((s, i) => <Cell key={i} fill={s.color} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Scatter: avg order vs count */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Clientes vs Ticket promedio</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" dataKey="x" name="Ticket promedio" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <YAxis type="number" dataKey="y" name="Clientes" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <ZAxis type="number" dataKey="z" range={[100, 1000]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => n === 'Ticket promedio' ? `$${v}` : v} />
                {segments.map((s, i) => (
                  <Scatter key={i} name={s.name} data={[scatterData[i]]} fill={s.color} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Segment details table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Detalle por segmento</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-900/50">
            <tr className="text-left text-xs text-gray-400 uppercase">
              <th className="px-6 py-3">Segmento</th>
              <th className="px-4 py-3 text-right">Clientes</th>
              <th className="px-4 py-3 text-right">Ticket Prom.</th>
              <th className="px-4 py-3">Producto Top</th>
              <th className="px-4 py-3">Estado Top</th>
              <th className="px-4 py-3">Género</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {segments.map((s, i) => (
              <tr key={i} className="hover:bg-gray-700/20">
                <td className="px-6 py-3"><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></span><span className="text-sm text-white font-medium">{s.name}</span></span></td>
                <td className="px-4 py-3 text-right text-sm text-white">{s.count}</td>
                <td className="px-4 py-3 text-right text-sm text-green-400">${s.avgOrder.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-gray-300">{s.topProduct}</td>
                <td className="px-4 py-3 text-sm text-gray-300">{s.topState}</td>
                <td className="px-4 py-3 text-sm text-gray-300">{s.gender}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
        ⚠️ Datos de ejemplo (mock). La implementación real usará K-Means sobre datos reales de compras, geografía y género.
      </div>
    </div>
  );
}

export default CustomerSegmentationView;
