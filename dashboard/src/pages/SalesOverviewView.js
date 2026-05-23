import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const PERIODS = [
  { value: '7', label: '7d' },
  { value: '15', label: '15d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1a' },
  { value: 'all', label: 'Todo' }
];

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('es-MX');
}

function fmtDate(dateStr) {
  if (!dateStr) return '---';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SalesOverviewView() {
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/sales-overview?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexion');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Determine which months fall within the selected period for highlighting
  const getMonthlyChartData = () => {
    if (!data?.monthly) return [];
    if (period === 'all') {
      return data.monthly.map(m => ({ ...m, inPeriod: true }));
    }
    const days = parseInt(period, 10);
    if (isNaN(days)) return data.monthly.map(m => ({ ...m, inPeriod: true }));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    return data.monthly.map(m => ({
      ...m,
      inPeriod: m.month >= cutoffMonth
    }));
  };

  const channelPieData = data ? [
    { name: 'Mercado Libre', value: data.totals.channels.ml.revenue, color: '#facc15' },
    { name: 'Ventas Manuales', value: data.totals.channels.manual.revenue, color: '#60a5fa' }
  ].filter(d => d.value > 0) : [];

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">Cargando resumen de ventas...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  const monthlyChartData = getMonthlyChartData();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Resumen de Ventas</h1>
        <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* All-time banner */}
      {data?.allTimeTotals && (
        <div className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-xl px-6 py-4">
          <p className="text-gray-300 text-sm">
            Desde {fmtDate(data.allTimeTotals.firstOrderDate)}:{' '}
            <span className="text-white font-semibold text-lg">{fmt(data.allTimeTotals.revenue)}</span>
            {' '}total,{' '}
            <span className="text-white font-semibold">{data.allTimeTotals.orders.toLocaleString('es-MX')}</span>
            {' '}ordenes
          </p>
        </div>
      )}

      {/* KPI cards */}
      {data?.totals && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm mb-1">Ingresos</p>
            <p className="text-2xl font-bold text-white">{fmt(data.totals.revenue)}</p>
            <div className="mt-2 text-xs text-gray-500">
              ML: {fmt(data.totals.channels.ml.revenue)} | Manual: {fmt(data.totals.channels.manual.revenue)}
            </div>
          </div>

          {/* Orders */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm mb-1">Ordenes</p>
            <p className="text-2xl font-bold text-white">{data.totals.orders.toLocaleString('es-MX')}</p>
            <div className="mt-2 text-xs text-gray-500">
              ML: {data.totals.channels.ml.orders} | Manual: {data.totals.channels.manual.orders}
            </div>
          </div>

          {/* Avg Ticket */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm mb-1">Ticket Promedio</p>
            <p className="text-2xl font-bold text-white">{fmt(data.totals.avgTicket)}</p>
          </div>

          {/* Channel split */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm mb-1">Canal Dominante</p>
            {data.totals.orders > 0 ? (
              <>
                <p className="text-2xl font-bold text-white">
                  {data.totals.channels.ml.revenue >= data.totals.channels.manual.revenue ? 'Mercado Libre' : 'Manual'}
                </p>
                <div className="mt-2 text-xs text-gray-500">
                  {data.totals.orders > 0
                    ? `${Math.round((data.totals.channels.ml.orders / data.totals.orders) * 100)}% ML / ${Math.round((data.totals.channels.manual.orders / data.totals.orders) * 100)}% Manual`
                    : '---'}
                </div>
              </>
            ) : (
              <p className="text-2xl font-bold text-gray-500">---</p>
            )}
          </div>
        </div>
      )}

      {/* Monthly Revenue Chart - ALL months */}
      {monthlyChartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Ingresos Mensuales</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  interval={monthlyChartData.length > 12 ? Math.floor(monthlyChartData.length / 12) : 0}
                />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#e5e7eb' }}
                  formatter={(val) => [fmt(val), 'Ingresos']}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {monthlyChartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.inPeriod ? '#3b82f6' : '#374151'}
                    />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="orders" stroke="#facc15" strokeWidth={2} dot={false} yAxisId="right" />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-gray-500 text-xs mt-2">Barras azules = periodo seleccionado | Barras grises = fuera del periodo | Linea amarilla = ordenes</p>
        </div>
      )}

      {/* Daily chart */}
      {data?.daily && data.daily.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Ingresos Diarios ({PERIODS.find(p => p.value === period)?.label})</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                  interval={data.daily.length > 30 ? Math.floor(data.daily.length / 15) : 0}
                  tickFormatter={d => {
                    const parts = d.split('-');
                    return `${parts[2]}/${parts[1]}`;
                  }}
                />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#e5e7eb' }}
                  formatter={(val, name) => [name === 'revenue' ? fmt(val) : val, name === 'revenue' ? 'Ingresos' : 'Ordenes']}
                />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bottom section: Top Products + Channel breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top 10 Products */}
        <div className="lg:col-span-2 bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Top 10 Productos</h2>
          {data?.topProducts && data.topProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700/50">
                    <th className="text-left py-2 pr-4">#</th>
                    <th className="text-left py-2 pr-4">Producto</th>
                    <th className="text-right py-2 pr-4">Ingresos</th>
                    <th className="text-right py-2 pr-4">Ordenes</th>
                    <th className="text-right py-2">Ticket Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p, i) => (
                    <tr key={i} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                      <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
                      <td className="py-2 pr-4 text-white truncate max-w-[200px]" title={p.name}>{p.name}</td>
                      <td className="py-2 pr-4 text-right text-green-400 font-medium">{fmt(p.revenue)}</td>
                      <td className="py-2 pr-4 text-right text-gray-300">{p.orders}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(p.avgTicket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Sin datos de productos para este periodo.</p>
          )}
        </div>

        {/* Channel breakdown */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Por Canal</h2>
          {channelPieData.length > 0 ? (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      dataKey="value"
                      stroke="none"
                    >
                      {channelPieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={(val) => [fmt(val), 'Ingresos']}
                    />
                    <Legend
                      formatter={(value) => <span style={{ color: '#d1d5db', fontSize: '12px' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                    <span className="text-gray-300 text-sm">Mercado Libre</span>
                  </div>
                  <span className="text-white text-sm font-medium">{fmt(data.totals.channels.ml.revenue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                    <span className="text-gray-300 text-sm">Ventas Manuales</span>
                  </div>
                  <span className="text-white text-sm font-medium">{fmt(data.totals.channels.manual.revenue)}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm">Sin datos de canales para este periodo.</p>
          )}
        </div>
      </div>

      {/* Loading overlay for period switch */}
      {loading && data && (
        <div className="fixed bottom-6 right-6 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          <span className="text-gray-300 text-sm">Actualizando...</span>
        </div>
      )}
    </div>
  );
}

export default SalesOverviewView;
