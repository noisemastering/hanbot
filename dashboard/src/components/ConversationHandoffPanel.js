// components/ConversationHandoffPanel.js
//
// Shown in the open conversation. Surfaces WHY the bot escalated to a human
// (handoff reason) and the client data it collected, so the agent taking over
// has full context. Requirement: every handoff must show its reason + any
// available user data. Reads GET /conversations/:psid/handoff-info.
import React, { useState, useEffect } from "react";
import API from "../api";

// Priority is what lets sales work the queue instead of reading it top to
// bottom. "sistema" is deliberately grey: the bot broke, nobody is waiting to buy.
const PRIORITY_STYLE = {
  alta: "text-red-200 bg-red-900/40 border-red-600",
  media: "text-amber-200 bg-amber-900/40 border-amber-600",
  baja: "text-sky-200 bg-sky-900/30 border-sky-700",
  sistema: "text-gray-300 bg-gray-800/60 border-gray-600",
};

export function PriorityBadge({ priority, label }) {
  if (!priority) return null;
  return (
    <span
      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded border ${PRIORITY_STYLE[priority] || PRIORITY_STYLE.baja}`}
      title={label || ""}
    >
      {priority === "sistema" ? "sistema" : `prioridad ${priority}`}
      {label ? ` · ${label}` : ""}
    </span>
  );
}

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

  const d = info.briefDetail || null;
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
        <div className="flex items-center gap-2">
          {d && <PriorityBadge priority={d.priority} label={d.categoryLabel} />}
          {info.handoffAt && (
            <span className="text-[11px] text-gray-400">
              {new Date(info.handoffAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* THE BRIEF — what the asesor needs to act, before any raw field dump. */}
      {d && (
        <div className="mb-3 rounded-md bg-black/25 border border-amber-800/40 p-2.5">
          <p className="text-amber-50 leading-snug">{d.situation}</p>
          <p className="text-emerald-300 leading-snug mt-1.5">
            <span className="text-emerald-500">Qué sigue: </span>
            {d.nextStep}
          </p>
        </div>
      )}

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
