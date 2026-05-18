import React from 'react';
import { useTranslation } from '../i18n';

export default function CrossSellView() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <div className="w-16 h-16 rounded-full bg-gray-800/50 border border-gray-700/50 flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-white">{t('crossSell.title')}</h1>
      <p className="text-gray-400 text-sm text-center max-w-md">
        {t('crossSell.description')}
      </p>
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
        {t('crossSell.comingSoon')}
      </span>
    </div>
  );
}
