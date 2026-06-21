// components/ConversationHandoffPanel.js
//
// Shown in the open conversation. Surfaces WHY the bot escalated to a human
// (handoff reason) and the client data it collected, so the agent taking over
// has full context. Requirement: every handoff must show its reason + any
// available user data. Reads GET /conversations/:psid/handoff-info.
import React, { useState, useEffect } from "react";
import API from "../api";

export default function ConversationHandoffPanel({ psid }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!psid) {
      setInfo(null);
      return;
    }
    setInfo(null);
    let cancelled = false;
    API.get(`/conversations/${psid}/handoff-info`)
      .then((r) => {
        if (!cancelled) setInfo(r.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [psid]);

  if (!info) return null;

  const c = info.collected || {};
  const rows = [
    ["Cliente", c.name],
    ["Contacto", c.contact],
    ["Ubicación", [c.city, c.stateMx].filter(Boolean).join(", ") || c.zip],
    ["Producto", c.product],
    ["Medida", c.size],
    ["Sombra", c.percentage ? `${c.percentage}%` : null],
    ["Color", c.color],
    ["Cantidad", c.quantity],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  // Don't render an empty card on a plain bot conversation with nothing yet.
  if (!info.handoffReason && rows.length === 0) return null;

  return (
    <div className="border border-amber-700/50 rounded-lg p-3 bg-amber-900/10 text-sm mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-amber-400">🙋 Handoff a humano</span>
        {info.handoffAt && (
          <span className="text-[11px] text-gray-400">
            {new Date(info.handoffAt).toLocaleString()}
          </span>
        )}
      </div>

      {info.handoffReason && (
        <p className="text-amber-100 mb-2 leading-snug">
          <span className="text-amber-400">Motivo: </span>
          {info.handoffReason}
        </p>
      )}

      {rows.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-[11px] uppercase text-gray-500 mb-1">Datos del cliente</div>
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-gray-200">
              <span className="text-gray-400 w-24 shrink-0">{k}:</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-400 text-xs">Sin datos del cliente capturados aún.</p>
      )}
    </div>
  );
}
