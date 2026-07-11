// components/CorrelationControl.js
//
// Countdown to the next scheduled correlation + a "correlate now" button. Kept as
// its OWN component so its 1-second countdown tick re-renders only this widget —
// NOT the parent page (which would redraw the chart every second).
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import API from "../api";

export default function CorrelationControl({ onCorrelated }) {
  const [corr, setCorr] = useState(null); // /correlation/status (nextAt, running)
  const [nowTs, setNowTs] = useState(Date.now());
  const [correlatingNow, setCorrelatingNow] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => { try { const { data } = await API.get("/correlation/status"); if (alive) setCorr(data); } catch {} };
    load();
    const tick = setInterval(() => setNowTs(Date.now()), 1000);
    const poll = setInterval(load, 20000);
    return () => { alive = false; clearInterval(tick); clearInterval(poll); };
  }, []);

  const correlateNow = async () => {
    setCorrelatingNow(true);
    try {
      await API.post("/correlation/run");
      for (let i = 0; i < 180; i++) { // up to ~15 min
        await new Promise((r) => setTimeout(r, 5000));
        const s = await API.get("/correlation/status");
        setCorr(s.data);
        if (!s.data.running) break;
      }
      if (onCorrelated) await onCorrelated();
      toast.success("Correlación completada");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo correlacionar");
    } finally {
      setCorrelatingNow(false);
    }
  };

  const running = corr?.running || correlatingNow;
  const secs = corr?.nextAt ? Math.max(0, Math.round((new Date(corr.nextAt).getTime() - nowTs) / 1000)) : null;
  const mmss = secs == null ? null : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2">
      {running ? (
        <span className="text-xs text-blue-300 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Correlacionando…
        </span>
      ) : mmss ? (
        <span className="text-xs text-gray-400">Próxima en <span className="text-gray-200 font-mono">{mmss}</span></span>
      ) : null}
      <button
        onClick={correlateNow}
        disabled={running}
        className="text-xs px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-50"
      >
        ↻ Correlacionar ahora
      </button>
    </div>
  );
}
