// components/ConversationTranscript.js
//
// Body-only transcript for a conversation (no modal chrome), so it can live inside
// the shared Match/Chat modal. Fetches GET /conversations/:psid (bare array of
// Message docs, newest-first) and renders them oldest-first.
import React, { useEffect, useState } from "react";
import API from "../api";

export default function ConversationTranscript({ psid }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setError(null);
    API.get(`/conversations/${psid}`)
      .then((r) => {
        if (!alive) return;
        const arr = Array.isArray(r.data) ? r.data : r.data?.messages || [];
        setMessages([...arr].reverse());
      })
      .catch((e) => alive && setError(e.response?.data?.error || "No se pudo cargar la conversación"));
    return () => { alive = false; };
  }, [psid]);

  const fmt = (t) => (t ? new Date(t).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <div className="overflow-y-auto space-y-2" style={{ maxHeight: "60vh" }}>
      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : messages == null ? (
        <p className="text-gray-500 text-sm">Cargando…</p>
      ) : messages.length === 0 ? (
        <p className="text-gray-500 text-sm">Sin mensajes.</p>
      ) : (
        messages.map((m, i) => {
          const isUser = m.senderType === "user";
          return (
            <div key={m.messageId || i} className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${isUser ? "bg-gray-700 text-gray-100" : m.senderType === "human" ? "bg-amber-700/70 text-white" : "bg-blue-600/80 text-white"}`}>
                <div className="text-[10px] opacity-70 mb-0.5">
                  {isUser ? "Cliente" : m.senderType === "human" ? "Asesor" : "Bot"} · {fmt(m.timestamp || m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.text || "—"}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
