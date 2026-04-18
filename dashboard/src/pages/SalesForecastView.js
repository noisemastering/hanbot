import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };

function SalesForecastView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(60);

  useEffect(() => {
    setLoading(true);
    API.get(`/ml/forecast?days=${days}`).then(res => {
      setData(res.data?.data || null);
    }).catch(err => console.error('Forecast error:', err)).finally(() => setLoading(false));
  }, [days]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.history.map(d => ({ ...d, forecast: null })),
      ...data.forecast.map(d => ({ dateLabel: d.dateLabel, revenue: null, forecast: d.revenue }))
    ];
  }, [data]);

  const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Pronóstico de Ventas</h1>
            <p className="text-sm text-gray-400">Regresión lineal sobre ingresos diarios — R² = {data?.r2 || 0}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {[30, 60, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${days === d ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>{d}d</button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Ingresos ({days}d)</p>
              <p className="text-2xl font-bold text-green-400">{fmt(data.totalHistoryRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-purple-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-400">Proyección 7 días</p>
              <p className="text-2xl font-bold text-purple-400">{fmt(data.totalForecastRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Promedio diario</p>
              <p className="text-2xl font-bold text-white">{fmt(data.avgDailyRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Tendencia</p>
              <p className={`text-2xl font-bold ${data.trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {data.trend >= 0 ? '↗' : '↘'} {data.trend > 0 ? '+' : ''}{data.trend}%
              </p>
            </div>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Ingresos diarios + proyección</h2>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Real</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Proyección</span>
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(800, chartData.length * 28) }}>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={v => v ? fmt(v) : '—'} />
                  <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                  <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Monthly Comparison */}
          {data.monthly && data.monthly.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Ingresos por mes</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.monthly} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#F3F4F6' }}
                      itemStyle={{ color: '#F3F4F6' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label}</p>
                            <p style={{ color: '#10B981' }}>Ingresos: {fmt(d.revenue)}</p>
                            {d.isPartial && d.projected && <p style={{ color: '#8B5CF6' }}>Proyectado mes: {fmt(d.projected)}</p>}
                            {d.dailyRate && <p style={{ color: '#9CA3AF' }}>Promedio diario: {fmt(d.dailyRate)}</p>}
                            <p style={{ color: '#9CA3AF' }}>Órdenes: {d.orders}</p>
                            <p style={{ color: '#9CA3AF' }}>Ticket prom: {fmt(d.avgOrder)}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar yAxisId="left" dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="left" dataKey="projected" name="Proyección mes" fill="#8B5CF6" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="orders" name="Órdenes" stroke="#F59E0B" strokeWidth={2} dot={{ fill: '#F59E0B', r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Monthly table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="px-4 py-2">Mes</th>
                      <th className="px-4 py-2 text-right">Ingresos</th>
                      <th className="px-4 py-2 text-right">Órdenes</th>
                      <th className="px-4 py-2 text-right">Ticket Prom.</th>
                      <th className="px-4 py-2 text-right">Prom. Diario</th>
                      <th className="px-4 py-2 text-right">Proyección Mes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {data.monthly.map((m, i) => (
                      <tr key={i} className="hover:bg-gray-700/20">
                        <td className="px-4 py-2 text-sm text-white font-medium">{m.label} {m.isPartial && <span className="text-xs text-gray-500">(parcial)</span>}</td>
                        <td className="px-4 py-2 text-right text-sm text-green-400">{fmt(m.revenue)}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{m.orders}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{fmt(m.avgOrder)}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{m.dailyRate ? fmt(m.dailyRate) : '—'}</td>
                        <td className="px-4 py-2 text-right text-sm text-purple-400">{m.projected ? fmt(m.projected) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Seasonality Warning */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🌡️</span>
              <div>
                <h3 className="text-white font-semibold mb-1">Nota sobre estacionalidad</h3>
                <p className="text-sm text-amber-200/80">
                  La malla sombra es un producto de temporada — las ventas son significativamente más altas en meses cálidos (marzo–agosto) y disminuyen en meses fríos (octubre–febrero).
                  La proyección lineal <span className="text-white font-medium">no ajusta por estacionalidad</span> porque aún no hay datos de un ciclo completo.
                  A partir de octubre 2026 el sistema tendrá suficiente historia para calcular ajustes estacionales automáticos (Holt-Winters).
                </p>
                <p className="text-sm text-amber-200/80 mt-2">
                  <span className="text-white font-medium">Recomendación:</span> Usar la proyección diaria para planear a corto plazo (1-2 semanas), pero considerar que los ingresos probablemente bajarán conforme se acerque el otoño.
                </p>
              </div>
            </div>
          </div>

          {/* Methodology */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">Metodología</h2>
            <div className="space-y-2 text-sm text-gray-300">
              <p><span className="text-white font-medium">Modelo:</span> Regresión lineal simple (y = mx + b) sobre ingresos diarios históricos.</p>
              <p><span className="text-white font-medium">R² = {data?.r2 || 0}:</span> {data?.r2 >= 0.7 ? 'Ajuste alto — el modelo explica bien la variación en ingresos.' : data?.r2 >= 0.4 ? 'Ajuste moderado — hay factores no capturados por el modelo (promos, estacionalidad).' : 'Ajuste bajo — los ingresos tienen mucha variación diaria. La proyección es orientativa.'}</p>
              <p><span className="text-white font-medium">Pendiente:</span> {data?.slope > 0 ? `+$${data.slope.toLocaleString()}/día — los ingresos están creciendo.` : data?.slope < 0 ? `$${data.slope.toLocaleString()}/día — los ingresos están decreciendo.` : 'Estable.'}</p>
              <p><span className="text-white font-medium">Datos:</span> {data?.history?.length || 0} días de historia, {data?.totalHistoryRevenue ? (data.history.reduce((s,d) => s + d.orders, 0)).toLocaleString() : 0} órdenes únicas (deduplicadas por orderId).</p>
              <p><span className="text-white font-medium">Estacionalidad:</span> Aún no incorporada — se requieren al menos 12 meses de datos para un modelo estacional (Holt-Winters/SARIMA). Disponible estimado: octubre 2026.</p>
              <p><span className="text-white font-medium">Limitaciones:</span> No incorpora promos futuras, cambios en presupuesto de ads, ni variaciones de temperatura. Usar como referencia orientativa.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SalesForecastView;
