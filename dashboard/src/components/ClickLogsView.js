// components/ClickLogsView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function ClickLogsView() {
  const [clickLogs, setClickLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    clicked: '',
    converted: ''
  });

  useEffect(() => {
    fetchStats();
    fetchClickLogs();
  }, [filter]);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/click-logs/stats`, {
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

      {/* Filters */}
      <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">PSID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">URL Original</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Producto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Creado</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Clickeado</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {clickLogs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                      {log.psid.slice(0, 12)}...
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">
                      {log.originalUrl}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {log.productName || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {log.clicked ? formatDate(log.clickedAt) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          log.clicked
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
                        }`}>
                          {log.clicked ? '✓ Click' : '○ Pendiente'}
                        </span>
                        {log.converted && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">
                            ✓ Convertido
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
