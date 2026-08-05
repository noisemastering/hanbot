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

export default function MapaView() {
  const { t } = useTranslation();
  const [metric, setMetric] = useState('ml');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('mapa.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('mapa.subtitle')}</p>
        </div>
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
      </div>

      {(metric === 'ventas' || metric === 'ml') && (
        <div className="mb-3"><CorrelationBadge autorun={metric === 'ventas'} /></div>
      )}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <MexicoMap metric={metric} />
      </div>
      <p className="text-gray-500 text-xs mt-3">{t('mapa.hint')}</p>
    </div>
  );
}
