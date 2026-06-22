// components/MaintenanceGate.js
//
// Full-screen translucent overlay shown to EVERYONE below super_admin whenever
// the Killswitch or Nuke'em is engaged. Polls GET /spec-ops/status (exempt from
// the Nuke'em lockdown, so it keeps working even when everything else is 503).
// super_admin is never blocked — they operate the switches.
import React, { useEffect, useState } from "react";
import API from "../api";

export default function MaintenanceGate({ role }) {
  const [halt, setHalt] = useState(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await API.get("/spec-ops/status");
        if (!stop) setHalt(res.data);
      } catch (e) {
        /* status endpoint is exempt; ignore transient errors */
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (role === "super_admin") return null; // operators are never locked out
  const engaged = halt && (halt.killswitch?.engaged || halt.nuke?.engaged);
  if (!engaged) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          maxWidth: 440,
          textAlign: "center",
          background: "rgba(17,24,39,0.96)",
          border: "1px solid #b91c1c",
          borderRadius: 16,
          padding: "2.25rem",
          boxShadow: "0 0 60px rgba(185,28,28,0.35)",
        }}
      >
        <div style={{ fontSize: 44, marginBottom: 10 }}>🛑</div>
        <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
          Procesamiento detenido
        </h2>
        <p style={{ color: "#d1d5db", lineHeight: 1.5 }}>
          El procesamiento ha sido detenido temporalmente. Por favor contacta a tu proveedor.
        </p>
      </div>
    </div>
  );
}
