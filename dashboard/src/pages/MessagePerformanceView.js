import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const PERIODS = [
  { value: '7', label: '7d' },
  { value: '15', label: '15d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
];

// Outcome filters (the chips above the table). "all" shows everything.
const OUTCOMES = [
  { value: 'all', label: 'Todas' },
  { value: 'sale', label: 'Venta' },
  { value: 'click', label: 'Clic' },
  { value: 'handoff', label: 'Humano' },
  { value: 'report', label: 'Reporte' },
];

const PRIORITY_LABEL = { low: 'Baja', medium: 'Media', high: 'Alta' };
const PRIORITY_COLOR = { low: '#4caf50', medium: '#f5a623', high: '#f44336' };

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-MX');
}

function pct(part, total) {
  if (!total) return '0%';
  return Math.round((part / total) * 100) + '%';
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function Badge({ on, color, label, title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: on ? `${color}22` : 'transparent',
        border: `1px solid ${on ? color : '#374151'}`,
        color: on ? '#fff' : '#4b5563',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: on ? color : '#374151' }} />
      {label}
    </span>
  );
}

function MessagePerformanceView() {
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/message-performance?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (filter === 'all') return all;
    if (filter === 'report') return all.filter((r) => r.reported);
    return all.filter((r) => r[filter]);
  }, [data, filter]);

  const s = data?.summary;
  const daily = data?.daily || [];

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">Cargando rendimiento de mensajes...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Rendimiento de Mensajes</h1>
          <p className="text-gray-400 text-sm mt-1">Conversaciones del periodo y su resultado</p>
        </div>
        <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === p.value ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Kpi label="Conversaciones" value={s.conversations.toLocaleString('es-MX')} />
          <Kpi label="Ventas" value={s.sales.toLocaleString('es-MX')} sub={pct(s.sales, s.conversations)} color="#22c55e" />
          <Kpi label="Ingresos" value={fmtMoney(s.salesRevenue)} color="#22c55e" />
          <Kpi label="Clics" value={s.clicks.toLocaleString('es-MX')} sub={pct(s.clicks, s.conversations)} color="#3b82f6" />
          <Kpi label="A humano" value={s.handoffs.toLocaleString('es-MX')} sub={pct(s.handoffs, s.conversations)} color="#f5a623" />
          <Kpi label="Reportes" value={s.reports.toLocaleString('es-MX')} sub={pct(s.reports, s.conversations)} color="#f44336" />
        </div>
      )}

      {/* Daily outcome chart */}
      {daily.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Resultados por día</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 8, right: 16, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                  interval={daily.length > 31 ? Math.floor(daily.length / 15) : 0}
                  angle={daily.length > 14 ? -45 : 0}
                  textAnchor={daily.length > 14 ? 'end' : 'middle'}
                  height={daily.length > 14 ? 50 : 30}
                />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#e5e7eb' }}
                  formatter={(val, name, item) => {
                    const total = item?.payload?.conversations || 0;
                    const txt = val.toLocaleString('es-MX');
                    // Conversaciones is the denominator — show the count only.
                    return [name === 'Conversaciones' ? txt : `${txt} · ${pct(val, total)}`, name];
                  }}
                />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                <Bar dataKey="conversations" name="Conversaciones" fill="#475569" fillOpacity={0.5} radius={[3, 3, 0, 0]} barSize={daily.length > 31 ? 6 : 14} />
                <Line type="monotone" dataKey="clicks" name="Clics" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sales" name="Ventas" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="handoffs" name="A humano" stroke="#f5a623" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="reports" name="Reportes" stroke="#f44336" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-gray-500 text-xs mt-2">Barras = conversaciones · líneas = resultados por día</p>
        </div>
      )}

      {/* Outcome filter chips */}
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            onClick={() => setFilter(o.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              filter === o.value
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-gray-800/50 text-gray-400 border-gray-700/50 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        {data?.capped && (
          <p className="text-amber-400/80 text-xs mb-3">
            Mostrando las {rows.length} conversaciones más recientes del periodo (límite alcanzado).
          </p>
        )}
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700/50">
                  <th className="text-left py-2 pr-4">Cliente</th>
                  <th className="text-left py-2 pr-4">Canal</th>
                  <th className="text-right py-2 pr-4">Msjs</th>
                  <th className="text-left py-2 pr-4">Última actividad</th>
                  <th className="text-center py-2 pr-2">Resultado</th>
                  <th className="text-right py-2">Monto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.psid} className="border-b border-gray-700/30 hover:bg-gray-700/20 align-top">
                    <td className="py-2 pr-4 text-white">
                      {r.name || <span className="text-gray-500">Sin nombre</span>}
                      <div className="text-[11px] text-gray-600 truncate max-w-[160px]" title={r.psid}>{r.psid}</div>
                    </td>
                    <td className="py-2 pr-4 text-gray-300 capitalize">
                      {r.channel === 'whatsapp' ? 'WhatsApp' : r.channel === 'facebook' ? 'Messenger' : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-300">{r.msgCount}</td>
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtDateTime(r.lastMessageAt)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1 justify-center">
                        <Badge on={r.sale} color="#22c55e" label="Venta" />
                        <Badge on={r.click} color="#3b82f6" label="Clic" />
                        <Badge on={r.handoff} color="#f5a623" label="Humano" title={r.handoffReason || ''} />
                        <Badge
                          on={r.reported}
                          color={r.reported ? PRIORITY_COLOR[r.reportPriority] || '#f44336' : '#f44336'}
                          label={r.reported ? `Reporte${r.reportPriority ? ` · ${PRIORITY_LABEL[r.reportPriority] || ''}` : ''}` : 'Reporte'}
                          title={r.reportCategory || ''}
                        />
                      </div>
                    </td>
                    <td className="py-2 text-right text-green-400 font-medium whitespace-nowrap">
                      {r.sale ? fmtMoney(r.saleAmount) : <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Sin conversaciones para este periodo / filtro.</p>
        )}
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

function Kpi({ label, value, sub, color }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-xl font-bold" style={{ color: color || '#fff' }}>{value}</p>
        {sub && <span className="text-sm font-semibold text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

export default MessagePerformanceView;
