// components/ApiHealthAlerts.js
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { useAuth } from '../contexts/AuthContext';

const API_URL = process.env.REACT_APP_API_URL || "https://hanbot-production.up.railway.app";

const SERVICE_NAMES = {
  openai: 'OpenAI',
  mercadolibre: 'Mercado Libre',
  facebook: 'Facebook',
  mongodb: 'MongoDB'
};

const SERVICE_ICONS = {
  openai: '🤖',
  mercadolibre: '🛒',
  facebook: '📱',
  mongodb: '🗄️'
};

function ApiHealthAlerts() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState({});
  const [loading, setLoading] = useState(true);
  const [aiUsage, setAiUsage] = useState(null);

  const { simulationMode } = useAuth();
  const effectiveRole = simulationMode?.role || user?.role;
  const isSuperAdmin = effectiveRole === 'super_admin' || effectiveRole === 'admin';

  const fetchAlerts = useCallback(async () => {
    if (!user || !isSuperAdmin) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/health/alerts`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        console.warn('Failed to fetch health alerts:', res.status);
        return;
      }

      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts || []);
      }

      // Also fetch AI usage
      const aiRes = await fetch(`${API_URL}/health/ai-usage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.success) setAiUsage(aiData);
      }
    } catch (error) {
      console.error('Error fetching health alerts:', error);
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin]);

  useEffect(() => {
    fetchAlerts();

    // Poll every 30 seconds
    const interval = setInterval(fetchAlerts, 30000);

    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleDismiss = (service) => {
    setDismissed(prev => ({ ...prev, [service]: true }));
  };

  // Filter out dismissed alerts
  const visibleAlerts = alerts.filter(alert => !dismissed[alert.service]);

  const showAiWarning = aiUsage && (aiUsage.status === 'critical' || aiUsage.status === 'warning');

  if (!isSuperAdmin || loading || (visibleAlerts.length === 0 && !showAiWarning)) {
    return null;
  }

  return (
    <div className="space-y-2 mb-4">
      {/* AI Usage Warning */}
      {showAiWarning && !dismissed['ai-usage'] && (
        <div className={`${aiUsage.status === 'critical' ? 'bg-red-900/30 border-red-500/50' : 'bg-amber-900/30 border-amber-500/50'} border rounded-lg p-4 flex items-start justify-between`}>
          <div className="flex items-start space-x-3">
            <span className="text-2xl">{aiUsage.status === 'critical' ? '🚨' : '⚠️'}</span>
            <div>
              <h4 className={`${aiUsage.status === 'critical' ? 'text-red-400' : 'text-amber-400'} font-semibold`}>
                {aiUsage.status === 'critical' ? 'OpenAI — Créditos agotados o límite alcanzado' : 'OpenAI — Uso elevado'}
              </h4>
              <p className="text-sm text-gray-300 mt-1">
                {aiUsage.quotaError
                  ? `Error de cuota detectado: ${aiUsage.quotaError.message?.slice(0, 100)}`
                  : `Hoy: ${aiUsage.dailyCalls} llamadas, ~${aiUsage.dailyTokens?.toLocaleString()} tokens (~$${aiUsage.dailyCostMXN} MXN, ${aiUsage.dailyBudgetPct}% del diario).`
                }
              </p>
              <p className="text-sm text-gray-300 mt-0.5">
                Mes ({aiUsage.month}): {aiUsage.monthlyCalls?.toLocaleString()} llamadas, ~${ aiUsage.monthlyCostMXN} MXN de ${aiUsage.monthlyBudget ? `$${aiUsage.monthlyBudget}` : '—'} presupuesto ({aiUsage.monthlyBudgetPct}%).
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {aiUsage.status === 'critical'
                  ? 'El bot no puede responder con IA hasta que se renueven los créditos. Revisa tu cuenta en platform.openai.com.'
                  : aiUsage.monthlyBudgetPct > 80
                    ? 'El gasto mensual se acerca al límite. Revisa el consumo o incrementa el presupuesto.'
                    : 'Consumo diario elevado. Considera revisar si es inusual.'}
              </p>
            </div>
          </div>
          <button onClick={() => handleDismiss('ai-usage')} className="text-gray-400 hover:text-white text-lg ml-4" title="Cerrar">×</button>
        </div>
      )}

      {visibleAlerts.map((alert) => (
        <div
          key={alert.service}
          className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 flex items-start justify-between"
        >
          <div className="flex items-start space-x-3">
            <span className="text-2xl">{SERVICE_ICONS[alert.service] || '⚠️'}</span>
            <div>
              <h4 className="text-red-400 font-semibold">
                {SERVICE_NAMES[alert.service] || alert.service} - {t('apiHealth.error')}
              </h4>
              <p className="text-gray-300 text-sm">
                {alert.errorCode && <span className="text-red-300 font-mono mr-2">[{alert.errorCode}]</span>}
                {alert.errorMessage || t('apiHealth.apiErrorDetected')}
              </p>
              <div className="flex items-center space-x-4 mt-1 text-xs text-gray-400">
                <span>{t('apiHealth.consecutiveErrors')} {alert.consecutiveErrors}</span>
                <span>{t('apiHealth.errorsLast24h')} {alert.errorsLast24h}</span>
                <span>
                  {t('apiHealth.since')} {new Date(alert.since).toLocaleString(locale, {
                    timeZone: 'America/Mexico_City',
                    hour: '2-digit',
                    minute: '2-digit',
                    day: 'numeric',
                    month: 'short'
                  })}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => handleDismiss(alert.service)}
            className="text-gray-400 hover:text-white transition-colors p-1"
            title={t('apiHealth.hideAlert')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export default ApiHealthAlerts;
