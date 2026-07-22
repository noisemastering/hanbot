// pages/FbCommentReplyView.js
//
// Spec Ops · Facebook comment auto-reply (super_admin). When ON, the bot publicly
// replies to comments on the page's posts/ads (via the feed webhook), inviting the
// person to DM. Default OFF.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";

export default function FbCommentReplyView() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const on = !!status?.fbCommentReply?.engaged;

  const toggle = async (engage) => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/fb-comment-reply", { engage });
      setStatus(res.data);
      toast[engage ? "success" : "error"](
        engage ? "💬 Respuestas a comentarios de Facebook ACTIVADAS" : "Respuestas a comentarios desactivadas"
      );
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo cambiar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Cargando…</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Respuestas a comentarios (Facebook)</h1>
      <p className="text-gray-400 mb-6">
        Cuando está <strong>encendido</strong>, el bot responde públicamente a los comentarios en
        las publicaciones y anuncios de la página, invitando a la persona a mandar mensaje. El
        webhook de comentarios ya está conectado; esto solo enciende o apaga las respuestas.
      </p>

      <div
        className={`rounded-2xl border p-8 text-center ${
          on ? "border-emerald-500 bg-emerald-950/30" : "border-gray-600 bg-gray-900/40"
        }`}
      >
        <div className="mb-4">
          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${on ? "text-emerald-400" : "text-gray-400"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${on ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
            {on ? "ACTIVAS — el bot responde comentarios" : "APAGADAS"}
          </span>
          {on && status?.fbCommentReply?.at && (
            <p className="text-xs text-gray-500 mt-1">
              Activadas {new Date(status.fbCommentReply.at).toLocaleString()} {status.fbCommentReply.by ? `por ${status.fbCommentReply.by}` : ""}
            </p>
          )}
        </div>

        {!on ? (
          <button
            onClick={() => toggle(true)}
            disabled={busy}
            className="w-56 h-56 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xl font-extrabold shadow-[0_0_40px_rgba(16,185,129,0.45)] transition-all active:scale-95 disabled:opacity-50"
          >
            {busy ? "Activando…" : "ACTIVAR RESPUESTAS"}
          </button>
        ) : (
          <button
            onClick={() => toggle(false)}
            disabled={busy}
            className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50"
          >
            {busy ? "Apagando…" : "Apagar respuestas a comentarios"}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-4">
        Nota: si la primera respuesta falla con un error de permisos, el token de la página necesita
        <code className="mx-1 text-gray-400">pages_manage_engagement</code> (se agrega en la App de Meta).
      </p>
    </div>
  );
}
