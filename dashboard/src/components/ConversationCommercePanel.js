// components/ConversationCommercePanel.js
//
// Shown when a conversation is open. Surfaces whether the shared link was
// clicked and purchased (with a manual ML re-sync), and lets the agent report
// the conversation as a ticket with a categorized reason.
import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import API from "../api";
import ReportModal from "./ReportModal";
import MatchDataCompare from "./MatchDataCompare";

export default function ConversationCommercePanel({ psid }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [correlating, setCorrelating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!psid) return;
    setLoading(true);
    try {
      // Same source as the charts: clicked (ClickLog) + purchased (convo_sale_matches).
      const res = await API.get(`/correlation/convo/${psid}`);
      setStatus(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo cargar el estado de compra");
    } finally {
      setLoading(false);
    }
  }, [psid]);

  // Human override: deem this conversation a sale / not-a-sale (or clear it).
  const setVerdict = useCallback(async (verdict) => {
    try {
      await API.post(`/correlation/override/${psid}`, { verdict });
      await load();
      toast.success(
        verdict === "sale" ? "Marcada como venta" : verdict === "no_sale" ? "Marcada como NO venta" : "Override eliminado"
      );
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar el veredicto");
    }
  }, [psid, load]);

  // Correlate ONLY this conversation (not the whole batch): blocking + fast, then reload.
  const correlate = useCallback(async () => {
    setCorrelating(true);
    try {
      const { data } = await API.post(`/correlation/run/${psid}`);
      await load();
      toast.success(data?.matched ? "Venta correlacionada" : "Sin venta para esta conversación");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo correlacionar");
    } finally {
      setCorrelating(false);
    }
  }, [psid, load]);

  useEffect(() => {
    setStatus(null);
    load();
  }, [load]);

  if (!psid) return null;

  const lc = status?.lastCorrelation;
  const lastRunLabel = lc?.lastRun
    ? `${new Date(lc.lastRun).toLocaleString()}${lc.ageHours != null ? ` · hace ${lc.ageHours}h` : ""}`
    : "nunca";
  const busy = correlating || lc?.running;

  // When did the SALE happen (not the conversation)? A convo can resurface today
  // (a human sent a link) while its attributed sale is months old — so lead the
  // purchase with its own date + age and flag "no es de hoy" so nobody reads an
  // old sale as a today sale.
  const saleWhen = (() => {
    const raw = status?.conversion?.saleDate;
    const d = raw ? new Date(raw) : null;
    if (!d || isNaN(d.getTime())) return null;
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const months = Math.round(days / 30);
    const ago =
      days <= 0 ? "hoy" : days === 1 ? "ayer"
        : days < 30 ? `hace ${days} días`
        : days < 365 ? `hace ${months} ${months > 1 ? "meses" : "mes"}`
        : `hace ${Math.round(days / 365)} año(s)`;
    return {
      date: d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }),
      ago,
      isOld: days > 1,
    };
  })();

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/40 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-gray-400">Estado comercial</span>
        <button
          onClick={correlate}
          disabled={busy}
          className="text-xs px-2 py-0.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-50"
          title="Correlaciona SOLO esta conversación con ventas (rápido, sin correr todo el lote)"
        >
          {busy ? "Correlacionando…" : "↻ Correlacionar"}
        </button>
      </div>

      {/* Last correlation time + staleness */}
      <div className="mb-2 text-[10px] text-gray-500 flex items-center gap-1">
        <span>Última correlación: {lastRunLabel}</span>
        {lc?.stale && !busy && <span className="text-amber-400">· desactualizada (&gt;3h)</span>}
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
                ? `Compró${status.conversion?.totalAmount ? ` — $${status.conversion.totalAmount}` : ""}${saleWhen ? ` · ${saleWhen.date}` : ""}`
                : ""
            }
            offLabel="Sin compra registrada"
          />
          {status.purchased && status.conversion && (
            <div className="pl-4 space-y-0.5">
              {saleWhen?.isOld && (
                <div className="text-[11px] font-medium text-amber-300/90">
                  🗓️ Venta del {saleWhen.date} · {saleWhen.ago} — no es de hoy
                </div>
              )}
              <Certainty conv={status.conversion} />
              {status.conversion.itemTitle && (
                <p className="text-[11px] text-gray-400">{status.conversion.itemTitle}</p>
              )}
              {status.conversion.orderId && (
                <p className="text-[10px] text-gray-500 font-mono">
                  Venta ID: <span className="text-gray-300">{status.conversion.orderId}</span>
                </p>
              )}
              {/* The actual data we matched on — convo vs ML, same as the conversions table. */}
              {status.matchDetails && (
                <div className="mt-1.5 pt-1.5 border-t border-gray-700/40">
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Datos del match</div>
                  <MatchDataCompare md={status.matchDetails} saleItemTitle={status.saleItemTitle} signals={status.signals} />
                </div>
              )}
            </div>
          )}

          {/* Clicks + sale over time — makes the temporal proximity explicit so a
              sale is never read as "same-day as the chat" when it isn't. */}
          {status.timeline?.length > 0 && (
            <Timeline
              events={status.timeline}
              gapHours={status.saleGapHours}
              sameDay={status.saleSameDayAsClick}
            />
          )}
        </div>
      ) : (
        <p className="text-gray-500 text-xs">—</p>
      )}

      {/* Human verdict — a person overrides the algorithm (both directions). */}
      {status && (
        <div className="mt-3 pt-2 border-t border-gray-700/60">
          <div className="text-[10px] uppercase text-gray-500 mb-1">
            Veredicto humano
            {status.override === "sale" && <span className="ml-1 text-emerald-400">· marcada como VENTA</span>}
            {status.override === "no_sale" && <span className="ml-1 text-red-400">· marcada como NO venta</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setVerdict(status.override === "sale" ? null : "sale")}
              className={`flex-1 text-xs px-2 py-1 rounded border ${status.override === "sale" ? "bg-emerald-600 text-white border-emerald-500" : "border-emerald-600/60 text-emerald-300 hover:bg-emerald-600/20"}`}
            >
              {status.override === "sale" ? "✓ Es venta" : "Marcar como venta"}
            </button>
            <button
              onClick={() => setVerdict(status.override === "no_sale" ? null : "no_sale")}
              className={`flex-1 text-xs px-2 py-1 rounded border ${status.override === "no_sale" ? "bg-red-600 text-white border-red-500" : "border-red-600/60 text-red-300 hover:bg-red-600/20"}`}
            >
              {status.override === "no_sale" ? "✕ No es venta" : "Marcar como NO venta"}
            </button>
          </div>
          {status.override && (
            <button onClick={() => setVerdict(null)} className="mt-1 text-[10px] text-gray-500 hover:text-gray-300 underline">
              quitar veredicto (usar el del sistema)
            </button>
          )}
        </div>
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
  // The CRITERION that earned the score (the signal combo before the time/pct),
  // shown right beside the % so the reviewer sees WHY, not just how much.
  const criterio = conv.attributionReason ? String(conv.attributionReason).split(" · ")[0] : null;
  return (
    <span style={{ color: style.color, fontWeight: style.weight, fontSize: style.size }}>
      {pct}% de certeza{conv.undisputed ? " 🏅" : ""}{conv.ventaIndirecta ? " · venta indirecta" : ""}
      {criterio && <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: "0.75rem" }}> · {criterio}</span>}
    </span>
  );
}

