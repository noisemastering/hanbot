// pages/MapaView.js — Playground: Mexico states choropleth of sales / conversations.
import React, { useState } from 'react';
import { useTranslation } from '../i18n';
import MexicoMap from '../components/MexicoMap';

export default function MapaView() {
  const { t } = useTranslation();
  const [metric, setMetric] = useState('sales');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('mapa.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('mapa.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {['sales', 'conversations'].map((mkey) => (
            <button
              key={mkey}
              onClick={() => setMetric(mkey)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${metric === mkey ? 'bg-primary-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'}`}
            >
              {t(mkey === 'sales' ? 'mapa.sales' : 'mapa.conversations')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <MexicoMap metric={metric} />
      </div>
      <p className="text-gray-500 text-xs mt-3">{t('mapa.hint')}</p>
    </div>
  );
}
