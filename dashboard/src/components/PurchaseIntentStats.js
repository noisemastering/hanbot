// components/PurchaseIntentStats.js
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function PurchaseIntentStats() {
  const { t, locale } = useTranslation();

  const INTENT_CONFIG = {
    high: {
      emoji: '🟢',
      label: t('purchaseIntent.high'),
      color: 'green',
      description: t('purchaseIntent.highDesc')
    },
    medium: {
      emoji: '🟡',
      label: t('purchaseIntent.medium'),
      color: 'yellow',
      description: t('purchaseIntent.mediumDesc')
    },
    low: {
      emoji: '🔴',
      label: t('purchaseIntent.low'),
      color: 'red',
      description: t('purchaseIntent.lowDesc')
    }
  };

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedIntent, setSelectedIntent] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/conversations/purchase-intent/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching purchase intent stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeads = async (intent) => {
    setLoadingLeads(true);
    setSelectedIntent(intent);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/conversations/purchase-intent/leads?intent=${intent}&limit=20`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setLeads(data.data);
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoadingLeads(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700/50">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-700 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-700 rounded"></div>
              <div className="h-4 bg-gray-700 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <span>🎯</span>
          <span>{t('purchaseIntent.titleLabel')}</span>
        </h3>
        <button
          onClick={fetchStats}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          {t('purchaseIntent.refresh')}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {['high', 'medium', 'low'].map((intent) => {
          const config = INTENT_CONFIG[intent];
          const count = stats[intent]?.count || 0;
          const percentage = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;

          return (
            <button
              key={intent}
              onClick={() => fetchLeads(intent)}
              className={`p-4 rounded-lg border transition-all ${
                selectedIntent === intent
                  ? `border-${config.color}-500 bg-${config.color}-500/20`
                  : 'border-gray-700 hover:border-gray-600 bg-gray-800/30'
              }`}
            >
              <div className="text-2xl mb-1">{config.emoji}</div>
              <div className="text-2xl font-bold text-white">{count}</div>
              <div className="text-xs text-gray-400">{config.label}</div>
              {stats.total > 0 && (
                <div className="text-xs text-gray-500 mt-1">{percentage}%</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Total */}
      <div className="text-center text-sm text-gray-500 mb-4">
        {t('purchaseIntent.totalWithScore', { count: stats.total })}
      </div>

      {/* Leads List */}
      {selectedIntent && (
        <div className="mt-4 border-t border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center space-x-2">
            <span>{INTENT_CONFIG[selectedIntent].emoji}</span>
            <span>{t('purchaseIntent.leadsLabel', { label: INTENT_CONFIG[selectedIntent].label })}</span>
            <span className="text-gray-500">({INTENT_CONFIG[selectedIntent].description})</span>
          </h4>

          {loadingLeads ? (
            <div className="text-center py-4 text-gray-400">{t('purchaseIntent.loadingLeads')}</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-4 text-gray-500">{t('purchaseIntent.noConversations')}</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {leads.map((lead) => (
                <div
                  key={lead.psid}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-medium">
                        {lead.userName || lead.psid?.slice(-8)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {lead.channel === 'whatsapp' ? '📱' : '💬'}
                      </span>
                    </div>
                    {lead.scoreExplanation && lead.scoreExplanation.length > 0 && (
                      <div className="text-xs text-gray-400 mt-1">
                        {lead.scoreExplanation.slice(0, 2).join(' • ')}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {lead.updatedAt && new Date(lead.updatedAt).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short'
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PurchaseIntentStats;
