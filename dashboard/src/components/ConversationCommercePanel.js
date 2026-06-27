// components/ConversationCommercePanel.js
//
// Shown when a conversation is open. Surfaces whether the shared link was
// clicked and purchased (with a manual ML re-sync), and lets the agent report
// the conversation as a ticket with a categorized reason.
import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import API from "../api";
import ReportModal from "./ReportModal";

export default function ConversationCommercePanel({ psid }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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

      <ReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        heading="Reportar conversación"
        titlePrefix="Conversación reportada"
        contextLine={`Conversación ${psid} reportada por el agente.`}
        psid={psid}
        source="conversation_report"
      />
    </div>
  );
}

// Certainty % with color/typography hierarchy so the agent judges the data:
// 90–100 solid, 70 amber, 50 muted orange, 25 faint. Undisputed (100 w/ ML match)
// shows a medal.
function Certainty({ conv }) {
  const pct = conv.certainty;
  if (pct == null) {
    // Legacy record (pre-certainty-model) — show the old tier word, clearly cited
    // as the previous criteria so it isn't read as a new % score.
    return (
      <span className="text-xs text-gray-400">
        {conv.confidence ? `Confianza: ${conv.confidence}` : "Registrada"}
        <span className="text-[10px] text-gray-500 italic"> · criterio anterior</span>
      </span>
    );
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
