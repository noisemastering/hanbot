import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../api';
import { abbrState } from '../utils/stateAbbr';
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const AD_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];
const COLORS = { blue: '#3B82F6', green: '#10B981', amber: '#F59E0B', pink: '#EC4899' };

const tooltipStyle = {
  backgroundColor: '#1F2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#F3F4F6',
};

function getDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function AdDetailView() {
  const { fbAdId } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [ad, setAd] = useState(null);
  const [adInfo, setAdInfo] = useState(null);
  const [directDaily, setDirectDaily] = useState([]);
  const [directTotals, setDirectTotals] = useState({ totalClicks: 0, totalConversions: 0, totalRevenue: 0 });
  const [handoffData, setHandoffData] = useState([]);
  const [handoffTotals, setHandoffTotals] = useState({ totalHandoffs: 0, totalSales: 0, totalRevenue: 0 });
  const [geoData, setGeoData] = useState([]);
  const [genderData, setGenderData] = useState([]);
  const [deviceData, setDeviceData] = useState([]);
  const [adSpend, setAdSpend] = useState(null);

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split('T')[0], []);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const dateFromISO = `${dateFrom}T00:00:00.000Z`;
        const dateToISO = `${dateTo}T23:59:59.999Z`;

        const [perfRes, adInfoRes, directRes, handoffRes, geoRes, genderRes, deviceRes, spendRes] = await Promise.all([
          API.get(`/analytics/ad-performance?dateFrom=${dateFromISO}&dateTo=${dateToISO}`),
          API.get(`/ads?search=${fbAdId}`),
          API.get(`/click-logs/direct-ad/daily?days=${range}&adId=${fbAdId}`),
          API.get(`/analytics/daily-handoffs-sales?dateFrom=${dateFromISO}&dateTo=${dateToISO}&adId=${fbAdId}`),
          API.get(`/analytics/conversions-by-geography?dateFrom=${dateFromISO}&dateTo=${dateToISO}&adId=${fbAdId}`),
          API.get(`/analytics/conversions-by-gender?dateFrom=${dateFromISO}&dateTo=${dateToISO}&adId=${fbAdId}`),
          API.get(`/analytics/device-breakdown?dateFrom=${dateFromISO}&dateTo=${dateToISO}&adId=${fbAdId}`),
          API.get(`/analytics/fb-spend?dateFrom=${dateFrom}&dateTo=${dateTo}&level=ad`),
        ]);

        const allAds = perfRes.data?.ads || [];
        const match = allAds.find(a => a.adId === fbAdId);
        setAd(match || null);

        const adDoc = (adInfoRes.data?.data || []).find(a => a.fbAdId === fbAdId);
        setAdInfo(adDoc || null);

        setDirectDaily(directRes.data?.data?.daily || []);
        setDirectTotals(directRes.data?.data?.totals || { totalClicks: 0, totalConversions: 0, totalRevenue: 0 });

        const hd = handoffRes.data?.data || {};
        setHandoffData(hd.daily || []);
        setHandoffTotals({ totalHandoffs: hd.totalHandoffs || 0, totalSales: hd.totalSales || 0, totalRevenue: hd.totalRevenue || 0 });
        setGeoData(geoRes.data?.data || []);
        setGenderData(genderRes.data?.data || []);
        setDeviceData(deviceRes.data?.data || []);
        const spendRow = (spendRes.data?.data || []).find(r => r.adId === fbAdId);
        setAdSpend(spendRow || null);
      } catch (err) {
        console.error('Error fetching ad detail:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, fbAdId]);

  const chartData = useMemo(() => {
    if (!ad?.daily) return [];
    return ad.daily.map(d => ({
      dateLabel: d.dateLabel,
      links: d.links || 0,
      clicks: d.clicks || 0,
      conversions: d.conversions || 0,
    }));
  }, [ad]);

  const directChartData = useMemo(() => {
    return directDaily.map(d => {
      const dateObj = new Date(d.date + 'T12:00:00');
      const label = dateObj.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
      return { dateLabel: label, clicks: d.clicks, conversions: d.conversions };
    });
  }, [directDaily]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando detalle del anuncio...</p>
        </div>
      </div>
    );
  }

  if (!ad) {
    return (
      <div className="p-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mb-4 flex items-center gap-2" title="Volver">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Volver
        </button>
        <p className="text-gray-400">No se encontraron datos para este anuncio en el periodo seleccionado.</p>
      </div>
    );
  }

  const t = ad.totals;
  const clickRate = t.links > 0 ? ((t.clicks / t.links) * 100).toFixed(1) : '0';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors" title="Volver">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{ad.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{fbAdId}</code>
              {adInfo?.convoFlowRef && (
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">{adInfo.convoFlowRef}</span>
              )}
              {adInfo?.promoId?.name && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">{adInfo.promoId.name}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setRange(d)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${range === d ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-3" title="Gasto en Facebook Ads para este anuncio">
          <p className="text-xs text-gray-400">Inversión</p>
          <p className="text-xl font-bold text-red-400">${(adSpend?.spend || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Personas que vieron este anuncio">
          <p className="text-xs text-gray-400">Impresiones</p>
          <p className="text-xl font-bold text-gray-300">{(adSpend?.impressions || 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Links de compra generados">
          <p className="text-xs text-gray-400">Links</p>
          <p className="text-xl font-bold text-purple-400">{t.links.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Clicks en links de compra">
          <p className="text-xs text-gray-400">Clicks</p>
          <p className="text-xl font-bold text-blue-400">{t.clicks.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Compras en Mercado Libre">
          <p className="text-xs text-gray-400">Conversiones</p>
          <p className="text-xl font-bold text-green-400">{t.conversions}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Ingresos por ventas">
          <p className="text-xs text-gray-400">Ingresos</p>
          <p className="text-xl font-bold text-green-400">{formatCurrency(t.revenue)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Porcentaje de links que recibieron click">
          <p className="text-xs text-gray-400">Click Rate</p>
          <p className="text-xl font-bold text-white">{clickRate}%</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3" title="Costo por adquisición (inversión ÷ conversiones)">
          <p className="text-xs text-gray-400">CPA</p>
          <p className="text-xl font-bold text-white">${t.conversions > 0 ? ((adSpend?.spend || 0) / t.conversions).toFixed(0) : '—'}</p>
        </div>
      </div>

      {/* Daily Chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Actividad diaria</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span> Links</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Clicks</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Conversiones</span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="conversions" name="Conversiones" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="links" name="Links" stroke="#8B5CF6" strokeWidth={2} dot={{ fill: '#8B5CF6', r: 2 }} />
                <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Direct Links Chart */}
      {directChartData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Links Directos</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Clicks</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> Conversiones</span>
            </div>
          </div>
          <div className="flex items-center gap-6 mb-4">
            <div className="bg-gray-900/50 border border-gray-700/30 rounded-lg px-4 py-2">
              <p className="text-xs text-gray-400">Clicks</p>
              <p className="text-lg font-bold text-cyan-400">{directTotals.totalClicks}</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700/30 rounded-lg px-4 py-2">
              <p className="text-xs text-gray-400">Conversiones</p>
              <p className="text-lg font-bold text-green-400">{directTotals.totalConversions}</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700/30 rounded-lg px-4 py-2">
              <p className="text-xs text-gray-400">Ingresos</p>
              <p className="text-lg font-bold text-green-400">{formatCurrency(directTotals.totalRevenue)}</p>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={directChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} />
                <Bar dataKey="conversions" name="Conversiones" fill="#10B981" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Handoffs & Sales Chart */}
      {handoffData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Atención Humana</h2>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Handoffs ({handoffTotals.totalHandoffs})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block"></span> Ventas ({handoffTotals.totalSales})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span> Ingresos ({formatCurrency(handoffTotals.totalRevenue)})</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={handoffData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} />
                <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9CA3AF' }} formatter={(value, name) => name === 'Ingresos' ? formatCurrency(value) : value} />
                <Bar yAxisId="left" dataKey="sales" name="Ventas" fill="#F59E0B" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="left" type="monotone" dataKey="handoffs" name="Handoffs" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 2 }} />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Ingresos" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Device Breakdown */}
      {deviceData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Dispositivos</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {deviceData.filter(d => d.device !== 'bot').map(d => {
              const labels = { mobile: 'Móvil', tablet: 'Tablet', desktop: 'Escritorio', unknown: 'Desconocido' };
              const colors = { mobile: 'text-purple-400', tablet: 'text-cyan-400', desktop: 'text-blue-400', unknown: 'text-gray-400' };
              return (
                <div key={d.device} className="bg-gray-900/50 border border-gray-700/30 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{labels[d.device] || d.device}</p>
                  <p className={`text-xl font-bold ${colors[d.device] || 'text-white'}`}>{d.count.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d.percentage}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Geography + Gender donuts */}
      {(geoData.length > 0 || genderData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Geography donut */}
          {geoData.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Distribución geográfica</h2>
              <p className="text-sm text-gray-500 mb-4">Top estados por conversiones</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={geoData.slice(0, 8).map(g => ({ name: abbrState(g.state), value: g.count, percentage: g.percentage }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                    >
                      {geoData.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={AD_COLORS[i % AD_COLORS.length]} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n, p) => [`${v} (${p.payload.percentage}%)`, p.payload.name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Gender donut */}
          {genderData.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Género</h2>
              <p className="text-sm text-gray-500 mb-4">Compradores por género</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderData.map(g => ({
                        name: g.gender === 'male' ? 'Hombres' : g.gender === 'female' ? 'Mujeres' : 'Desconocido',
                        value: g.count, percentage: g.percentage
                      }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={4} dataKey="value"
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                    >
                      {genderData.map((g, i) => (
                        <Cell key={i} fill={g.gender === 'male' ? COLORS.blue : g.gender === 'female' ? COLORS.pink : '#6B7280'} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdDetailView;
