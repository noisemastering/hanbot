// pages/ConsumoView.js — conversation usage vs the billing plan, as a speedometer.
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
import API from '../api';
import Speedometer from '../components/Speedometer';

function Stat({ label, value, sub, accent }) {
  const color = accent === 'red' ? 'text-red-400' : accent === 'amber' ? 'text-amber-400' : accent === 'green' ? 'text-green-400' : 'text-white';
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="text-gray-400 text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function ConsumoView() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { const res = await API.get('/consumo/usage'); if (res.data.success) setData(res.data); } catch (_) { /* silent */ }
      setLoading(false);
    })();
  }, []);

  if (loading || !data) return <div className="p-6 text-gray-400">{t('common.loading') || 'Cargando…'}</div>;

  const { plan, total, today, remaining, overage, daily, month } = data;
  const maxBar = Math.max(1, ...daily.map((d) => d.count));
  const fmt = (n) => Number(n).toLocaleString('es-MX');
  const money = (n) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${plan.currency}`;
  const lowLeft = remaining < plan.monthlyLimit * 0.1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t('consumo.title')}</h1>
        <p className="text-gray-400 text-sm mt-1">{t('consumo.subtitle', { month })}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-center">
        {/* Speedometer + plan */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 flex flex-col items-center">
          <Speedometer value={total} limit={plan.monthlyLimit} />
          <div className="mt-3 text-center text-sm">
            <span className="text-gray-400">{t('consumo.plan')}: </span>
            <span className="text-white font-semibold">{plan.name}</span>
            <span className="text-gray-500"> · {t('consumo.perMonth', { n: fmt(plan.monthlyLimit) })}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Stat label={t('consumo.today')} value={fmt(today)} />
          <Stat label={t('consumo.thisMonth')} value={fmt(total)} />
          <Stat label={t('consumo.remaining')} value={fmt(remaining)} accent={lowLeft ? 'amber' : 'green'} />
          <Stat
            label={t('consumo.overage')}
            value={fmt(overage.count)}
            accent={overage.count > 0 ? 'red' : undefined}
            sub={overage.count > 0 ? (overage.rate > 0 ? money(overage.cost) : t('consumo.rateTBD')) : null}
          />
        </div>
      </div>

      {/* Daily bars */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mt-6">
        <h2 className="text-white font-semibold mb-4">{t('consumo.byDay')}</h2>
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {daily.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end group" title={`${d.date}: ${d.count}`}>
              <span className="text-[10px] text-gray-400 mb-1">{d.count}</span>
              <div className="w-full rounded-t bg-primary-500/70 group-hover:bg-primary-400 transition-colors" style={{ height: `${(d.count / maxBar) * 100}%`, minHeight: 2 }} />
              <span className="text-[9px] text-gray-500 mt-1">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
