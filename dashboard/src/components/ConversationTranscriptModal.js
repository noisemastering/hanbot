// components/ConversationTranscriptModal.js
//
// Lightweight read-only viewer for a conversation's full transcript, opened from
// the conversions table ("Ver conversación"). Fetches GET /conversations/:psid
// (a bare array of Message docs, newest-first) and renders them oldest-first.
import React, { useEffect, useState } from "react";
import API from "../api";

export default function ConversationTranscriptModal({ psid, onClose }) {
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
        setMessages([...arr].reverse()); // endpoint returns newest-first
      })
      .catch((e) => alive && setError(e.response?.data?.error || "No se pudo cargar la conversación"));
    return () => { alive = false; };
  }, [psid]);

  const fmt = (t) => (t ? new Date(t).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col border border-gray-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="text-sm text-white">Conversación · <span className="font-mono text-gray-400">{String(psid).slice(0, 16)}…</span></span>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : messages == null ? (
            <p className="text-gray-500 text-sm">Cargando…</p>
          ) : messages.length === 0 ? (
            <p className="text-gray-500 text-sm">Sin mensajes.</p>
          ) : (
            messages.map((m, i) => {
              const who = m.senderType === "user" ? "user" : "bot";
              const isUser = who === "user";
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
      </div>
    </div>
  );
}
