// pages/MapaView.js — Playground: Mexico states choropleth of sales / conversations.
import React, { useState } from 'react';
import { useTranslation } from '../i18n';
import MexicoMap from '../components/MexicoMap';
import CorrelationBadge from '../components/CorrelationBadge';

const METRICS = [
  { key: 'ml', labelKey: 'mapa.ml' },
  { key: 'ventas', labelKey: 'mapa.ventas' },
  { key: 'conversations', labelKey: 'mapa.conversations' },
  { key: 'clicks', labelKey: 'mapa.clicks' },
];

const PERIODS = [
  { key: '7', labelKey: 'mapa.p7' },
  { key: '30', labelKey: 'mapa.p30' },
  { key: '90', labelKey: 'mapa.p90' },
  { key: 'all', labelKey: 'mapa.pall' },
];

export default function MapaView() {
  const { t } = useTranslation();
  const [metric, setMetric] = useState('ml');
  const [period, setPeriod] = useState('30');

  // Compute the date window for the selected period ('all' = no bounds → all-time).
  const { from, to } = React.useMemo(() => {
    if (period === 'all') return { from: undefined, to: undefined };
    const now = new Date();
    return { from: new Date(now.getTime() - Number(period) * 864e5).toISOString(), to: now.toISOString() };
  }, [period]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('mapa.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('mapa.subtitle')}</p>
        </div>
        <div className="flex flex-col gap-2 items-start sm:items-end">
          <div className="flex flex-wrap gap-2">
            {METRICS.map((mk) => (
              <button
                key={mk.key}
                onClick={() => setMetric(mk.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${metric === mk.key ? 'bg-primary-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}
              >
                {t(mk.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${period === p.key ? 'bg-gray-600 text-white' : 'bg-gray-800/50 text-gray-500 hover:bg-gray-700/50'}`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Only Ventas depends on correlation; the other metrics are raw ML/click/chat data. */}
      {metric === 'ventas' && (
        <div className="mb-3"><CorrelationBadge autorun /></div>
      )}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <MexicoMap metric={metric} from={from} to={to} />
      </div>
      <p className="text-gray-500 text-xs mt-3">{t('mapa.hint')}</p>
    </div>
  );
}
