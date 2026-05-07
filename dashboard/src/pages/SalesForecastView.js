import React, { useState, useEffect, useMemo, useCallback } from 'react';
import API from '../api';
import {
  ComposedChart, Bar, Line, Area, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-MX');

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function SalesForecastView() {
  // ── CONFIG STATE (shown first, before any data loads) ──
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState({
    source: 'ml',           // 'ml' | 'ml+meta'
    seasonality: false,
    productFamilyId: '',     // '' = all products
    days: 90
  });

  // ── DATA STATE ──
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [families, setFamilies] = useState([]);
  const [familiesLoading, setFamiliesLoading] = useState(true);

  // Fetch available product families on mount
  useEffect(() => {
    setFamiliesLoading(true);
    fetch(`${API_URL}/product-families/tree`).then(r => r.json()).then(res => {
      if (res.success) {
        const roots = (res.data || []).filter(f => !f.parentId && !f.sellable);
        // Flatten to root + direct non-sellable children
        const flat = [];
        for (const root of roots) {
          flat.push({ id: root._id, name: root.name, level: 0 });
          if (root.children) {
            for (const child of root.children.filter(c => !c.sellable)) {
              flat.push({ id: child._id, name: child.name, level: 1, parent: root.name });
            }
          }
        }
        setFamilies(flat);
      }
    }).catch(() => {}).finally(() => setFamiliesLoading(false));
  }, []);

  const generateForecast = useCallback(async () => {
    setLoading(true);
    setConfigured(true);
    try {
      const params = new URLSearchParams({
        days: config.days.toString(),
        source: config.source,
        seasonality: config.seasonality.toString()
      });
      if (config.productFamilyId) {
        params.set('productFamilyId', config.productFamilyId);
        params.set('includeSubfamilies', 'true');
      }
      const res = await API.get(`/ml/forecast-v2?${params.toString()}`);
      setData(res.data?.data || null);
    } catch (err) {
      console.error('Forecast error:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [config]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.history.map(d => ({ ...d, forecast: null, upper: null, lower: null })),
      ...data.forecast.map(d => ({ dateLabel: d.dateLabel, dow: d.dow, revenue: null, movingAvg: null, forecast: d.revenue, upper: d.upper, lower: d.lower, orders: d.orders }))
    ];
  }, [data]);

  const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  const selectedFamilyName = families.find(f => f.id === config.productFamilyId)?.name || 'Todos los productos';

  // ── CONFIG PANEL (always shown) ──
  const configPanel = (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-6">
      <h3 className="text-sm font-medium text-gray-400 uppercase mb-5">Configurar pronóstico</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Data source */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Fuente de datos</label>
          <div className="space-y-2">
            <button onClick={() => setConfig(c => ({ ...c, source: 'ml' }))}
              className={`w-full p-3 rounded-lg border text-left text-sm transition-all ${config.source === 'ml' ? 'bg-primary-500/10 border-primary-500/50 text-white' : 'bg-gray-900/30 border-gray-700/50 text-gray-400 hover:border-gray-600'}`}>
              <p className="font-medium">Mercado Libre</p>
              <p className="text-xs text-gray-500 mt-0.5">Ventas reales de ML + ventas manuales</p>
            </button>
            <button onClick={() => setConfig(c => ({ ...c, source: 'ml+meta' }))}
              className={`w-full p-3 rounded-lg border text-left text-sm transition-all ${config.source === 'ml+meta' ? 'bg-primary-500/10 border-primary-500/50 text-white' : 'bg-gray-900/30 border-gray-700/50 text-gray-400 hover:border-gray-600'}`}>
              <p className="font-medium">ML + Meta Campaigns</p>
              <p className="text-xs text-gray-500 mt-0.5">Incluye atribución de campañas de Facebook</p>
            </button>
          </div>
        </div>

        {/* Product family */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Producto</label>
          {familiesLoading ? (
            <div className="animate-pulse bg-gray-700/50 h-10 rounded-lg" />
          ) : (
            <select value={config.productFamilyId} onChange={e => setConfig(c => ({ ...c, productFamilyId: e.target.value }))}
              className="w-full px-4 py-2.5 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Todos los productos</option>
              {families.map(f => (
                <option key={f.id} value={f.id}>
                  {f.level === 1 ? `  └ ${f.name}` : f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Period */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Periodo</label>
          <div className="flex gap-2">
            {[30, 60, 90, 180, 365].map(d => (
              <button key={d} onClick={() => setConfig(c => ({ ...c, days: d }))}
                className={`flex-1 px-2 py-2.5 rounded-lg text-sm font-medium transition-all ${config.days === d ? 'bg-primary-500 text-white' : 'bg-gray-900/30 border border-gray-700/50 text-gray-400 hover:border-gray-600'}`}>
                {d >= 365 ? '1a' : d >= 180 ? '6m' : `${d}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Modifiers */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Modificadores</label>
          <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all bg-gray-900/30 border-gray-700/50 hover:border-gray-600">
            <input type="checkbox" checked={config.seasonality} onChange={e => setConfig(c => ({ ...c, seasonality: e.target.checked }))}
              className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
            <div>
              <p className="text-sm text-white">Estacionalidad</p>
              <p className="text-xs text-gray-500">Ajuste por mes del año</p>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <button onClick={generateForecast} disabled={loading}
          className="px-8 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors text-sm font-medium">
          {loading ? 'Generando...' : configured ? 'Regenerar pronóstico' : 'Generar pronóstico'}
        </button>
      </div>
    </div>
  );

  // ── LOADING ──
  if (loading && !data) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
        <p className="text-gray-400 mb-6">Configura y genera tu pronóstico basado en datos reales</p>
        {configPanel}
        <div className="p-12 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 mt-4">Analizando datos...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Pronóstico de Ventas</h1>
      <p className="text-gray-400 mb-6">Configura y genera tu pronóstico basado en datos reales</p>

      {configPanel}

      {/* Not configured yet */}
      {!configured && (
        <div className="p-16 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-4xl mb-4">📊</p>
          <h3 className="text-lg font-semibold text-white mb-2">Configura tu pronóstico</h3>
          <p className="text-gray-400 max-w-md mx-auto">Selecciona la fuente de datos, el producto y el periodo. Luego presiona "Generar pronóstico" para ver las proyecciones.</p>
        </div>
      )}

      {/* No data */}
      {configured && !loading && data && data.history.length === 0 && (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <p className="text-gray-400">No hay datos suficientes para este filtro. Intenta con un periodo más largo o un producto diferente.</p>
        </div>
      )}

      {/* ── RESULTS ── */}
      {configured && data && data.history.length > 0 && (
        <div className="space-y-6">
          {/* Active config badge */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
              {config.source === 'ml' ? 'Mercado Libre' : 'ML + Meta'}
            </span>
            <span className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
              {selectedFamilyName}
            </span>
            <span className="px-2 py-1 rounded bg-gray-500/10 border border-gray-500/30 text-gray-300">
              {config.days >= 365 ? '1 año' : config.days >= 180 ? '6 meses' : `${config.days} días`}
            </span>
            {config.seasonality && (
              <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                Estacionalidad
              </span>
            )}
            <span className="text-gray-500">R² = {data.r2}</span>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <p className="text-xs text-gray-400">Ingresos ({config.days >= 365 ? '1a' : config.days >= 180 ? '6m' : config.days + 'd'})</p>
              <p className="text-2xl font-bold text-green-400">{fmt(data.totalHistoryRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 border border-purple-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-400">Proyección 14 días</p>
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

          {/* Main chart: daily + forecast */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Ingresos diarios + proyección</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Real</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cyan-500 inline-block"></span> Promedio 7d</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Proyección</span>
              </div>
            </div>
            <div className="h-80 overflow-x-auto">
              <div style={{ minWidth: Math.max(800, chartData.length * 18) }}>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
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
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                    <Area type="monotone" dataKey="upper" stroke="none" fill="#8B5CF6" fillOpacity={0.08} connectNulls={false} />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="#1F2937" fillOpacity={1} connectNulls={false} />
                    <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="movingAvg" name="Promedio 7d" stroke="#06B6D4" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Seasonality chart (if enabled) */}
          {data.seasonSummary && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Estacionalidad mensual</h2>
              <p className="text-sm text-gray-500 mb-4">Multiplicador por mes — valores &gt;1 indican meses fuertes, &lt;1 meses débiles</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.seasonSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} domain={[0, 'auto']} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v.toFixed(2) + 'x', 'Multiplicador']} />
                    <ReferenceLine y={1} stroke="#6B7280" strokeDasharray="4 4" />
                    <Bar dataKey="multiplier" name="Multiplicador" radius={[4, 4, 0, 0]}
                      fill="#F59E0B"
                      // Color bars based on value
                      label={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* DOW pattern */}
          {data.dowSummary && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Patrón por día de la semana</h2>
              <p className="text-sm text-gray-500 mb-4">Promedio de ingresos según el día</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dowSummary} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="day" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(v), 'Promedio']} />
                    <Bar dataKey="avg" name="Promedio" fill="#06B6D4" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Monthly breakdown */}
          {data.monthly && data.monthly.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Ingresos por mes</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.monthly} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={tooltipStyle} className="p-3 text-sm">
                            <p className="text-white font-medium mb-1">{label}</p>
                            <p style={{ color: '#10B981' }}>Ingresos: {fmt(d.revenue)}</p>
                            {d.isPartial && d.projected && <p style={{ color: '#8B5CF6' }}>Proyectado mes: {fmt(d.projected)}</p>}
                            <p style={{ color: '#9CA3AF' }}>Órdenes: {d.orders} | Ticket: {fmt(d.avgOrder)}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="projected" name="Proyección mes" fill="#8B5CF6" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
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
                      <th className="px-4 py-2 text-right">Proyección</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {data.monthly.map((m, i) => (
                      <tr key={i} className="hover:bg-gray-700/20">
                        <td className="px-4 py-2 text-sm text-white font-medium">{m.label} {m.isPartial && <span className="text-xs text-gray-500">(parcial)</span>}</td>
                        <td className="px-4 py-2 text-right text-sm text-green-400">{fmt(m.revenue)}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{m.orders}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-300">{fmt(m.avgOrder)}</td>
                        <td className="px-4 py-2 text-right text-sm text-purple-400">{m.projected ? fmt(m.projected) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Weekly trend */}
          {data.weeks && data.weeks.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Tendencia semanal</h2>
              <p className="text-sm text-gray-500 mb-4">R² = {data.r2} — pendiente: {fmt(data.slope)}/semana</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.weeks} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={v => fmt(v)} />
                    <Line type="monotone" dataKey="revenue" name="Ingresos" stroke="#8B5CF6" strokeWidth={2.5} dot={{ fill: '#8B5CF6', r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SalesForecastView;
