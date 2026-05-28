import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import toast from 'react-hot-toast';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const STATUS_CONFIG = {
  open: { label: 'Abierto', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  review: { label: 'En revisión', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  working: { label: 'Trabajando', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  solved: { label: 'Resuelto', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  dismissed: { label: 'Descartado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
};

const PRIORITY_CONFIG = {
  low: { label: 'Baja', color: 'text-gray-400' },
  medium: { label: 'Media', color: 'text-yellow-400' },
  high: { label: 'Alta', color: 'text-red-400' }
};

const STATUS_TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'open', label: 'Abiertos' },
  { key: 'review', label: 'En revisión' },
  { key: 'working', label: 'Trabajando' },
  { key: 'solved', label: 'Resueltos' },
  { key: 'dismissed', label: 'Descartados' }
];

export default function TicketsView() {
  const { user, canManageUsers } = useAuth();
  const { t } = useTranslation();
  const isAdminUser = canManageUsers();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', priority: 'medium' });
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dashboardUsers, setDashboardUsers] = useState([]);

  const getToken = () => localStorage.getItem('token');
  const knownIdsRef = useRef(null); // null on first load → don't toast initial set
  const lastStatusByIdRef = useRef({}); // ticketId → last status seen
  const initialLoadedRef = useRef(false);

  const fetchTickets = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/tickets`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        // Detect new tickets and status changes vs the last seen state
        if (initialLoadedRef.current && knownIdsRef.current) {
          const newOnes = data.data.filter(t2 =>
            !knownIdsRef.current.has(t2._id) && t2.createdBy?._id !== user?._id
          );
          newOnes.forEach(nt => {
            const author = nt.createdBy
              ? `${nt.createdBy.firstName || ''} ${nt.createdBy.lastName || ''}`.trim() || nt.createdBy.username
              : 'Alguien';
            toast.success(`🎫 Ticket nuevo de ${author}: ${nt.title}`, { duration: 8000, icon: '🎫' });
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                new Notification(`Ticket nuevo: ${nt.title}`, {
                  body: `${author} reportó: ${(nt.description || '').slice(0, 120)}`,
                  icon: '/logo192.png',
                  tag: `ticket-${nt._id}`
                });
              } catch {}
            }
          });

          // Detect status changes since last poll
          const STATUS_LABEL = {
            open: 'Abierto', review: 'En revisión', working: 'Trabajando',
            solved: 'Resuelto', dismissed: 'Descartado'
          };
          data.data.forEach(t2 => {
            const previous = lastStatusByIdRef.current[t2._id];
            if (previous && previous !== t2.status) {
              const author = t2.createdBy
                ? `${t2.createdBy.firstName || ''} ${t2.createdBy.lastName || ''}`.trim() || t2.createdBy.username
                : 'el reportante';
              const fromL = STATUS_LABEL[previous] || previous;
              const toL = STATUS_LABEL[t2.status] || t2.status;
              const isAuthor = t2.createdBy?._id === user?._id;
              const msg = isAuthor
                ? `🎫 Tu ticket "${t2.title}" cambió de ${fromL} → ${toL}`
                : `🎫 Ticket de ${author} "${t2.title}" cambió de ${fromL} → ${toL}`;
              toast(msg, { duration: 7000, icon: '🔄' });
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try {
                  new Notification(`${toL}: ${t2.title}`, {
                    body: isAuthor
                      ? `Tu ticket cambió de ${fromL} → ${toL}`
                      : `Ticket de ${author}: ${fromL} → ${toL}`,
                    icon: '/logo192.png',
                    tag: `ticket-status-${t2._id}-${t2.status}`
                  });
                } catch {}
              }
            }
          });
        }
        knownIdsRef.current = new Set(data.data.map(t2 => t2._id));
        lastStatusByIdRef.current = Object.fromEntries(data.data.map(t2 => [t2._id, t2.status]));
        initialLoadedRef.current = true;
        setTickets(data.data);
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [user?._id]);

  const fetchUsers = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/dashboard-users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setDashboardUsers(data.data || data.users || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    if (isAdminUser) fetchUsers();

    // Ask for browser notification permission once
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // Poll every 15 seconds for real-time sync
    const interval = setInterval(() => fetchTickets(), 15000);
    return () => clearInterval(interval);
  }, [fetchTickets, fetchUsers, isAdminUser]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.description.trim()) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) => [data.data, ...prev]);
        setFormData({ title: '', description: '', priority: 'medium' });
        setShowForm(false);
      }
    } catch (err) {
      console.error('Error creating ticket:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (ticketId, status) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) => prev.map((t2) => (t2._id === ticketId ? data.data : t2)));
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleAssign = async (ticketId, assignedTo) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ assignedTo: assignedTo || null })
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) => prev.map((t2) => (t2._id === ticketId ? data.data : t2)));
      }
    } catch (err) {
      console.error('Error assigning ticket:', err);
    }
  };

  const handleAddComment = async (ticketId) => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text: commentText })
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) => prev.map((t2) => (t2._id === ticketId ? data.data : t2)));
        setCommentText('');
      }
    } catch (err) {
      console.error('Error adding comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (ticketId) => {
    if (!window.confirm('¿Eliminar este ticket?')) return;
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) => prev.filter((t2) => t2._id !== ticketId));
        if (expandedId === ticketId) setExpandedId(null);
      }
    } catch (err) {
      console.error('Error deleting ticket:', err);
    }
  };

  const filtered = activeTab === 'all' ? tickets : tickets.filter((t2) => t2.status === activeTab);

  const formatDate = (d) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getUserName = (u) => {
    if (!u) return '—';
    return u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.username;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t('tickets.title')}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? t('common.cancel') : t('tickets.new')}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('tickets.titleField')}</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder={t('tickets.titlePlaceholder')}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('common.description')}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 min-h-[80px]"
              placeholder={t('tickets.descriptionPlaceholder')}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('tickets.priority')}</label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              className="bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="low">{PRIORITY_CONFIG.low.label}</option>
              <option value="medium">{PRIORITY_CONFIG.medium.label}</option>
              <option value="high">{PRIORITY_CONFIG.high.label}</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? t('common.loading') : t('tickets.create')}
          </button>
        </form>
      )}

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            {tab.label}
            {tab.key === 'all'
              ? ` (${tickets.length})`
              : ` (${tickets.filter((t2) => t2.status === tab.key).length})`}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 py-12">{t('tickets.empty')}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ticket) => {
            const isExpanded = expandedId === ticket._id;
            const statusCfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
            const priorityCfg = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;
            const isCreator = user && ticket.createdBy && ticket.createdBy._id === user._id;

            return (
              <div
                key={ticket._id}
                className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden"
              >
                {/* Row header */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-700/30 transition-colors"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : ticket._id);
                    setCommentText('');
                  }}
                >
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusCfg.color}`}>
                    {statusCfg.label}
                  </span>
                  <span className={`text-xs font-medium ${priorityCfg.color}`}>
                    {priorityCfg.label}
                  </span>
                  <span className="text-white font-medium text-sm flex-1 truncate">{ticket.title}</span>
                  <span className="text-gray-500 text-xs">{getUserName(ticket.createdBy)}</span>
                  <span className="text-gray-600 text-xs">{formatDate(ticket.createdAt)}</span>
                  <span className="text-gray-500 text-xs">
                    {ticket.comments?.length || 0} {t('tickets.comments')}
                  </span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-700/50 px-5 py-4 space-y-4">
                    {/* Description */}
                    <div>
                      <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('common.description')}</h4>
                      <p className="text-gray-300 text-sm whitespace-pre-wrap">{ticket.description}</p>
                    </div>

                    {/* Assigned to */}
                    {ticket.assignedTo && (
                      <div className="text-sm text-gray-400">
                        {t('tickets.assignedTo')}: <span className="text-white">{getUserName(ticket.assignedTo)}</span>
                      </div>
                    )}

                    {/* Admin controls */}
                    {isAdminUser && (
                      <div className="flex flex-wrap gap-3 items-center">
                        <div>
                          <label className="text-xs text-gray-500 mr-2">{t('common.status')}:</label>
                          <select
                            value={ticket.status}
                            onChange={(e) => handleStatusChange(ticket._id, e.target.value)}
                            className="bg-gray-900/50 border border-gray-600/50 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                          >
                            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                              <option key={key} value={key}>{cfg.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mr-2">{t('tickets.assignTo')}:</label>
                          <select
                            value={ticket.assignedTo?._id || ''}
                            onChange={(e) => handleAssign(ticket._id, e.target.value)}
                            className="bg-gray-900/50 border border-gray-600/50 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                          >
                            <option value="">{t('common.none')}</option>
                            {dashboardUsers.map((u) => (
                              <option key={u._id} value={u._id}>{getUserName(u)}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={() => handleDelete(ticket._id)}
                          className="ml-auto px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    )}

                    {/* Comments */}
                    {ticket.comments && ticket.comments.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs text-gray-500 uppercase tracking-wider">{t('tickets.comments')}</h4>
                        {ticket.comments.map((c, idx) => (
                          <div key={c._id || idx} className="bg-gray-900/30 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-blue-400">{getUserName(c.author)}</span>
                              <span className="text-xs text-gray-600">{formatDate(c.createdAt)}</span>
                            </div>
                            <p className="text-sm text-gray-300">{c.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add comment form */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(ticket._id); }}
                        className="flex-1 bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        placeholder={t('tickets.commentPlaceholder')}
                      />
                      <button
                        onClick={() => handleAddComment(ticket._id)}
                        disabled={submitting || !commentText.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                      >
                        {t('tickets.send')}
                      </button>
                    </div>

                    {/* Edit controls for creator (non-admin) */}
                    {!isAdminUser && isCreator && (
                      <div className="text-xs text-gray-500 italic">
                        {t('tickets.creatorHint')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
