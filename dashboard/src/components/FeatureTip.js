import React, { useState, useEffect, useRef } from 'react';

/**
 * FeatureTip — Google-style onboarding tooltip for new features.
 *
 * Props:
 *   id        — unique tip identifier (stored in localStorage when dismissed)
 *   title     — bold header text
 *   text      — description text
 *   position  — 'top' | 'bottom' | 'left' | 'right' (default: 'bottom')
 *   children  — the element to wrap (tip appears relative to it)
 *   step      — optional step number (e.g., "1 de 3")
 *   onDismiss — optional callback when dismissed
 */

const STORAGE_KEY = 'hanlob_seen_tips';

function getSeenTips() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function markSeen(id) {
  const seen = getSeenTips();
  if (!seen.includes(id)) {
    seen.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  }
}

export function resetAllTips() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function FeatureTip({ id, title, text, position = 'bottom', step, children, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const seen = getSeenTips();
    if (!seen.includes(id)) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, [id]);

  const dismiss = () => {
    setVisible(false);
    markSeen(id);
    if (onDismiss) onDismiss();
  };

  const positionClasses = {
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-3',
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-3',
    left: 'right-full top-1/2 -translate-y-1/2 mr-3',
    right: 'left-full top-1/2 -translate-y-1/2 ml-3',
  };

  const arrowClasses = {
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-blue-600',
    top: 'top-full left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-blue-600',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-blue-600',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-blue-600',
  };

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      {children}
      {visible && (
        <>
          {/* Backdrop pulse ring */}
          <div className="absolute inset-0 rounded-lg ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900 animate-pulse pointer-events-none z-40" />

          {/* Tooltip */}
          <div className={`absolute z-50 ${positionClasses[position]} w-72`}>
            {/* Arrow */}
            <div className={`absolute ${arrowClasses[position]} w-0 h-0`} />

            <div className="bg-blue-600 rounded-xl shadow-xl shadow-blue-500/20 p-4">
              {step && (
                <p className="text-blue-200 text-xs font-medium mb-1">{step}</p>
              )}
              <h3 className="text-white font-bold text-sm mb-1">{title}</h3>
              <p className="text-blue-100 text-xs leading-relaxed mb-3">{text}</p>
              <div className="flex justify-end">
                <button
                  onClick={dismiss}
                  className="px-3 py-1 bg-white text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-50 transition-colors"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
