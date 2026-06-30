// pages/LiberadoView.js
//
// Spec Ops · Liberado (super_admin). Release gate. While OFF (red, default), the
// gated features (flow creation, flow attachment to ads, user creation) are
// super_admin-only and the bot is capped at 50 conversations/day. Flip ON (green)
// to release everything to everyone per normal permissions.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";

export default function LiberadoView() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await API.get("/spec-ops/status");
      setStatus(res.data);
    } catch (e) {
      toast.error("No se pudo leer el estado");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const released = !!status?.liberado?.engaged;

  const toggle = async (engage) => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/liberado", { engage });
      setStatus(res.data);
      setConfirming(false);
      toast[engage ? "success" : "error"](
        engage ? "🚀 Liberado ACTIVADO — funciones disponibles para todos, sin tope diario" : "Liberado desactivado — funciones solo Super Admin, tope de 50/día"
      );
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo cambiar Liberado");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Cargando…</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Liberado</h1>
      <p className="text-gray-400 mb-6">
        Interruptor de <strong>liberación</strong>. Mientras está <strong>apagado</strong>, estas funciones quedan
        disponibles <strong>solo para Super Admin</strong> y el bot atiende un máximo de <strong>50 conversaciones por día</strong>:
        creación de flujos, asignación de flujos a anuncios, y creación de usuarios. Al <strong>liberar</strong>, todo
        queda disponible para todos según sus permisos normales y se quita el tope diario.
      </p>

      <div
        className={`rounded-2xl border p-8 text-center ${
          released ? "border-emerald-500 bg-emerald-950/30" : "border-red-500 bg-red-950/30"
        }`}
      >
        <div className="mb-4">
          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${released ? "text-emerald-400" : "text-red-400"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${released ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`} />
            {released ? "LIBERADO" : "APAGADO — RESTRINGIDO (solo Super Admin · tope 50/día)"}
          </span>
          {released && status?.liberado?.at && (
            <p className="text-xs text-gray-500 mt-1">
              Liberado {new Date(status.liberado.at).toLocaleString()} {status.liberado.by ? `por ${status.liberado.by}` : ""}
            </p>
          )}
        </div>

        {!released ? (
          !confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="w-56 h-56 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-extrabold shadow-[0_0_40px_rgba(16,185,129,0.45)] transition-all active:scale-95"
            >
              LIBERAR
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-amber-200 font-semibold">¿Liberar las funciones para todos y quitar el tope de 50/día?</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setConfirming(false)} className="px-5 py-2.5 rounded-lg bg-gray-700 text-white">Cancelar</button>
                <button onClick={() => toggle(true)} disabled={busy} className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
                  {busy ? "Liberando…" : "Sí, LIBERAR"}
                </button>
              </div>
            </div>
          )
        ) : (
          <button onClick={() => toggle(false)} disabled={busy} className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50">
            {busy ? "Restringiendo…" : "Volver a restringir (apagar)"}
          </button>
        )}
      </div>
    </div>
  );
}
