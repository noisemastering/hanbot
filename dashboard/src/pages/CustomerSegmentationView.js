import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import FeatureTip from '../components/FeatureTip';
import PeriodSelector from '../components/PeriodSelector';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const tooltipStyle = { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F3F4F6', fontSize: '13px' };
function getDaysAgo(d) { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().split('T')[0]; }

function CustomerSegmentationView() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(getDaysAgo(30));
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    setLoading(true);
    const dateFromISO = `${dateFrom}T00:00:00.000Z`;
    const dateToISO = `${dateTo}T23:59:59.999Z`;
    API.get(`/ml/segments?dateFrom=${dateFromISO}&dateTo=${dateToISO}`)
      .then(res => setData(res.data?.data || null))
      .catch(err => console.error('Segments error:', err))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const num = (n) => (n || 0).toLocaleString('es-MX');

  const TrendBadge = ({ trend }) => {
    if (!trend) return null;
    if (trend.direction === 'new') return <span className="text-xs text-blue-400">● Nuevo</span>;
    const { pp, direction } = trend;
    if (pp === null || pp === undefined) return null;
    const colors = { gaining: 'text-green-400', losing: 'text-red-400', flat: 'text-gray-500' };
    const arrows = { gaining: '▲', losing: '▼', flat: '●' };
    const label = direction === 'gaining' ? `+${pp}pp` : direction === 'losing' ? `${pp}pp` : (pp === 0 ? '=' : `${pp > 0 ? '+' : ''}${pp}pp`);
    return <span className={`text-xs font-medium ${colors[direction]}`} title={`${trend.previousShare}% → ${trend.currentShare}% de los clics`}>{arrows[direction]} {label}</span>;
  };

  if (loading) return <div className="p-6 flex justify-center min-h-[60vh]"><div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div></div>;

  const clicks = data?.totalClicks || 0;
  const conv = data?.conversions || 0;
  const rate = data?.conversionRate || 0;
  const revenue = data?.revenue || 0;
  const cg = data?.clicksByGender || { male: 0, female: 0, unknown: 0 };
  const trends = data?.clickGenderTrends || {};
  const topSizes = data?.topSizes || [];
  const known = (cg.male + cg.female) || 1; // for the male/female split among gendered clicks

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <FeatureTip id="seg-overview" title="Segmentación de campaña" text="A quién llega tu publicidad: género de quien HACE CLIC (no de quien compra), y cuántos de esos clics se convierten en venta con ≥50% de confianza." position="bottom" step="Nuevo">
              <h1 className="text-2xl font-bold text-white">Segmentación de Campaña</h1>
            </FeatureTip>
            <p className="text-sm text-gray-400">Por género de quien hace clic · comparación con el periodo anterior</p>
          </div>
        </div>
        <PeriodSelector dateFrom={dateFrom} dateTo={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
      </div>

      {/* Headline: clicks → conversions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-purple-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">Clics de anuncios</p>
          <p className="text-3xl font-bold text-purple-300">{num(clicks)}</p>
          <p className="text-xs text-gray-500 mt-1">el valor más importante</p>
        </div>
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">Compras ≥50% confianza</p>
          <p className="text-3xl font-bold text-green-400">{num(conv)} <span className="text-lg text-gray-500">({(rate * 100).toFixed(1)}%)</span></p>
          <p className="text-xs text-gray-500 mt-1">de los clics · sin importar género</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">Ingresos atribuidos</p>
          <p className="text-3xl font-bold text-white">${num(revenue)}</p>
          <p className="text-xs text-gray-500 mt-1">de las compras ≥50%</p>
        </div>
      </div>

      {/* Who clicks — by CLICKER gender */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Quién hace clic · por género</h2>
        <p className="text-sm text-gray-500 mb-5">Género de la persona que hizo clic y chateó (no de quien aparece en la cuenta de Mercado Libre).</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900/40 border border-blue-500/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1"><p className="text-xs text-gray-400">Hombres</p><TrendBadge trend={trends.male} /></div>
            <p className="text-2xl font-bold text-blue-400">{num(cg.male)} <span className="text-base text-gray-500">({Math.round(cg.male / (clicks || 1) * 100)}%)</span></p>
          </div>
          <div className="bg-gray-900/40 border border-pink-500/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1"><p className="text-xs text-gray-400">Mujeres</p><TrendBadge trend={trends.female} /></div>
            <p className="text-2xl font-bold text-pink-400">{num(cg.female)} <span className="text-base text-gray-500">({Math.round(cg.female / (clicks || 1) * 100)}%)</span></p>
          </div>
          <div className="bg-gray-900/40 border border-gray-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1"><p className="text-xs text-gray-400">Sin determinar</p><TrendBadge trend={trends.unknown} /></div>
            <p className="text-2xl font-bold text-gray-400">{num(cg.unknown)} <span className="text-base text-gray-500">({Math.round(cg.unknown / (clicks || 1) * 100)}%)</span></p>
          </div>
        </div>
        {/* male/female split bar (excluding unknown) */}
        <div className="mt-5">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Hombres {Math.round(cg.male / known * 100)}%</span>
            <span>Mujeres {Math.round(cg.female / known * 100)}%</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-900">
            <div style={{ width: `${cg.male / known * 100}%`, background: '#3B82F6' }} />
            <div style={{ width: `${cg.female / known * 100}%`, background: '#EC4899' }} />
          </div>
        </div>
      </div>

      {/* Which product each gender clicks */}
      {topSizes.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Qué medida clica cada género</h2>
          <p className="text-sm text-gray-500 mb-4">Clics por medida de producto, divididos por el género de quien clicó.</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSizes} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="size" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div style={tooltipStyle} className="p-3 text-sm">
                      <p className="text-white font-medium mb-1">{label}</p>
                      <p style={{ color: '#3B82F6' }}>Hombres: {d.male} ({d.malePercent}%)</p>
                      <p style={{ color: '#EC4899' }}>Mujeres: {d.female} ({d.femalePercent}%)</p>
                      <p style={{ color: '#9CA3AF' }}>Sin determinar: {d.unknown} · Total clics: {d.total}</p>
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="male" name="Hombres" stackId="g" fill="#3B82F6" />
                <Bar dataKey="female" name="Mujeres" stackId="g" fill="#EC4899" />
                <Bar dataKey="unknown" name="Sin determinar" stackId="g" fill="#6B7280" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Methodology */}
      <div className="bg-gray-800/30 border border-gray-700/40 rounded-xl p-6 text-sm space-y-2">
        <h3 className="text-white font-semibold">Metodología</h3>
        <p className="text-gray-400"><span className="text-gray-300 font-medium">Género:</span> del primer nombre de quien HIZO CLIC (el nombre que capturamos al iniciar el chat), no del comprador. El titular de la cuenta de Mercado Libre suele ser una persona distinta a quien clicó — cambia de género en ~50% de los casos — por eso el género del comprador se ignora.</p>
        <p className="text-gray-400"><span className="text-gray-300 font-medium">Compras ≥50%:</span> ventas correlacionadas al clic con al menos 50% de confianza, por fecha de venta. Es un conteo agnóstico al género.</p>
        <p className="text-gray-400"><span className="text-gray-300 font-medium">Uso:</span> a quién llega realmente tu publicidad y qué medida busca cada segmento — un nivel de detalle que Meta no da.</p>
      </div>
    </div>
  );
}

export default CustomerSegmentationView;
