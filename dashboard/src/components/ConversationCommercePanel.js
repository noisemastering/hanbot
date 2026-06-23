// components/ConversationCommercePanel.js
//
// Shown when a conversation is open. Surfaces whether the shared link was
// clicked and purchased (with a manual ML re-sync), and lets the agent report
// the conversation as a ticket with a categorized reason.
import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import API from "../api";

const TICKET_REASONS = [
  { value: "wrong_info", label: "Información incorrecta" },
  { value: "wrong_price", label: "Precio equivocado" },
  { value: "wrong_product", label: "Producto/variante equivocado" },
  { value: "out_of_family", label: "Ofreció algo fuera de la familia" },
  { value: "missed_handoff", label: "Debió pasar a un humano y no lo hizo" },
  { value: "bad_tone", label: "Tono inapropiado" },
  { value: "hallucination", label: "Inventó información / política" },
  { value: "ignored_question", label: "No respondió lo que se preguntó" },
  { value: "loop_repetition", label: "Se repitió / se atoró" },
  { value: "language_issue", label: "Problema de idioma / gramática" },
  { value: "other", label: "Otro" },
];

// Traffic-light severity → maps to the ticket `priority` enum (low|medium|high).
const SEVERITIES = [
  { value: "low", label: "Baja", dot: "#4caf50", ring: "#4caf50" },
  { value: "medium", label: "Media", dot: "#f5a623", ring: "#f5a623" },
  { value: "high", label: "Alta", dot: "#f44336", ring: "#f44336" },
];

export default function ConversationCommercePanel({ psid }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("medium"); // traffic light → ticket priority
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (sync) => {
      if (!psid) return;
      sync ? setSyncing(true) : setLoading(true);
      try {
        const res = await API.get(`/conversations/${psid}/commerce-status${sync ? "?sync=true" : ""}`);
        setStatus(res.data);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudo cargar el estado de compra");
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [psid]
  );

  useEffect(() => {
    setStatus(null);
    load(false);
  }, [load]);

  const submitTicket = async () => {
    if (!reason) {
      toast.error("Elige un motivo");
      return;
    }
    setSubmitting(true);
    try {
      const reasonLabel = TICKET_REASONS.find((r) => r.value === reason)?.label || reason;
      const sevLabel = SEVERITIES.find((s) => s.value === severity)?.label || severity;
      await API.post("/tickets", {
        title: `Conversación reportada: ${reasonLabel}`,
        description:
          `Conversación ${psid} reportada por el agente.\n` +
          `Motivo: ${reasonLabel}\n` +
          `Severidad: ${sevLabel}\n` +
          (note ? `Detalle: ${note}` : ""),
        priority: severity,
        psid,
        category: reason,
        source: "conversation_report",
      });
      toast.success("Conversación reportada como ticket");
      setModalOpen(false);
      setReason("");
      setNote("");
      setSeverity("medium");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo crear el ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (!psid) return null;

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/40 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-gray-400">Estado comercial</span>
        <button
          onClick={() => load(true)}
          disabled={syncing}
          className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50"
          title="Sincroniza pedidos recientes de Mercado Libre y vuelve a correlacionar"
        >
          {syncing ? "Sincronizando…" : "↻ Sincronizar ML"}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-xs">Cargando…</p>
      ) : status ? (
        <div className="space-y-1">
          <Indicator
            on={status.clicked}
            onLabel={`Link clickeado${status.clickedAt ? ` (${new Date(status.clickedAt).toLocaleDateString()})` : ""}`}
            offLabel={status.hasLink ? "Link enviado, sin clic aún" : "No se ha enviado link"}
          />
          <Indicator
            on={status.purchased}
            onLabel={
              status.purchased
                ? `Compró${status.conversion?.totalAmount ? ` — $${status.conversion.totalAmount}` : ""}`
                : ""
            }
            offLabel="Sin compra registrada"
          />
          {status.purchased && status.conversion && (
            <div className="pl-4 space-y-0.5">
              <Certainty conv={status.conversion} />
              {status.conversion.attributionReason && (
                <p className="text-[10px] text-gray-500">{status.conversion.attributionReason}</p>
              )}
              {status.conversion.itemTitle && (
                <p className="text-[11px] text-gray-400">{status.conversion.itemTitle}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-gray-500 text-xs">—</p>
      )}

      <button
        onClick={() => setModalOpen(true)}
        className="mt-3 w-full text-xs px-2 py-1.5 rounded bg-red-600/80 hover:bg-red-600 text-white"
      >
        🚩 Reportar esta conversación
      </button>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 w-full max-w-md">
            <h3 className="text-white font-semibold mb-2">Reportar conversación</h3>
            <label className="block text-xs text-gray-400 mb-1">¿Qué estuvo mal?</label>
            <select
              className="wf-input w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">— elige un motivo —</option>
              {TICKET_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="block text-xs text-gray-400 mb-1">Severidad</label>
            <div className="flex gap-2 mb-3">
              {SEVERITIES.map((s) => {
                const active = severity === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSeverity(s.value)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
                    style={{
                      backgroundColor: active ? `${s.dot}22` : "#111827",
                      border: `1px solid ${active ? s.ring : "#374151"}`,
                      color: active ? "#fff" : "#9ca3af",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: s.dot,
                        opacity: active ? 1 : 0.5,
                        boxShadow: active ? `0 0 6px ${s.dot}` : "none",
                      }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>
            <label className="block text-xs text-gray-400 mb-1">Detalle (opcional)</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contexto adicional…"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-3 py-2 text-sm rounded-lg bg-gray-700 text-white">
                Cancelar
              </button>
              <button
                onClick={submitTicket}
                disabled={submitting}
                className="px-3 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-50"
              >
                {submitting ? "Enviando…" : "Crear ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Certainty % with color/typography hierarchy so the agent judges the data:
// 90–100 solid, 70 amber, 50 muted orange, 25 faint. Undisputed (100 w/ ML match)
// shows a medal.
function Certainty({ conv }) {
  const pct = conv.certainty;
  if (pct == null) {
    // Legacy record without a certainty score — fall back to the old tier word.
    return conv.confidence ? <span className="text-xs text-gray-400">Confianza: {conv.confidence}</span> : null;
  }
  const style =
    pct >= 90 ? { color: "#34d399", weight: 700, size: "0.95rem" } // solid green, prominent
      : pct >= 70 ? { color: "#fbbf24", weight: 600, size: "0.85rem" } // amber
      : pct >= 50 ? { color: "#fb923c", weight: 500, size: "0.8rem" } // muted orange
      : { color: "#9ca3af", weight: 400, size: "0.75rem" }; // faint gray (25%)
  return (
    <span style={{ color: style.color, fontWeight: style.weight, fontSize: style.size }}>
      {pct}% de certeza{conv.undisputed ? " 🏅" : ""}{conv.ventaIndirecta ? " · venta indirecta" : ""}
    </span>
  );
}

function Indicator({ on, onLabel, offLabel }) {
  return (
    <div className="flex items-center gap-2">
      <span className={on ? "text-emerald-400" : "text-gray-500"}>{on ? "●" : "○"}</span>
      <span className={on ? "text-gray-100" : "text-gray-500"}>{on ? onLabel : offLabel}</span>
    </div>
  );
}