// Chronological clicks + sale, with the sale→click gap. When the sale is NOT the
// same local day as any click it's flagged loudly (should never happen under the
// gates, but the timeline is the proof, not a promise).
function Timeline({ events, gapHours, sameDay }) {
  const fmt = (d) =>
    new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const gapLabel =
    gapHours == null ? null
      : gapHours < 1 ? `${Math.round(gapHours * 60)} min` : `${gapHours} h`;
  return (
    <div className="mt-2 pt-2 border-t border-gray-700/60">
      <div className="text-[10px] uppercase text-gray-500 mb-1">Cronología</div>
      <ul className="space-y-1">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span className={e.type === "sale" ? "text-emerald-400" : "text-blue-400"}>
              {e.type === "sale" ? "🛒" : "🔗"}
            </span>
            <span className="text-gray-500 whitespace-nowrap tabular-nums">{fmt(e.date)}</span>
            <span className={e.type === "sale" ? "text-emerald-300" : "text-gray-300"}>
              {e.type === "sale"
                ? `Venta${e.amount ? ` — $${e.amount}` : ""}${e.certainty != null ? ` · ${e.certainty}%` : ""}`
                : e.label}
            </span>
          </li>
        ))}
      </ul>
      {gapLabel != null && (
        <p className={`mt-1 text-[10px] ${sameDay ? "text-gray-500" : "text-red-400 font-semibold"}`}>
          {sameDay
            ? `Venta a ${gapLabel} del clic más cercano (mismo día)`
            : `⚠ Venta a ${gapLabel} del clic — NO es el mismo día`}
        </p>
      )}
    </div>
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
