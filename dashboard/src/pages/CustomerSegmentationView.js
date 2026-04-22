import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

function CustomerSegmentationView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [k, setK] = useState(5);

  useEffect(() => {
    setLoading(true);
    API.get(`/ml/segments?k=${k}`).then(res => {
      setData(res.data?.data || null);
    }).catch(err => console.error('Segments error:', err)).finally(() => setLoading(false));
  }, [k]);

  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  const segments = data?.segments || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Segmentación de Clientes</h1>
            <p className="text-sm text-gray-400">K-Means — {data?.totalCustomers || 0} órdenes analizadas</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-sm text-gray-400">Clusters:</span>
          {[3, 4, 5, 6].map(n => (
            <button key={n} onClick={() => setK(n)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${k === n ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>{n}</button>
          ))}
        </div>
      </div>

      {segments.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Distribución de segmentos</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={segments.map(s => ({ name: s.label, value: s.count }))} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}>
                      {segments.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#F3F4F6" }} itemStyle={{ color: "#F3F4F6" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Clientes vs Ticket promedio</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" dataKey="x" name="Ticket" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                    <YAxis type="number" dataKey="y" name="Clientes" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <ZAxis type="number" dataKey="z" range={[100, 800]} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={(v, n) => n === 'Ticket' ? `$${v}` : v} />
                    {segments.map((s, i) => (
                      <Scatter key={i} name={s.label} data={[{ x: s.avgOrder, y: s.count, z: s.totalRevenue }]} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

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
                  <th className="px-4 py-3 text-right">Ingresos</th>
                  <th className="px-4 py-3">Producto Top</th>
                  <th className="px-4 py-3">Estado Top</th>
                  <th className="px-4 py-3">Género</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {segments.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3"><span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></span><span className="text-sm text-white font-medium">{s.label}</span></span></td>
                    <td className="px-4 py-3 text-right text-sm text-white">{s.count}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{fmt(s.avgOrder)}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{fmt(s.totalRevenue)}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{s.topProduct}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{s.topState}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{s.genderSplit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">Metodología</h2>
            <div className="space-y-2 text-sm text-gray-300">
              <p><span className="text-white font-medium">Modelo:</span> K-Means clustering (K={k}) sobre órdenes de compra reales.</p>
              <p><span className="text-white font-medium">Variables:</span> Monto de compra, género del comprador, estado de envío, categoría de producto.</p>
              <p><span className="text-white font-medium">Datos:</span> {data?.totalCustomers?.toLocaleString() || 0} órdenes únicas (deduplicadas por orderId de Mercado Libre).</p>
              <p><span className="text-white font-medium">Etiquetas:</span> Asignadas automáticamente según el ticket promedio y producto dominante del cluster.</p>
              <p><span className="text-white font-medium">Uso:</span> Identificar perfiles de compradores para segmentar campañas, ajustar mensajes del bot, y priorizar productos por segmento.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CustomerSegmentationView;
