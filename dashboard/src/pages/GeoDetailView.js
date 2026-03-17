import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const COLORS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#A855F7', '#0EA5E9', '#22C55E', '#E11D48',
];

const STATE_ABBR = {
  "aguascalientes": "Ags.", "baja california": "B.C.", "baja california sur": "B.C.S.",
  "campeche": "Camp.", "chiapas": "Chis.", "chihuahua": "Chih.",
  "ciudad de méxico": "CDMX", "ciudad de mexico": "CDMX", "cdmx": "CDMX",
  "coahuila": "Coah.", "coahuila de zaragoza": "Coah.", "colima": "Col.",
  "durango": "Dgo.", "guanajuato": "Gto.", "guerrero": "Gro.",
  "hidalgo": "Hgo.", "jalisco": "Jal.",
  "méxico": "Edoméx", "mexico": "Edoméx", "estado de méxico": "Edoméx",
  "michoacán": "Mich.", "michoacan": "Mich.", "michoacán de ocampo": "Mich.",
  "morelos": "Mor.", "nayarit": "Nay.", "nuevo león": "N.L.", "nuevo leon": "N.L.",
  "oaxaca": "Oax.", "puebla": "Pue.", "querétaro": "Qro.", "queretaro": "Qro.",
  "quintana roo": "Q. Roo", "san luis potosí": "S.L.P.", "san luis potosi": "S.L.P.",
  "sinaloa": "Sin.", "sonora": "Son.", "tabasco": "Tab.",
  "tamaulipas": "Tamps.", "tlaxcala": "Tlax.",
  "veracruz": "Ver.", "veracruz de ignacio de la llave": "Ver.",
  "yucatán": "Yuc.", "yucatan": "Yuc.", "zacatecas": "Zac.",
};

function abbrState(name) {
  if (!name) return name;
  return STATE_ABBR[name.toLowerCase().trim()] || name;
}

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

function GeoDetailView() {
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('states'); // states | cities

  const dateFrom = useMemo(() => getDaysAgo(range), [range]);
  const dateTo = useMemo(() => new Date().toISOString().split('T')[0], []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const dateFromISO = `${dateFrom}T00:00:00.000Z`;
      const dateToISO = `${dateTo}T23:59:59.999Z`;
      const res = await API.get(`/analytics/top-region?dateFrom=${dateFromISO}&dateTo=${dateToISO}`);
      setData(res.data);
    } catch (err) {
      console.error('Error fetching geo data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  };

  const regions = useMemo(() => data?.allRegions || [], [data]);
  const cities = data?.topCities || [];

  const totalConversations = useMemo(
    () => regions.reduce((sum, r) => sum + r.conversations, 0),
    [regions]
  );

  // Pie data: top 10 states + "Otros" bucket
  const pieData = useMemo(() => {
    if (regions.length <= 10) return regions.map(r => ({ name: abbrState(r.state), value: r.conversations }));
    const top = regions.slice(0, 10);
    const othersCount = regions.slice(10).reduce((s, r) => s + r.conversations, 0);
    return [
      ...top.map(r => ({ name: abbrState(r.state), value: r.conversations })),
      { name: 'Otros', value: othersCount }
    ];
  }, [regions]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando datos geográficos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-white">Distribución Geográfica</h1>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                range === d
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Estados</p>
          <p className="text-2xl font-bold text-purple-400">{regions.length}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ciudades</p>
          <p className="text-2xl font-bold text-blue-400">{cities.length}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ventas</p>
          <p className="text-2xl font-bold text-green-400">{data?.totals?.conversions || 0}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ingresos</p>
          <p className="text-2xl font-bold text-amber-400">{formatCurrency(data?.totals?.revenue || 0)}</p>
        </div>
      </div>

      {/* Pie Chart */}
      {pieData.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Conversaciones por estado</h2>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={140}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => {
                    const pct = totalConversations > 0 ? ((value / totalConversations) * 100).toFixed(0) : 0;
                    return `${name}: ${pct}%`;
                  }}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [`${value} conversaciones`, '']}
                />
                <Legend wrapperStyle={{ color: '#9CA3AF' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab toggle + Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Detalle</h2>
          <div className="flex gap-1">
            {[
              { key: 'states', label: 'Por estado' },
              { key: 'cities', label: 'Por ciudad' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  tab === t.key
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {tab === 'states' ? (
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Conversaciones</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Ingresos</th>
                  <th className="px-6 py-3 text-right">Ciudades</th>
                  <th className="px-6 py-3 text-right">% del total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {regions.map((r, i) => (
                  <tr key={r.state} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-gray-500">{i + 1}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: i < COLORS.length ? COLORS[i] : '#6B7280' }}
                        />
                        <span className="text-sm text-white font-medium">{abbrState(r.state)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-sm text-white font-medium">{r.conversations}</td>
                    <td className="px-6 py-3 text-right text-sm text-green-400 font-medium">{r.conversions || 0}</td>
                    <td className="px-6 py-3 text-right text-sm text-green-400">{formatCurrency(r.revenue || 0)}</td>
                    <td className="px-6 py-3 text-right text-sm text-gray-300">{r.uniqueCities}</td>
                    <td className="px-6 py-3 text-right text-sm text-gray-300">
                      {totalConversations > 0 ? ((r.conversations / totalConversations) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
                {/* Totals */}
                <tr className="bg-gray-900/30 font-semibold">
                  <td className="px-6 py-3"></td>
                  <td className="px-6 py-3 text-sm text-white">Total</td>
                  <td className="px-6 py-3 text-right text-sm text-white">{totalConversations}</td>
                  <td className="px-6 py-3 text-right text-sm text-green-400">{regions.reduce((s, r) => s + (r.conversions || 0), 0)}</td>
                  <td className="px-6 py-3 text-right text-sm text-green-400">{formatCurrency(regions.reduce((s, r) => s + (r.revenue || 0), 0))}</td>
                  <td className="px-6 py-3 text-right text-sm text-white">
                    {regions.reduce((s, r) => s + r.uniqueCities, 0)}
                  </td>
                  <td className="px-6 py-3 text-right text-sm text-white">100%</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Ciudad</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Conversaciones</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Ingresos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {cities.map((c, i) => (
                  <tr key={`${c.city}-${c.state}`} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-gray-500">{i + 1}</td>
                    <td className="px-6 py-3 text-sm text-white font-medium">{c.city}</td>
                    <td className="px-6 py-3 text-sm text-gray-300">{abbrState(c.state) || '-'}</td>
                    <td className="px-6 py-3 text-right text-sm text-white font-medium">{c.conversations}</td>
                    <td className="px-6 py-3 text-right text-sm text-green-400 font-medium">{c.conversions || 0}</td>
                    <td className="px-6 py-3 text-right text-sm text-green-400">{formatCurrency(c.revenue || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default GeoDetailView;
