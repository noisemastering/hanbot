// components/CorrelationBadge.js
//
// Drop this on any view that displays sales. On mount it checks when the last FULL
// correlation ran; if that's stale (or never), it kicks a full rebuild and shows a
// live "Correlacionando…" state, polling until it finishes. When everything's fresh
// it just shows when the last full correlation ran. Read-only otherwise.
import React, { useEffect, useRef, useState, useCallback } from "react";
import API from "../api";

function ago(date) {
  if (!date) return "nunca";
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
}

export default function CorrelationBadge({ autorun = true }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false); // we triggered a full run
  const pollRef = useRef(null);
  const kicked = useRef(false);

  const fetchStatus = useCallback(async () => {
    try { const { data } = await API.get("/correlation/status"); if (data.success !== false) setStatus(data); return data; }
    catch { return null; }
  }, []);

  const poll = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await fetchStatus();
      if (d && !d.running) { clearInterval(pollRef.current); setBusy(false); }
    }, 5000);
  }, [fetchStatus]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await fetchStatus();
      if (!alive || !d) return;
      if (d.running) { setBusy(true); poll(); return; }
      // Run a FULL rebuild only if it's stale (or never run) — and only once per mount.
      if (autorun && d.fullStale && !kicked.current) {
        kicked.current = true;
        setBusy(true);
        try { await API.post("/correlation/run?full=1"); } catch { /* ignore */ }
        poll();
      }
    })();
    return () => { alive = false; clearInterval(pollRef.current); };
  }, [autorun, fetchStatus, poll]);

  if (!status) return null;

  const running = busy || status.running;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: running ? "#93c5fd" : "#8a8f98", background: "#1b1e26", border: "1px solid #2b2f3a", borderRadius: 8, padding: "5px 10px" }}>
      {running ? (
        <>
          <span style={{ width: 12, height: 12, border: "2px solid #4a7cff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "cbspin 0.7s linear infinite" }} />
          Correlacionando ventas…
          <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : (
        <>
          <span style={{ color: "#22c55e" }}>●</span>
          Última correlación completa: {ago(status.lastFullAt)}
        </>
      )}
    </div>
  );
}
