import React, { useState, useEffect, useRef } from 'react';

/**
 * PeriodSelector — shortcut chips (7d/15d/30d/90d/etc.) + custom date range.
 *
 * Controlled. Parent passes the current dateFrom/dateTo (ISO date strings,
 * "YYYY-MM-DD" or full ISO) and receives onChange({ from, to, shortcut })
 * whenever the period changes.
 *
 * Props:
 *  shortcuts: number[]  — list of day-counts to render as chips. Default [7,15,30,90].
 *  dateFrom: string     — current start date
 *  dateTo: string       — current end date (defaults to today)
 *  onChange: fn         — called with { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', shortcut: number|null }
 *  className: string    — optional wrapper className
 */
export default function PeriodSelector({
  shortcuts = [7, 15, 30, 90],
  dateFrom,
  dateTo,
  onChange,
  className = ''
}) {
  const todayISO = () => new Date().toISOString().split('T')[0];
  const daysAgoISO = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  };

  // Derive which shortcut (if any) currently matches dateFrom/dateTo
  const matchesShortcut = (from, to) => {
    if (!from || !to) return null;
    const fromShort = from.slice(0, 10);
    const toShort = to.slice(0, 10);
    if (toShort !== todayISO()) return null;
    for (const n of shortcuts) {
      if (fromShort === daysAgoISO(n)) return n;
    }
    return null;
  };

  const [showCustom, setShowCustom] = useState(false);
  const popoverRef = useRef(null);
  const activeShortcut = matchesShortcut(dateFrom, dateTo);

  // Close popover on outside click
  useEffect(() => {
    if (!showCustom) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowCustom(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCustom]);

  const pickShortcut = (n) => {
    setShowCustom(false);
    onChange?.({ from: daysAgoISO(n), to: todayISO(), shortcut: n });
  };

  const applyCustom = (from, to) => {
    if (!from || !to) return;
    onChange?.({ from, to, shortcut: null });
  };

  const chipClass = (active) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
      active
        ? 'bg-purple-600 text-white'
        : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
    }`;

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      {shortcuts.map(n => (
        <button
          key={n}
          type="button"
          onClick={() => pickShortcut(n)}
          className={chipClass(activeShortcut === n)}
        >
          {n}d
        </button>
      ))}

      <button
        type="button"
        onClick={() => setShowCustom(s => !s)}
        title="Rango personalizado"
        className={chipClass(activeShortcut === null && !!dateFrom)}
      >
        {activeShortcut === null && dateFrom
          ? `${dateFrom.slice(5, 10)} → ${(dateTo || todayISO()).slice(5, 10)}`
          : 'Personalizado'}
      </button>

      {showCustom && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-2 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 w-72"
        >
          <p className="text-xs text-gray-400 mb-3">Selecciona un rango</p>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desde</label>
              <input
                type="date"
                value={(dateFrom || daysAgoISO(30)).slice(0, 10)}
                max={(dateTo || todayISO()).slice(0, 10)}
                onChange={(e) => applyCustom(e.target.value, (dateTo || todayISO()).slice(0, 10))}
                className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hasta</label>
              <input
                type="date"
                value={(dateTo || todayISO()).slice(0, 10)}
                min={(dateFrom || daysAgoISO(30)).slice(0, 10)}
                max={todayISO()}
                onChange={(e) => applyCustom((dateFrom || daysAgoISO(30)).slice(0, 10), e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCustom(false)}
              className="px-3 py-1 text-xs text-gray-400 hover:text-white"
            >
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
