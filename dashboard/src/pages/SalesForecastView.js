import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6' };

function SalesForecastView() {
  const navigate = useNavigate();

  // Mock data: 30 days of history + 7 days forecast
  const data = useMemo(() => {
    const rows = [];
    const base = 35000;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      const noise = (Math.random() - 0.5) * 20000;
      const trend = (30 - i) * 300;
      rows.push({ dateLabel: label, revenue: Math.round(base + trend + noise), forecast: null, isForecast: false });
    }
    // Forecast 7 days
    const lastVal = rows[rows.length - 1].revenue;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const label = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      const projected = lastVal + i * 350 + (Math.random() - 0.5) * 5000;
      rows.push({ dateLabel: label, revenue: null, forecast: Math.round(projected), isForecast: true });
    }
    return rows;
  }, []);

  const todayLabel = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Pronóstico de Ventas</h1>
          <p className="text-sm text-gray-400">Regresión lineal sobre ingresos diarios — proyección a 7 días</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400">Ingresos último mes</p>
          <p className="text-2xl font-bold text-green-400">$1,277,681</p>
        </div>
        <div className="bg-gray-800/50 border border-purple-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400">Proyección próximos 7 días</p>
          <p className="text-2xl font-bold text-purple-400">$312,450</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400">Tendencia</p>
          <p className="text-2xl font-bold text-green-400">↗ +8.2%</p>
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
            <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={{ stroke: '#374151' }} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={v => v ? `$${v.toLocaleString('es-MX')}` : '—'} />
              <ReferenceLine x={todayLabel} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'Hoy', fill: '#9CA3AF', fontSize: 11 }} />
              <Bar dataKey="revenue" name="Ingresos" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="forecast" name="Proyección" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="6 3" dot={{ fill: '#8B5CF6', r: 3 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
        ⚠️ Datos de ejemplo (mock). La implementación real usará regresión lineal sobre los ingresos históricos del sistema.
      </div>
    </div>
  );
}

export default SalesForecastView;
