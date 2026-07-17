// pages/BannerView.js
//
// Spec Ops · Banner global (super_admin). Muestra (o quita) un banner de aviso en
// TODO el dashboard, para todos los usuarios. El mensaje es editable; por defecto es
// el aviso de uso de OpenAI. Se enciende/apaga a voluntad.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";
import { useAuth } from "../contexts/AuthContext";

const DEFAULT_MSG =
  "El uso de OpenAI se está agotando, es necesario liberar el sistema para continuar operando";

export default function BannerView() {
  const { refreshBanner } = useAuth();
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await API.get("/spec-ops/status");
      setStatus(res.data);
      if (res.data?.banner?.message) setMessage(res.data.banner.message);
    } catch (e) {
      toast.error("No se pudo leer el estado");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const on = !!status?.banner?.engaged;

  const toggle = async (engage) => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/banner", { engage, message });
      setStatus(res.data);
      if (refreshBanner) refreshBanner();
      toast[engage ? "success" : "error"](
        engage ? "📣 Banner ACTIVADO en todo el dashboard" : "Banner desactivado"
      );
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo cambiar el banner");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Cargando…</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Banner global</h1>
      <p className="text-gray-400 mb-6">
        Muestra un <strong>banner de aviso</strong> en <strong>todo el dashboard</strong>, visible para
        todos los usuarios. Enciéndelo a voluntad; se puede editar el mensaje.
      </p>

      <label className="block text-sm text-gray-300 mb-2 font-semibold">Mensaje</label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="w-full rounded-lg bg-gray-800 border border-gray-600 text-white p-3 mb-2 focus:border-amber-500 outline-none"
        placeholder="Mensaje del banner…"
      />
      <button
        onClick={() => setMessage(DEFAULT_MSG)}
        className="text-xs text-gray-400 hover:text-gray-200 mb-6"
      >
        Restaurar mensaje por defecto
      </button>

      <div
        className={`rounded-2xl border p-8 text-center ${
          on ? "border-amber-500 bg-amber-950/30" : "border-gray-600 bg-gray-900/40"
        }`}
      >
        <div className="mb-4">
          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${on ? "text-amber-400" : "text-gray-400"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${on ? "bg-amber-500 animate-pulse" : "bg-gray-600"}`} />
            {on ? "BANNER ACTIVO — visible para todos" : "APAGADO"}
          </span>
          {on && status?.banner?.at && (
            <p className="text-xs text-gray-500 mt-1">
              Activado {new Date(status.banner.at).toLocaleString()} {status.banner.by ? `por ${status.banner.by}` : ""}
            </p>
          )}
        </div>

        {/* Live preview of the banner */}
        <div className="mb-6 rounded-lg bg-amber-500 text-black text-sm font-semibold py-2 px-4 text-center">
          {message || DEFAULT_MSG}
        </div>

        {!on ? (
          <button
            onClick={() => toggle(true)}
            disabled={busy || !message.trim()}
            className="px-8 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? "Activando…" : "Mostrar banner en todo el dashboard"}
          </button>
        ) : (
          <button
            onClick={() => toggle(false)}
            disabled={busy}
            className="px-8 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold disabled:opacity-50"
          >
            {busy ? "Quitando…" : "Quitar banner"}
          </button>
        )}
      </div>
    </div>
  );
}
