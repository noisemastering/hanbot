// components/workflow/SandboxTester.js
//
// Chat-style sandbox that drives the router+node engine against an ephemeral
// conversation. Tests the SAVED workflow (unsaved graph edits won't apply until
// you Save). Shows per-turn diagnostics (transition, router reason, tools).
import React, { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import API from "../../api";
import SetupFields from "./SetupFields";

function newSessionId() {
  return `sbx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const SCENARIOS = [
  { value: "cold", label: "cold", hint: "Conversación nueva (primer contacto)." },
  { value: "returning", label: "returning", hint: "Cliente que regresa a una conversación previa." },
];

export default function SandboxTester({ workflowId, dirty, onCurrentNode }) {
  const [scenario, setScenario] = useState("cold");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [currentNode, setCurrentNode] = useState(null);
  const [setup, setSetup] = useState({});
  const [setupOpen, setSetupOpen] = useState(false);
  const sessionRef = useRef(newSessionId());
  const scrollRef = useRef(null);

  useEffect(() => {
    // New workflow selected → fresh conversation.
    sessionRef.current = newSessionId();
    setMessages([]);
    setCurrentNode(null);
  }, [workflowId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const reset = () => {
    sessionRef.current = newSessionId();
    setMessages([]);
    setCurrentNode(null);
    onCurrentNode?.(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!workflowId) return;
    if (!text && messages.length > 0) return;
    if (text) setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const res = await API.post(`/workflows/${workflowId}/sandbox`, {
        sessionId: sessionRef.current,
        message: text,
        scenario,
        setup,
        reset: messages.length === 0,
      });
      const data = res.data || {};
      setCurrentNode(data.currentNode || null);
      onCurrentNode?.(data.currentNode || null);
      if (data.reply) {
        setMessages((m) => [...m, { role: "assistant", text: data.reply, diag: data.diagnostics }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "system", text: "(sin respuesta — nodo silencioso o terminal)", diag: data.diagnostics },
        ]);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setMessages((m) => [...m, { role: "error", text: msg }]);
      if (/ANTHROPIC_API_KEY/i.test(msg)) toast.error("Falta ANTHROPIC_API_KEY en el servidor");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="min-w-[160px]">
          <label className="block text-xs text-gray-400 mb-1">Scenario</label>
          <select
            value={scenario}
            onChange={(e) => {
              setScenario(e.target.value);
              reset();
            }}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            {SCENARIOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button onClick={reset} className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white">
          Reiniciar
        </button>
        <button
          onClick={() => setSetupOpen((o) => !o)}
          className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
        >
          {setupOpen ? "▾ Setup (override)" : "▸ Setup (override)"}
        </button>
        <p className="text-xs text-amber-300/80 flex-1 min-w-[200px]">
          ⓘ {SCENARIOS.find((s) => s.value === scenario)?.hint}
          {dirty && <span className="text-amber-400"> · Tienes cambios sin guardar; el sandbox usa la versión guardada.</span>}
        </p>
      </div>

      {setupOpen && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 mb-3">
          <p className="text-[11px] text-gray-500 mb-2">
            Simula la asignación a un anuncio: estos valores sobreescriben los defaults del workflow para esta prueba.
            Cambiarlos reinicia la conversación.
          </p>
          <SetupFields
            value={setup}
            onChange={(s) => {
              setSetup(s);
              reset();
            }}
          />
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden flex flex-col" style={{ height: "55vh" }}>
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-800/40 flex items-center justify-between text-xs">
          <span className="text-gray-400">
            via <span className="text-gray-200">sandbox</span>
          </span>
          <span className="text-gray-400">
            nodo actual: <span className="text-emerald-300 font-medium">{currentNode?.name || "—"}</span>
          </span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-center text-gray-500 text-sm px-8">
              Escribe el primer mensaje del cliente (ej. "hola, precio de malla 4x5") para iniciar.
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <span className="animate-pulse">● ● ●</span> pensando…
            </div>
          )}
        </div>
        <div className="border-t border-gray-800 p-3 flex items-end gap-2">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!workflowId || sending}
            placeholder="Mensaje del cliente…"
            className="flex-1 resize-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!workflowId || sending}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const [open, setOpen] = useState(false);
  const { role, text, diag } = message;
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-primary-600 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }
  if (role === "error") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] bg-red-500/15 border border-red-500/40 text-red-300 rounded-lg px-3 py-2 text-xs">
          ⚠️ {text}
        </div>
      </div>
    );
  }
  const isSystem = role === "system";
  return (
    <div className="flex justify-start flex-col items-start">
      <div
        className={`max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm whitespace-pre-wrap ${
          isSystem ? "bg-gray-800 text-gray-400 italic" : "bg-gray-700 text-gray-100"
        }`}
      >
        {text}
      </div>
      {diag && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 ml-1 text-[11px] text-gray-500 hover:text-gray-300">
          {open ? "▾ ocultar diagnóstico" : "▸ diagnóstico"}
        </button>
      )}
      {open && diag && (
        <div className="mt-1 ml-1 max-w-[90%] bg-gray-950 border border-gray-800 rounded-lg p-2 text-[11px] text-gray-400 space-y-1">
          <div>
            transición: <span className="text-gray-200">{diag.fromNode?.name} → {diag.toNode?.name}</span>{" "}
            {diag.edgeId ? `(${diag.edgeId})` : "(stay)"}
            {diag.terminal ? " · terminal" : ""}
          </div>
          {diag.routerReason && <div>router: {diag.routerReason}</div>}
          {diag.toolCalls?.length > 0 && (
            <div>
              tools:{" "}
              {diag.toolCalls.map((tc, i) => (
                <span key={i} className="text-emerald-300">
                  {tc.name}
                  {i < diag.toolCalls.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
          {diag.handoffRequested && <div className="text-amber-300">↳ handoff solicitado</div>}
        </div>
      )}
    </div>
  );
}
