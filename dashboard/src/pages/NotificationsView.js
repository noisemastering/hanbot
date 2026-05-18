import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export default function NotificationsView() {
  const { canManageUsers } = useAuth();
  const { t } = useTranslation();
  const isAdminUser = canManageUsers();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', message: '', type: 'global', targetUserId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [dashboardUsers, setDashboardUsers] = useState([]);

  const getToken = () => localStorage.getItem('token');

  const fetchNotifications = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setNotifications(data.data);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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
    fetchNotifications();
    if (isAdminUser) fetchUsers();
  }, [fetchNotifications, fetchUsers, isAdminUser]);

  const markAsRead = async (id) => {
    try {
      const token = getToken();
      await fetch(`${API_URL}/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const token = getToken();
      await fetch(`${API_URL}/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.message.trim()) return;
    if (formData.type === 'individual' && !formData.targetUserId) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: formData.title,
          message: formData.message,
          type: formData.type,
          targetUserId: formData.type === 'individual' ? formData.targetUserId : undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        // Re-fetch to get isRead flag correctly computed
        fetchNotifications();
        setFormData({ title: '', message: '', type: 'global', targetUserId: '' });
        setShowForm(false);
      }
    } catch (err) {
      console.error('Error creating notification:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExpand = (id) => {
    const notif = notifications.find((n) => n._id === id);
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (notif && !notif.isRead) {
      markAsRead(id);
    }
  };

  const formatDate = (d) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getUserName = (u) => {
    if (!u) return '—';
    return u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.username;
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{t('notifications.title')}</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition-colors"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
          {isAdminUser && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {showForm ? t('common.cancel') : t('notifications.new')}
            </button>
          )}
        </div>
      </div>

      {/* Create form (admin only) */}
      {showForm && isAdminUser && (
        <form onSubmit={handleCreate} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('tickets.titleField')}</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder={t('notifications.titlePlaceholder')}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('notifications.message')}</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className="w-full bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 min-h-[80px]"
              placeholder={t('notifications.messagePlaceholder')}
              required
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('common.type')}</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value, targetUserId: '' })}
                className="bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="global">{t('notifications.global')}</option>
                <option value="individual">{t('notifications.individual')}</option>
              </select>
            </div>
            {formData.type === 'individual' && (
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1">{t('notifications.targetUser')}</label>
                <select
                  value={formData.targetUserId}
                  onChange={(e) => setFormData({ ...formData, targetUserId: e.target.value })}
                  className="w-full bg-gray-900/50 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">{t('notifications.selectUser')}</option>
                  {dashboardUsers.map((u) => (
                    <option key={u._id} value={u._id}>{getUserName(u)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? t('common.loading') : t('notifications.send')}
          </button>
        </form>
      )}

      {/* Notification list */}
      {notifications.length === 0 ? (
        <div className="text-center text-gray-500 py-12">{t('notifications.empty')}</div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const isExpanded = expandedId === notif._id;

            return (
              <div
                key={notif._id}
                className={`rounded-xl overflow-hidden border transition-colors ${
                  notif.isRead
                    ? 'bg-gray-800/30 border-gray-700/30'
                    : 'bg-gray-800/60 border-blue-500/30'
                }`}
              >
                <div
                  className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
                  onClick={() => handleExpand(notif._id)}
                >
                  {/* Unread dot */}
                  {!notif.isRead && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${notif.isRead ? 'text-gray-400' : 'text-white'}`}>
                        {notif.title}
                      </span>
                      {notif.type === 'individual' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                          {t('notifications.individual')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-500 text-xs flex-shrink-0">{getUserName(notif.createdBy)}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0">{formatDate(notif.createdAt)}</span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-700/50 px-5 py-4">
                    <p className="text-gray-300 text-sm whitespace-pre-wrap">{notif.message}</p>
                    {notif.type === 'individual' && notif.targetUserId && (
                      <div className="mt-2 text-xs text-gray-500">
                        {t('notifications.sentTo')}: <span className="text-gray-400">{getUserName(notif.targetUserId)}</span>
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
