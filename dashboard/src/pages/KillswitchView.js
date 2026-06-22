// pages/KillswitchView.js
//
// Spec Ops · Killswitch (super_admin). One big red button that stops the bot on
// every channel and shows a maintenance modal to everyone below super_admin.
// Engaging requires an explicit confirmation.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";

export default function KillswitchView() {
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

  const engaged = !!status?.killswitch?.engaged;

  const toggle = async (engage) => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/killswitch", { engage });
      setStatus(res.data);
      setConfirming(false);
      toast[engage ? "error" : "success"](engage ? "🛑 Killswitch ACTIVADO — el bot está detenido" : "Killswitch desactivado — el bot opera normal");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo cambiar el killswitch");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Cargando…</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Killswitch</h1>
      <p className="text-gray-400 mb-6">
        Detiene el procesamiento del bot en <strong>todos los canales</strong> (Facebook y WhatsApp) y muestra un aviso
        de mantenimiento a todos los usuarios por debajo de super admin. El tablero sigue disponible para super admin.
      </p>

      <div
        className={`rounded-2xl border p-8 text-center ${
          engaged ? "border-red-500 bg-red-950/30" : "border-gray-700 bg-gray-800/40"
        }`}
      >
        <div className="mb-4">
          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${engaged ? "text-red-400" : "text-emerald-400"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${engaged ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`} />
            {engaged ? "DETENIDO" : "OPERANDO NORMAL"}
          </span>
          {engaged && status?.killswitch?.at && (
            <p className="text-xs text-gray-500 mt-1">
              Activado {new Date(status.killswitch.at).toLocaleString()} {status.killswitch.by ? `por ${status.killswitch.by}` : ""}
            </p>
          )}
        </div>

        {!engaged ? (
          !confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="w-56 h-56 rounded-full bg-red-600 hover:bg-red-500 text-white text-2xl font-extrabold shadow-[0_0_40px_rgba(239,68,68,0.5)] transition-all active:scale-95"
            >
              DETENER<br />TODO
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-amber-200 font-semibold">¿Seguro que quieres DETENER el bot para todos los clientes?</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setConfirming(false)} className="px-5 py-2.5 rounded-lg bg-gray-700 text-white">Cancelar</button>
                <button onClick={() => toggle(true)} disabled={busy} className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50">
                  {busy ? "Activando…" : "Sí, DETENER TODO"}
                </button>
              </div>
            </div>
          )
        ) : (
          <button onClick={() => toggle(false)} disabled={busy} className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
            {busy ? "Reanudando…" : "Reanudar el bot"}
          </button>
        )}
      </div>
    </div>
  );
}
