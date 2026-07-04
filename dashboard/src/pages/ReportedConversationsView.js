// pages/ReportedConversationsView.js
//
// All conversations reported via "Reportar esta conversación" (tickets with
// source 'conversation_report'). List on the left; click one to see the full
// conversation (same panels as the Conversations route) on the right, mark it
// solved (with an explanation) or "Sin error", and copy the whole conversation +
// all context as text to paste for a fix.
import React, { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import API from "../api";
import ConversationCommercePanel from "../components/ConversationCommercePanel";
import ConversationHandoffPanel from "../components/ConversationHandoffPanel";

const REASON_LABELS = {
  wrong_info: "Información incorrecta",
  wrong_price: "Precio equivocado",
  wrong_product: "Producto/variante equivocado",
  out_of_family: "Ofreció algo fuera de la familia",
  missed_handoff: "Debió pasar a un humano y no lo hizo",
  bad_tone: "Tono inapropiado",
  hallucination: "Inventó información / política",
  ignored_question: "No respondió lo que se preguntó",
  loop_repetition: "Se repitió / se atoró",
  language_issue: "Problema de idioma / gramática",
  other: "Otro",
};
const SEV = { low: { l: "Baja", c: "#4caf50" }, medium: { l: "Media", c: "#f5a623" }, high: { l: "Alta", c: "#f44336" } };
const STATUS_LABEL = { open: "Abierto", review: "En revisión", working: "En proceso", solved: "Resuelto", dismissed: "Sin error", ya_resuelto: "Ya resuelto" };

export default function ReportedConversationsView() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  // Right-panel conversation data
  const [messages, setMessages] = useState([]);
  const [convoLoading, setConvoLoading] = useState(false);
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTickets = useCallback(async (silent = false) => {
    try {
      const res = await API.get("/tickets");
      setTickets((res.data.data || []).filter((t) => t.source === "conversation_report"));
    } catch (e) {
      if (!silent) toast.error("No se pudieron cargar los reportes");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + silent 1-min polling so new reports surface in near real-time.
  useEffect(() => {
    loadTickets();
    const id = setInterval(() => loadTickets(true), 60000);
    return () => clearInterval(id);
  }, [loadTickets]);

  const openTicket = async (t) => {
    setSelected(t);
    setResolution(t.resolution || "");
    setMessages([]);
    if (!t.psid) return;
    setConvoLoading(true);
    try {
      const res = await API.get(`/conversations/${t.psid}`);
      setMessages([...res.data].reverse()); // oldest first
    } catch (e) {
      toast.error("No se pudo cargar la conversación");
    } finally {
      setConvoLoading(false);
    }
  };

  const resolve = async (status) => {
    if (!selected) return;
    if (status === "solved" && !resolution.trim()) {
      toast.error("Escribe una explicación de la solución");
      return;
    }
    setSaving(true);
    try {
      await API.put(`/tickets/${selected._id}`, {
        status,
        resolution: resolution.trim() || (status === "dismissed" ? "Sin error" : status === "ya_resuelto" ? "Ya resuelto" : ""),
        noError: status === "dismissed",
      });
      toast.success(status === "dismissed" ? "Marcado como Sin error" : status === "ya_resuelto" ? "Marcado como Ya resuelto" : "Marcado como resuelto");
      await loadTickets();
      setSelected((s) => (s ? { ...s, status, resolution } : s));
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const copyAll = async () => {
    if (!selected) return;
    try {
      const [cs, hi] = await Promise.all([
        API.get(`/conversations/${selected.psid}/commerce-status`).then((r) => r.data).catch(() => null),
        API.get(`/conversations/${selected.psid}/handoff-info`).then((r) => r.data).catch(() => null),
      ]);
      const lines = [];
      lines.push("=== CONVERSACIÓN REPORTADA ===");
      lines.push(`Reporte: ${REASON_LABELS[selected.category] || selected.category || "—"} (severidad: ${SEV[selected.priority]?.l || selected.priority})`);
      lines.push(`Reportado: ${new Date(selected.createdAt).toLocaleString()} por ${selected.createdBy?.username || selected.createdBy?.firstName || "—"}`);
      lines.push(`Estado: ${STATUS_LABEL[selected.status] || selected.status}`);
      if (selected.description) lines.push(`Detalle del reporte:\n${selected.description}`);
      lines.push("");
      lines.push(`psid: ${selected.psid}`);
      if (cs) {
        lines.push("--- ESTADO COMERCIAL ---");
        lines.push(`Link: ${cs.clicked ? `clickeado ${cs.clickedAt ? new Date(cs.clickedAt).toLocaleDateString() : ""}` : cs.hasLink ? "enviado, sin clic" : "no enviado"}`);
        lines.push(`Compra: ${cs.purchased ? `$${cs.conversion?.totalAmount || "?"} (${cs.conversion?.confidence || "?"}) ${cs.conversion?.itemTitle || ""}` : "sin compra registrada"}`);
      }
      if (hi && (hi.handoffReason || (hi.collected && Object.values(hi.collected).some(Boolean)))) {
        lines.push("--- HANDOFF / DATOS DEL CLIENTE ---");
        if (hi.handoffReason) lines.push(`Motivo handoff: ${hi.handoffReason}`);
        const c = hi.collected || {};
        const data = [
          ["Cliente", c.name], ["Contacto", c.contact],
          ["Ubicación", [c.city, c.stateMx].filter(Boolean).join(", ") || c.zip],
          ["Producto", c.product], ["Medida", c.size], ["Sombra", c.percentage ? `${c.percentage}%` : null],
          ["Color", c.color], ["Cantidad", c.quantity], ["Anuncio", c.adHeadline], ["Canal", c.channel],
        ].filter(([, v]) => v);
        for (const [k, v] of data) lines.push(`${k}: ${v}`);
      }
      lines.push("");
      lines.push("--- CONVERSACIÓN (cronológica) ---");
      const who = { user: "CLIENTE", bot: "BOT", human: "ASESOR" };
      for (const m of messages) {
        const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
        lines.push(`[${ts}] ${who[m.senderType] || m.senderType}: ${m.text}`);
      }
      const text = lines.join("\n");
      await navigator.clipboard.writeText(text);
      toast.success("Conversación copiada — pégala para pedir la solución");
    } catch (e) {
      toast.error("No se pudo copiar");
    }
  };

  const visible = tickets.filter((t) => (showResolved ? true : !["solved", "dismissed", "ya_resuelto"].includes(t.status)));

  if (loading) return <div className="p-8 text-gray-400">Cargando reportes…</div>;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* LIST */}
      <div className="w-96 shrink-0 border-r border-gray-700 overflow-y-auto">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Convos reportadas</h1>
          <label className="text-xs text-gray-400 flex items-center gap-1">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            ver resueltas
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="p-4 text-gray-500 text-sm">No hay reportes {showResolved ? "" : "pendientes"}.</p>
        ) : (
          visible.map((t) => {
            const sev = SEV[t.priority] || {};
            const closed = ["solved", "dismissed", "ya_resuelto"].includes(t.status);
            return (
              <button
                key={t._id}
                onClick={() => openTicket(t)}
                className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 ${selected?._id === t._id ? "bg-gray-800" : ""}`}
                style={{ borderLeft: `4px solid ${sev.c || "#6b7280"}` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-100">{REASON_LABELS[t.category] || t.category || "Reporte"}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${closed ? "bg-emerald-900/50 text-emerald-300" : "bg-gray-700 text-gray-300"}`}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">psid {t.psid || "—"} · {new Date(t.createdAt).toLocaleDateString()}</div>
              </button>
            );
          })
        )}
      </div>

      {/* DETAIL */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-8 text-gray-500">Selecciona un reporte para ver la conversación.</div>
        ) : (
          <div className="p-5 max-w-3xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-white">{REASON_LABELS[selected.category] || selected.category}</h2>
                <p className="text-xs text-gray-500">
                  Reportado {new Date(selected.createdAt).toLocaleString()} · {STATUS_LABEL[selected.status] || selected.status}
                </p>
              </div>
              <button onClick={copyAll} className="px-3 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold">
                📋 Copiar conversación completa
              </button>
            </div>

            {selected.description && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 mb-3 whitespace-pre-wrap">
                {selected.description}
              </div>
            )}

            {/* Conversation thread */}
            <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 mb-3 max-h-[40vh] overflow-y-auto space-y-2">
              {convoLoading ? (
                <p className="text-gray-500 text-sm">Cargando conversación…</p>
              ) : messages.length === 0 ? (
                <p className="text-gray-500 text-sm">Sin mensajes almacenados para esta conversación.</p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex ${m.senderType === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                      m.senderType === "user" ? "bg-gray-700 text-gray-100" : m.senderType === "human" ? "bg-amber-700/60 text-white" : "bg-primary-700/60 text-white"
                    }`}>
                      <div className="text-[10px] opacity-60 mb-0.5">
                        {m.senderType === "user" ? "Cliente" : m.senderType === "human" ? "Asesor" : "Bot"} · {m.timestamp ? new Date(m.timestamp).toLocaleString() : ""}
                      </div>
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Commerce + handoff panels (same as Conversations route) */}
            <ConversationCommercePanel psid={selected.psid} />
            <ConversationHandoffPanel psid={selected.psid} />

            {/* Resolve */}
            <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/40 mt-3">
              <label className="block text-xs text-gray-400 mb-1">Explicación de la solución</label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={3}
                placeholder="Qué causó el problema y cómo se resolvió…"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
              />
              <div className="flex gap-2">
                <button onClick={() => resolve("solved")} disabled={saving}
                  className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50">
                  {saving ? "Guardando…" : "✓ Marcar como resuelto"}
                </button>
                <button onClick={() => resolve("ya_resuelto")} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
                  title="Era un error real pero ya está corregido; se descuenta del conteo de reportes">
                  Ya resuelto
                </button>
                <button onClick={() => resolve("dismissed")} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-semibold disabled:opacity-50"
                  title="No hubo error en la conversación">
                  Sin error
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
