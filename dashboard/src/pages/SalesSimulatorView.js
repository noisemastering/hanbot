import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import KnobControl from '../components/KnobControl';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function formatMoney(n) {
  if (n == null) return '-';
  return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

/**
 * Simulation engine — applies knob multipliers to baseline metrics.
 * Uses diminishing returns on spend/ads to be realistic.
 */
function simulate(baseline, knobs) {
  if (!baseline || !baseline.revenue) return null;

  // Diminishing returns: (new/old)^exponent
  const diminish = (newVal, oldVal, exponent = 0.7) => {
    if (oldVal <= 0) return 1;
    return Math.pow(newVal / oldVal, exponent);
  };

  const spendFactor = diminish(knobs.adSpend, baseline.adSpend, 0.65);
  const adsFactor = diminish(knobs.activeAds, baseline.activeAds, 0.5);
  const impressionFactor = diminish(knobs.impressions, baseline.impressions, 0.6);
  const ctrFactor = knobs.ctr / (baseline.ctr || 1);
  const conversionFactor = knobs.conversionRate / (baseline.conversionRate || 1);
  const ticketFactor = knobs.avgTicket / (baseline.avgTicket || 1);
  const productFactor = diminish(knobs.productCount, baseline.productCount, 0.4);
  const daysFactor = knobs.activeDays / 7;

  const combinedFactor = spendFactor * adsFactor * impressionFactor * ctrFactor
    * conversionFactor * ticketFactor * productFactor * daysFactor;

  const projectedRevenue = baseline.revenue * combinedFactor;
  const projectedOrders = baseline.orders * (combinedFactor / ticketFactor) * (knobs.avgTicket > 0 ? 1 : 0);
  const projectedROI = knobs.adSpend > 0 ? projectedRevenue / knobs.adSpend : 0;

  return {
    revenue: Math.round(projectedRevenue),
    orders: Math.round(projectedOrders),
    avgTicket: knobs.avgTicket,
    roi: projectedROI,
    adSpend: knobs.adSpend,
    combinedFactor
  };
}

export default function SalesSimulatorView() {
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  // Knob values — initialized from baseline
  const [knobs, setKnobs] = useState(null);

  useEffect(() => {
    fetchBaseline();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const fetchBaseline = async () => {
    setLoading(true);
    try {
      const [forecastRes, spendRes, productRes] = await Promise.all([
        fetch(`${API_URL}/ml/forecast?days=${period}`),
        fetch(`${API_URL}/ml/spend-optimization?days=${period}`),
        fetch(`${API_URL}/ml/forecast-by-product?days=${period}`)
      ]);

      const [forecastData, spendData, productData] = await Promise.all([
        forecastRes.json(),
        spendRes.json(),
        productRes.json()
      ]);

      // Extract baseline metrics
      const totalRevenue = forecastData.totalHistoryRevenue || 0;
      const totalOrders = (forecastData.history || []).reduce((sum, d) => sum + (d.orders || 0), 0);
      const avgTicket = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

      // Ad spend from spend optimization
      const totalSpend = (spendData.ads || []).reduce((sum, a) => sum + (a.spend || 0), 0);
      const activeAds = (spendData.ads || []).filter(a => a.spend > 0).length;

      // Impressions from spend data
      const totalImpressions = (spendData.ads || []).reduce((sum, a) => sum + (a.impressions || 0), 0);

      // Click rate — clicks / impressions
      const totalClicks = (spendData.ads || []).reduce((sum, a) => sum + (a.clicks || 0), 0);
      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;

      // Conversion rate — orders / clicks
      const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks * 100) : 0;

      // Product count
      const productCount = (productData.products || []).length;

      const b = {
        revenue: totalRevenue,
        orders: totalOrders,
        avgTicket,
        adSpend: Math.round(totalSpend),
        activeAds: Math.max(activeAds, 1),
        impressions: totalImpressions,
        ctr: Math.round(ctr * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        productCount: Math.max(productCount, 1),
        activeDays: 7,
        avgDailyRevenue: forecastData.avgDailyRevenue || 0,
        trend: forecastData.trend || 0,
        // Monthly breakdown for chart
        monthly: forecastData.monthly || []
      };

      setBaseline(b);
      setKnobs({ ...b }); // Start knobs at baseline values
    } catch (err) {
      console.error('Error fetching baseline:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateKnob = (key, value) => {
    setKnobs(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const resetKnobs = () => {
    if (baseline) setKnobs({ ...baseline });
  };

  const result = useMemo(() => {
    if (!baseline || !knobs) return null;
    return simulate(baseline, knobs);
  }, [baseline, knobs]);

  // Build comparison chart data
  const chartData = useMemo(() => {
    if (!baseline || !result) return [];
    return [
      { name: 'Ingresos', actual: baseline.revenue, simulated: result.revenue },
      { name: 'Inversión', actual: baseline.adSpend, simulated: result.adSpend }
    ];
  }, [baseline, result]);

  // Monthly projection with simulation factor
  const monthlyProjection = useMemo(() => {
    if (!baseline?.monthly || !result) return [];
    return baseline.monthly.map(m => ({
      ...m,
      simulated: Math.round((m.projected || m.revenue) * result.combinedFactor)
    }));
  }, [baseline, result]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <p className="text-gray-400">No hay datos suficientes para la simulación</p>
      </div>
    );
  }

  const revenueChange = result ? ((result.revenue - baseline.revenue) / baseline.revenue * 100).toFixed(1) : 0;
  const ordersChange = result ? ((result.orders - baseline.orders) / baseline.orders * 100).toFixed(1) : 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Simulador de Ventas</h1>
          <p className="text-gray-400 mt-2">Ajusta las variables para proyectar el impacto en ventas</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={period} onChange={e => setPeriod(Number(e.target.value))}
            className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-sm">
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          <button onClick={resetKnobs}
            className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-600/50 transition-colors text-sm">
            Restablecer
          </button>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
        <p className="text-sm text-blue-300">
          Los valores iniciales reflejan tus métricas reales de los últimos {period} días.
          Gira los controles para simular cambios — arrastra hacia arriba para aumentar, hacia abajo para disminuir.
          Doble clic para restablecer un control individual.
        </p>
      </div>

      {/* Knobs grid */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase mb-5">Variables</h3>
        <div className="flex flex-wrap justify-center gap-6">
          <KnobControl
            label="Inversión mensual"
            value={knobs?.adSpend || 0}
            min={0}
            max={Math.max((baseline.adSpend || 1) * 5, 50000)}
            step={500}
            baseline={baseline.adSpend}
            prefix="$"
            color="#ef4444"
            onChange={v => updateKnob('adSpend', v)}
          />
          <KnobControl
            label="Anuncios activos"
            value={knobs?.activeAds || 1}
            min={1}
            max={Math.max(baseline.activeAds * 3, 30)}
            step={1}
            baseline={baseline.activeAds}
            color="#f97316"
            onChange={v => updateKnob('activeAds', v)}
          />
          <KnobControl
            label="Impresiones"
            value={knobs?.impressions || 0}
            min={0}
            max={Math.max((baseline.impressions || 1) * 5, 100000)}
            step={5000}
            baseline={baseline.impressions}
            color="#eab308"
            onChange={v => updateKnob('impressions', v)}
          />
          <KnobControl
            label="CTR (%)"
            value={knobs?.ctr || 0}
            min={0}
            max={Math.max((baseline.ctr || 1) * 3, 10)}
            step={0.1}
            baseline={baseline.ctr}
            unit="%"
            prefix=""
            color="#22c55e"
            format={v => v.toFixed(1) + '%'}
            onChange={v => updateKnob('ctr', v)}
          />
          <KnobControl
            label="Tasa conversión (%)"
            value={knobs?.conversionRate || 0}
            min={0}
            max={Math.max((baseline.conversionRate || 1) * 3, 20)}
            step={0.5}
            baseline={baseline.conversionRate}
            unit="%"
            color="#06b6d4"
            format={v => v.toFixed(1) + '%'}
            onChange={v => updateKnob('conversionRate', v)}
          />
          <KnobControl
            label="Ticket promedio"
            value={knobs?.avgTicket || 0}
            min={100}
            max={Math.max((baseline.avgTicket || 100) * 3, 5000)}
            step={50}
            baseline={baseline.avgTicket}
            prefix="$"
            color="#8b5cf6"
            onChange={v => updateKnob('avgTicket', v)}
          />
          <KnobControl
            label="Productos"
            value={knobs?.productCount || 1}
            min={1}
            max={Math.max(baseline.productCount * 3, 20)}
            step={1}
            baseline={baseline.productCount}
            color="#ec4899"
            onChange={v => updateKnob('productCount', v)}
          />
          <KnobControl
            label="Días activos / sem"
            value={knobs?.activeDays || 7}
            min={1}
            max={7}
            step={1}
            baseline={7}
            color="#64748b"
            format={v => v + 'd'}
            onChange={v => updateKnob('activeDays', v)}
          />
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* KPI comparison cards */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Proyección vs Actual</h3>
          <div className="space-y-4">
            {/* Revenue */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Ingresos ({period}d)</p>
                <p className="text-lg font-bold text-white">{formatMoney(result?.revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-sm text-gray-400">{formatMoney(baseline.revenue)}</p>
              </div>
              <span className={`text-sm font-medium px-2 py-1 rounded ${Number(revenueChange) >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {Number(revenueChange) >= 0 ? '+' : ''}{revenueChange}%
              </span>
            </div>

            {/* Orders */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Pedidos</p>
                <p className="text-lg font-bold text-white">{result?.orders?.toLocaleString() || '-'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-sm text-gray-400">{baseline.orders.toLocaleString()}</p>
              </div>
              <span className={`text-sm font-medium px-2 py-1 rounded ${Number(ordersChange) >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {Number(ordersChange) >= 0 ? '+' : ''}{ordersChange}%
              </span>
            </div>

            {/* ROI */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">ROI</p>
                <p className="text-lg font-bold text-white">{result?.roi ? result.roi.toFixed(1) + 'x' : '-'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-sm text-gray-400">{baseline.adSpend > 0 ? (baseline.revenue / baseline.adSpend).toFixed(1) + 'x' : '-'}</p>
              </div>
              {(() => {
                const baseROI = baseline.adSpend > 0 ? baseline.revenue / baseline.adSpend : 0;
                const roiChange = baseROI > 0 && result?.roi ? ((result.roi - baseROI) / baseROI * 100).toFixed(1) : '0';
                return (
                  <span className={`text-sm font-medium px-2 py-1 rounded ${Number(roiChange) >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {Number(roiChange) >= 0 ? '+' : ''}{roiChange}%
                  </span>
                );
              })()}
            </div>

            {/* Ticket */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Ticket promedio</p>
                <p className="text-lg font-bold text-white">{formatMoney(result?.avgTicket)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-sm text-gray-400">{formatMoney(baseline.avgTicket)}</p>
              </div>
              {(() => {
                const ticketChange = baseline.avgTicket > 0 ? ((knobs.avgTicket - baseline.avgTicket) / baseline.avgTicket * 100).toFixed(1) : '0';
                return (
                  <span className={`text-sm font-medium px-2 py-1 rounded ${Number(ticketChange) >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {Number(ticketChange) >= 0 ? '+' : ''}{ticketChange}%
                  </span>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Comparison chart */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Comparativa</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barGap={8}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
                formatter={(v) => [formatMoney(v)]}
              />
              <Bar dataKey="actual" name="Actual" fill="#6b7280" radius={[4, 4, 0, 0]} />
              <Bar dataKey="simulated" name="Simulado" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly projection */}
      {monthlyProjection.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Proyección mensual simulada</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyProjection} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
                formatter={(v, name) => [formatMoney(v), name === 'revenue' ? 'Actual' : 'Simulado']}
              />
              <Bar dataKey="revenue" name="Actual" fill="#6b7280" radius={[4, 4, 0, 0]} />
              <Bar dataKey="simulated" name="Simulado" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <ReferenceLine y={0} stroke="#374151" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* How it works */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mt-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase mb-3">Cómo funciona la simulación</h3>
        <div className="text-sm text-gray-400 space-y-2">
          <p>La simulación proyecta el impacto de cambios en tus variables clave sobre los ingresos. Se basa en tus métricas reales de los últimos {period} días.</p>
          <p><strong className="text-gray-300">Rendimientos decrecientes:</strong> Duplicar la inversión no duplica los ingresos. El modelo aplica curvas de rendimiento decreciente a la inversión, anuncios activos e impresiones — similar a lo que ocurre en la práctica.</p>
          <p><strong className="text-gray-300">Variables lineales:</strong> La tasa de conversión, CTR y ticket promedio se aplican de forma proporcional — mejorar tu conversión un 20% sí mejora los ingresos un 20%.</p>
        </div>
      </div>
    </div>
  );
}
