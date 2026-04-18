import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' };

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
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => v ? fmt(v) : '—'} />
                  <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
                  <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SalesForecastView;
