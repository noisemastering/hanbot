// components/ReportModal.js
//
// Shared "report" modal — the SAME categorized report used on conversations,
// reused by the Sandbox so a simulated conversation can be reported identically.
// Creates a ticket (POST /tickets) with a reason category + traffic-light
// severity → priority. The trigger button lives in each parent; this is the
// modal + submit only (controlled via `open`/`onClose`).
import React, { useState } from "react";
import toast from "react-hot-toast";
import API from "../api";

export const TICKET_REASONS = [
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
export const SEVERITIES = [
  { value: "low", label: "Baja", dot: "#4caf50", ring: "#4caf50" },
  { value: "medium", label: "Media", dot: "#f5a623", ring: "#f5a623" },
  { value: "high", label: "Alta", dot: "#f44336", ring: "#f44336" },
];

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} [heading]      modal heading (default "Reportar conversación")
 * @param {string} [titlePrefix]  ticket title prefix (default "Conversación reportada")
 * @param {string} [contextLine]  first description line (who/what is being reported)
 * @param {string|null} [extra]   appended to the description (e.g. the transcript)
 * @param {string|null} [psid]    conversation/session id to link
 * @param {string} [source]       ticket source tag (e.g. "conversation_report")
 * @param {() => void} [onSubmitted]
 */
export default function ReportModal({
  open,
  onClose,
  heading = "Reportar conversación",
  titlePrefix = "Conversación reportada",
  contextLine = "",
  extra = null,
  psid = null,
  source = "conversation_report",
  onSubmitted,
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setReason("");
    setNote("");
    setSeverity("medium");
    onClose?.();
  };

  const submit = async () => {
    if (!reason) {
      toast.error("Elige un motivo");
      return;
    }
    setSubmitting(true);
    try {
      const reasonLabel = TICKET_REASONS.find((r) => r.value === reason)?.label || reason;
      const sevLabel = SEVERITIES.find((s) => s.value === severity)?.label || severity;
      const description =
        (contextLine ? `${contextLine}\n` : "") +
        `Motivo: ${reasonLabel}\n` +
        `Severidad: ${sevLabel}\n` +
        (note ? `Detalle: ${note}\n` : "") +
        (extra ? `\n${extra}` : "");
      await API.post("/tickets", {
        title: `${titlePrefix}: ${reasonLabel}`,
        description,
        priority: severity,
        psid: psid || null,
        category: reason,
        source,
      });
      toast.success("Reporte enviado como ticket");
      onSubmitted?.();
      close();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo crear el ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 w-full max-w-md">
        <h3 className="text-white font-semibold mb-2">{heading}</h3>
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
          <button onClick={close} className="px-3 py-2 text-sm rounded-lg bg-gray-700 text-white">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-50"
          >
            {submitting ? "Enviando…" : "Crear ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
