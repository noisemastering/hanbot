import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import FeatureTip from '../components/FeatureTip';
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };

const PRODUCT_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16', '#14B8A6', '#F97316'];

function SalesForecastView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(60);
  const [tab, setTab] = useState('global'); // global | products
  const [productData, setProductData] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      API.get(`/ml/forecast?days=${days}`),
      API.get(`/ml/forecast-by-product?days=${days}`)
    ]).then(([res, prodRes]) => {
      setData(res.data?.data || null);
      setProductData(prodRes.data?.data || null);
      if (!selectedProduct && prodRes.data?.data?.products?.length) {
        setSelectedProduct(prodRes.data.data.products[0].name);
      }
    }).catch(err => console.error('Forecast error:', err)).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.history.map(d => ({ ...d, forecast: null, upper: null, lower: null })),
      ...data.forecast.map(d => ({ dateLabel: d.dateLabel, dow: d.dow, revenue: null, movingAvg: null, forecast: d.revenue, upper: d.upper, lower: d.lower }))
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

      {/* Tab selector */}
      <FeatureTip id="forecast-tabs" title="Vista global vs por producto" text="Global muestra ingresos totales. Por Producto desglosa las ventas y proyección de cada medida." position="bottom">
        <div className="flex gap-2">
          <button onClick={() => setTab('global')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'global' ? 'bg-green-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>Global</button>
          <button onClick={() => setTab('products')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'products' ? 'bg-green-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>Por Producto</button>
        </div>
      </FeatureTip>

      {/* ─── PRODUCT TAB ─── */}
      {tab === 'products' && productData && (() => {
        const top3 = productData.products.slice(0, 3);
        // Build unified chart data for top 3: merge all dates
        const dateSet = new Set();
        top3.forEach(p => {
          p.daily.forEach(d => dateSet.add(d.date));
          p.forecast.forEach(d => dateSet.add(d.date));
        });
        const allDates = [...dateSet].sort();
        const top3ChartData = allDates.map(date => {
          const row = { date, dateLabel: new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) };
          top3.forEach((p, i) => {
            const hist = p.daily.find(d => d.date === date);
            const fc = p.forecast.find(d => d.date === date);
            row[`p${i}`] = hist?.revenue || null;
            row[`f${i}`] = fc?.revenue || null;
          });
          return row;
        });

        return (
        <>
          {/* Top 3 products chart — lines */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Top 3 productos</h2>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                {top3.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: PRODUCT_COLORS[i] }}></span> {p.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(700, top3ChartData.length * 22) }}>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={top3ChartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={v => v ? fmt(v) : '—'} />
                    <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                    {top3.map((p, i) => (
                      <Line key={`h${i}`} type="monotone" dataKey={`p${i}`} name={p.name} stroke={PRODUCT_COLORS[i]} strokeWidth={2} dot={{ fill: PRODUCT_COLORS[i], r: 2 }} connectNulls={false} />
                    ))}
                    {top3.map((p, i) => (
                      <Line key={`f${i}`} type="monotone" dataKey={`f${i}`} name={`${p.name} (proy.)`} stroke={PRODUCT_COLORS[i]} strokeWidth={2} strokeDasharray="6 3" dot={{ fill: PRODUCT_COLORS[i], r: 3 }} connectNulls={false} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Product summary table */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
            <div className="px-6 py-4 border-b border-gray-700/50">
              <h2 className="text-lg font-semibold text-white">Pronóstico por producto (top 10)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="px-6 py-3">Producto</th>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3 text-right">Inversión</th>
                    <th className="px-4 py-3 text-right">Ingresos</th>
                    <th className="px-4 py-3 text-right">ROI</th>
                    <th className="px-4 py-3 text-right">Órdenes</th>
                    <th className="px-4 py-3 text-right">Tendencia</th>
                    <th className="px-4 py-3 text-right">Proy. 7d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {productData.products.map((p, i) => (
                    <tr key={i} className={`hover:bg-gray-700/20 cursor-pointer ${selectedProduct === p.name ? 'bg-gray-700/30' : ''}`} onClick={() => setSelectedProduct(p.name)}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }}></span>
                          <span className="text-sm text-white font-medium">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded w-fit ${
                            p.driver === 'promo_paid' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                            : p.driver === 'paid' ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300'
                            : 'bg-green-500/10 border border-green-500/30 text-green-300'
                          }`}>{p.driverLabel}</span>
                          {p.promos?.length > 0 && p.promos.map((pr, j) => (
                            <span key={j} className="text-xs text-amber-400/70">{pr}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-red-400">{p.adSpend > 0 ? fmt(p.adSpend) : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-green-400">{fmt(p.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right text-sm text-white">{p.roi ? `${p.roi}x` : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-300">{p.totalOrders}</td>
                      <td className={`px-4 py-3 text-right text-sm font-medium ${p.trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {p.trend >= 0 ? '↗' : '↘'} {p.trend > 0 ? '+' : ''}{p.trend}%
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-purple-400">{p.forecastRevenue > 0 ? fmt(p.forecastRevenue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected product detail chart */}
          {(() => {
            const p = productData.products.find(pr => pr.name === selectedProduct);
            if (!p || p.daily.length < 3) return null;
            const pChartData = [
              ...p.daily.map(d => ({ dateLabel: d.dateLabel, revenue: d.revenue, forecast: null })),
              ...p.forecast.map(d => ({ dateLabel: d.dateLabel, revenue: null, forecast: d.revenue }))
            ];
            const pIdx = productData.products.indexOf(p);
            return (
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-4 rounded-full" style={{ backgroundColor: PRODUCT_COLORS[pIdx % PRODUCT_COLORS.length] }}></span>
                    <h2 className="text-lg font-semibold text-white">{p.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      p.driver === 'promo_paid' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                      : p.driver === 'paid' ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300'
                      : 'bg-green-500/10 border border-green-500/30 text-green-300'
                    }`}>{p.driverLabel}</span>
                    <span className="text-sm text-gray-400">R² = {p.r2}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: PRODUCT_COLORS[pIdx % PRODUCT_COLORS.length] }}></span> Real</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Proyección</span>
                  </div>
                </div>
                <div className="h-72 overflow-x-auto">
                  <div style={{ minWidth: Math.max(600, pChartData.length * 24) }}>
                    <ResponsiveContainer width="100%" height={288}>
                      <ComposedChart data={pChartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                        <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={v => v ? fmt(v) : '—'} />
                        <Bar dataKey="revenue" name="Ingresos" fill={PRODUCT_COLORS[pIdx % PRODUCT_COLORS.length]} fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                        <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
        );
      })()}

      {/* ─── GLOBAL TAB ─── */}
      {tab === 'global' && data && (
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
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Real</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cyan-500 inline-block"></span> Promedio 7d</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Proyección</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-purple-500/20 inline-block"></span> Rango probable</span>
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(800, chartData.length * 22) }}>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload || {};
                      return (
                        <div style={tooltipStyle} className="p-3 text-sm">
                          <p className="text-white font-medium mb-1">{label} {d.dow ? `(${d.dow})` : ''}</p>
                          {d.revenue != null && <p style={{ color: '#10B981' }}>Real: {fmt(d.revenue)}</p>}
                          {d.movingAvg != null && <p style={{ color: '#06B6D4' }}>Promedio 7d: {fmt(d.movingAvg)}</p>}
                          {d.forecast != null && <p style={{ color: '#8B5CF6' }}>Proyección: {fmt(d.forecast)}</p>}
                          {d.upper != null && <p style={{ color: '#9CA3AF' }}>Rango: {fmt(d.lower)} – {fmt(d.upper)}</p>}
                          {d.orders != null && d.orders > 0 && <p style={{ color: '#9CA3AF' }}>{d.orders} órdenes</p>}
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                  {/* Confidence band */}
                  <Area type="monotone" dataKey="upper" stroke="none" fill="#8B5CF6" fillOpacity={0.08} connectNulls={false} />
                  <Area type="monotone" dataKey="lower" stroke="none" fill="#1F2937" fillOpacity={1} connectNulls={false} />
                  {/* History bars */}
                  <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                  {/* 7-day moving average */}
                  <Line type="monotone" dataKey="movingAvg" name="Promedio 7d" stroke="#06B6D4" strokeWidth={2} dot={false} connectNulls={false} />
                  {/* Forecast line */}
                  <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Day-of-week pattern */}
          {data.dowSummary && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Patrón por día de la semana</h2>
              <p className="text-sm text-gray-500 mb-4">Promedio de ingresos según el día — la proyección usa estos pesos para ajustar</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.dowSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }}
                      formatter={(v, n) => [fmt(v), n]} />
                    <Bar dataKey="avg" name="Promedio" fill="#06B6D4" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Weekly trend */}
          {data.weeks && data.weeks.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Tendencia semanal</h2>
              <p className="text-sm text-gray-500 mb-4">R² = {data.r2} (semanal) — pendiente: {fmt(data.slope)}/semana</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.weeks} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#F3F4F6' }} itemStyle={{ color: '#F3F4F6' }} formatter={v => fmt(v)} />
                    <Line type="monotone" dataKey="revenue" name="Ingresos semanales" stroke="#8B5CF6" strokeWidth={2.5} dot={{ fill: '#8B5CF6', r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

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
