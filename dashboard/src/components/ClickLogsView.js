// components/ClickLogsView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Helper function to get first day of current month
const getFirstDayOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
};

// Helper function to get current date
const getCurrentDate = () => {
  return new Date().toISOString().split('T')[0];
};

function ClickLogsView() {
  const [clickLogs, setClickLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    clicked: '',
    converted: '',
    startDate: getFirstDayOfMonth(),
    endDate: getCurrentDate()
  });

  useEffect(() => {
    fetchStats();
    fetchClickLogs();
    fetchChartData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filter.startDate) params.append('startDate', filter.startDate);
      if (filter.endDate) params.append('endDate', filter.endDate);

      const res = await fetch(`${API_URL}/click-logs/stats?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Error al cargar estadísticas');
    }
  };

  const fetchClickLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filter.clicked) params.append('clicked', filter.clicked);
      if (filter.converted) params.append('converted', filter.converted);
      if (filter.startDate) params.append('startDate', filter.startDate);
      if (filter.endDate) params.append('endDate', filter.endDate);

      const res = await fetch(`${API_URL}/click-logs?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setClickLogs(data.clickLogs);
      }
    } catch (error) {
      console.error('Error fetching click logs:', error);
      toast.error('Error al cargar registros de clicks');
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filter.startDate) params.append('startDate', filter.startDate);
      if (filter.endDate) params.append('endDate', filter.endDate);

      const res = await fetch(`${API_URL}/click-logs/daily?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setChartData(data.chartData);
      }
    } catch (error) {
      console.error('Error fetching chart data:', error);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('es-MX');
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Registros de Clicks</h2>
        <p className="text-sm text-gray-400 mt-1">Analítica de enlaces compartidos con usuarios</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="text-gray-400 text-sm">Total Enlaces</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.totalLinks}</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="text-gray-400 text-sm">Clicks</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.totalClicks}</div>
            <div className="text-xs text-gray-500 mt-1">{stats.clickRate}% de enlaces</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="text-gray-400 text-sm">Conversiones</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.totalConversions}</div>
            <div className="text-xs text-gray-500 mt-1">{stats.conversionRate}% de clicks</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4">
            <div className="text-gray-400 text-sm">Usuarios Únicos</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.uniqueUsers}</div>
          </div>
        </div>
      )}

      {/* Daily Chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Enlaces y Clicks por Día</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                />
                <YAxis
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F3F4F6'
                  }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Legend
                  wrapperStyle={{ color: '#9CA3AF' }}
                />
                <Bar
                  dataKey="clicks"
                  name="Clicks"
                  fill="#10B981"
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="links"
                  name="Enlaces"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filtros
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Fecha Inicio
            </label>
            <input
              type="date"
              value={filter.startDate}
              onChange={(e) => setFilter({ ...filter, startDate: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Fecha Fin
            </label>
            <input
              type="date"
              value={filter.endDate}
              onChange={(e) => setFilter({ ...filter, endDate: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Estado de Click
            </label>
            <select
              value={filter.clicked}
              onChange={(e) => setFilter({ ...filter, clicked: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              <option value="true">Clickeado</option>
              <option value="false">No clickeado</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Estado de Conversión
            </label>
            <select
              value={filter.converted}
              onChange={(e) => setFilter({ ...filter, converted: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              <option value="true">Convertido</option>
              <option value="false">No convertido</option>
            </select>
          </div>
        </div>
      </div>

      {/* Click Logs Table */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando registros...</p>
        </div>
      ) : clickLogs.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="text-6xl mb-4">🔗</div>
          <h3 className="text-lg font-semibold text-white mb-2">No hay registros</h3>
          <p className="text-gray-400">No se han generado enlaces rastreables aún</p>
        </div>
      ) : (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-32">PSID</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-36">Link</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase">Producto</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-28">Creado</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-28">Clickeado</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-40">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {clickLogs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {log.psid.slice(-8)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={log.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
                        title={log.originalUrl}
                      >
                        🔗 {log.productId ? log.productId.slice(-6) : 'link'}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-300">
                      {log.productName || '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {log.clicked ? formatDate(log.clickedAt) : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          log.clicked
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
                        }`}>
                          {log.clicked ? '✓ Click' : '○ Pendiente'}
                        </span>
                        {log.converted && (log.correlationConfidence === 'high' || log.correlationConfidence === 'medium') && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            log.correlationConfidence === 'high'
                              ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                              : 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30'
                          }`}>
                            💰 {log.correlationConfidence === 'high' ? 'Venta' : 'Venta~'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClickLogsView;
