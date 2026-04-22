import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { abbrState } from '../utils/stateAbbr';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };

function CustomerSegmentationView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    API.get('/ml/segments').then(res => {
      setData(res.data?.data || null);
    }).catch(err => console.error('Segments error:', err)).finally(() => setLoading(false));
  }, []);

  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  const stateGender = data?.stateGender || [];
  const topSizes = data?.topSizes || [];
  const g = data?.genderTotals || { male: 0, female: 0, unknown: 0 };
  const total = g.male + g.female + g.unknown || 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Segmentación de Clientes</h1>
          <p className="text-sm text-gray-400">{data?.totalCustomers?.toLocaleString() || 0} órdenes únicas analizadas</p>
        </div>
      </div>

      {/* Global gender summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-blue-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Hombres</p>
          <p className="text-2xl font-bold text-blue-400">{g.male.toLocaleString()} <span className="text-lg text-gray-500">({Math.round(g.male / total * 100)}%)</span></p>
        </div>
        <div className="bg-gray-800/50 border border-pink-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Mujeres</p>
          <p className="text-2xl font-bold text-pink-400">{g.female.toLocaleString()} <span className="text-lg text-gray-500">({Math.round(g.female / total * 100)}%)</span></p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400">Sin determinar</p>
          <p className="text-2xl font-bold text-gray-400">{g.unknown.toLocaleString()} <span className="text-lg text-gray-500">({Math.round(g.unknown / total * 100)}%)</span></p>
        </div>
      </div>

      {/* State × Gender stacked bar chart */}
      {stateGender.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Compradores por estado y género</h2>
          <p className="text-sm text-gray-500 mb-4">Top 12 estados por número de órdenes</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stateGender.map(s => ({ ...s, state: abbrState(s.state) }))} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="state" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#F3F4F6' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={tooltipStyle} className="p-3 text-sm">
                        <p className="text-white font-medium mb-1">{label}</p>
                        <p style={{ color: '#3B82F6' }}>Hombres: {d.male} ({d.malePercent}%)</p>
                        <p style={{ color: '#EC4899' }}>Mujeres: {d.female} ({d.femalePercent}%)</p>
                        <p style={{ color: '#9CA3AF' }}>Total: {d.total} · Ticket prom: {fmt(d.avgOrder)}</p>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="male" name="Hombres" stackId="gender" fill="#3B82F6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="female" name="Mujeres" stackId="gender" fill="#EC4899" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* State detail table */}
      {stateGender.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Detalle por estado</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Hombres</th>
                  <th className="px-4 py-3 text-right">Mujeres</th>
                  <th className="px-4 py-3 text-right">Ticket Prom.</th>
                  <th className="px-4 py-3 text-right">Ingresos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {stateGender.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-white font-medium">{s.state}</td>
                    <td className="px-4 py-3 text-right text-sm text-white">{s.total}</td>
                    <td className="px-4 py-3 text-right text-sm text-blue-400">{s.male} ({s.malePercent}%)</td>
                    <td className="px-4 py-3 text-right text-sm text-pink-400">{s.female} ({s.femalePercent}%)</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{fmt(s.avgOrder)}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400">{fmt(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Size × Gender */}
      {topSizes.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Medida más vendida por género</h2>
          <p className="text-sm text-gray-500 mb-4">Top 10 medidas</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSizes} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="size" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#F3F4F6' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={tooltipStyle} className="p-3 text-sm">
                        <p className="text-white font-medium mb-1">{label}</p>
                        <p style={{ color: '#3B82F6' }}>Hombres: {d.male} ({d.malePercent}%)</p>
                        <p style={{ color: '#EC4899' }}>Mujeres: {d.female} ({d.femalePercent}%)</p>
                        <p style={{ color: '#9CA3AF' }}>Total: {d.total} · Ingresos: {fmt(d.revenue)}</p>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="male" name="Hombres" stackId="gender" fill="#3B82F6" />
                <Bar dataKey="female" name="Mujeres" stackId="gender" fill="#EC4899" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Methodology */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Metodología</h2>
        <div className="space-y-2 text-sm text-gray-300">
          <p><span className="text-white font-medium">Análisis:</span> Tabulación cruzada de género × estado de envío × medida de producto sobre órdenes de Mercado Libre.</p>
          <p><span className="text-white font-medium">Género:</span> Inferido del primer nombre del comprador usando un diccionario de ~700 nombres mexicanos (93% de cobertura).</p>
          <p><span className="text-white font-medium">Datos:</span> {data?.totalCustomers?.toLocaleString() || 0} órdenes únicas (deduplicadas por orderId).</p>
          <p><span className="text-white font-medium">Uso:</span> Identificar en qué estados hay más demanda por género para segmentar campañas de Facebook, y qué medidas compra cada segmento.</p>
        </div>
      </div>
    </div>
  );
}

export default CustomerSegmentationView;
