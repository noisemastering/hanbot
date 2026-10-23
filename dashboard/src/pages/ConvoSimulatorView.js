// pages/ConvoSimulatorView.js
//
// Conversation simulator with live editing (super_admin, /playground/simulador).
// Chat against the router+node engine on the left; on the right: the active-node
// indicator, an editor for the current node's prompt, and the global prompt.
// Saved edits apply on the NEXT message — the engine re-reads the flow each turn,
// so you can tweak prompts and keep talking without losing the conversation.
//
// `sandboxOnly` renders JUST the chat tester (no prompt editor) — used by the
// Bot-menu sandbox so admins/campaign managers can test flows without touching
// prompts.
//
// TWO WAYS IN, same engine:
//   "por anuncio" — pick the ad; its attached flow + config (ad.workflowSetup)
//                   are pulled and locked, which is what production seeds an
//                   ad-routed conversation with. Nothing to assemble by hand.
//   "por flujo"   — the original path: pick the flow, optionally override the
//                   setup yourself. Unchanged, and still the only way to test a
//                   flow that no ad points at yet.
// The Bot sandbox opens on "por anuncio" (testers think in ads); the super_admin
// playground opens on "por flujo", since its prompt editor is flow-centric.
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import API from "../api";
import SandboxTester from "../components/workflow/SandboxTester";
import AdSandboxPicker from "../components/workflow/AdSandboxPicker";
import { useAuth } from "../contexts/AuthContext";

// After this many conversations tested in the Bot sandbox, we surface a
// permanent token-usage warning (the engine runs several LLM calls per turn).
const SANDBOX_CONVO_LIMIT = 5;

function ConvoSimulatorView({ sandboxOnly = false }) {
  const [mode, setMode] = useState(sandboxOnly ? "ad" : "flow");
  const [adId, setAdId] = useState("");
  const [adConfig, setAdConfig] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [workflow, setWorkflow] = useState(null);
  const [currentNode, setCurrentNode] = useState(null);
  const [nodePrompt, setNodePrompt] = useState("");
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [savingNode, setSavingNode] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [reloading, setReloading] = useState(false);

  // Token-usage nudge (Bot sandbox only). Count is kept per-user in localStorage
  // so it survives reloads; once the warning fires it is permanent — it never
  // disappears for that user, even after refreshing or hitting the limit again.
  const { user } = useAuth();
  const userKey = user?.id || user?._id || user?.username || "anon";
  const warnKey = `sandboxTokenWarned:${userKey}`;
  const countKey = `sandboxConvoCount:${userKey}`;
  const [tokenWarned, setTokenWarned] = useState(() => {
    try {
      return localStorage.getItem(warnKey) === "1";
    } catch {
      return false;
    }
  });

  // Called by SandboxTester after every send that reaches the engine. Only the
  // FIRST message of a session counts as a new conversation.
  const handleSandboxSent = ({ isNewConvo } = {}) => {
    if (!sandboxOnly || !isNewConvo) return;
    try {
      const n = (parseInt(localStorage.getItem(countKey) || "0", 10) || 0) + 1;
      localStorage.setItem(countKey, String(n));
      if (n >= SANDBOX_CONVO_LIMIT) {
        localStorage.setItem(warnKey, "1");
        setTokenWarned(true);
      }
    } catch {
      /* localStorage unavailable — skip the nudge silently */
    }
  };

  // In ad mode the ad decides the flow; in flow mode the picker does. Everything
  // downstream (chat, prompt editor, report) reads these two, so neither mode
  // needs its own copy of the tester.
  const adMode = mode === "ad";
  const activeWorkflowId = adMode ? adConfig?.workflow?.id || "" : selectedId;
  const activeWorkflowName = adMode
    ? adConfig?.workflow?.name || ""
    : workflow?.name || "";
  const adLabel = adMode && adConfig ? `${adConfig.ad.name} [${adConfig.ad.fbAdId}]` : "";

  // Load the workflow list once.
  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/workflows");
        const list = res.data?.data || [];
        setWorkflows(list);
        if (list.length) setSelectedId((p) => p || list[0]._id);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudieron cargar los workflows");
      }
    })();
  }, []);

  const loadWorkflow = async (id) => {
    if (!id) {
      setWorkflow(null);
      return null;
    }
    const res = await API.get(`/workflows/${id}`);
    const wf = res.data?.data;
    setWorkflow(wf);
    setGlobalPrompt(wf?.globalPrompt || "");
    return wf;
  };

  // Load full workflow when the driving flow changes — in ad mode that is the
  // flow the ad points at, so the prompt editor still edits the right one.
  useEffect(() => {
    setCurrentNode(null);
    setNodePrompt("");
    loadWorkflow(activeWorkflowId).catch((err) =>
      toast.error(err.response?.data?.error || "No se pudo cargar el workflow")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowId]);

  // Sync the node-prompt editor to the active node.
  useEffect(() => {
    if (!workflow || !currentNode) {
      setNodePrompt("");
      return;
    }
    const n = workflow.nodes?.find((x) => x.id === currentNode.id);
    setNodePrompt(n?.prompt || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode?.id, workflow?._id]);

  const saveNodePrompt = async () => {
    if (!currentNode) return;
    setSavingNode(true);
    try {
      const res = await API.patch(`/workflows/${activeWorkflowId}/prompts`, {
        node: { id: currentNode.id, prompt: nodePrompt },
      });
      setWorkflow(res.data?.data);
      toast.success("Prompt del nodo guardado · aplica en el próximo mensaje");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setSavingNode(false);
    }
  };

  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      const res = await API.patch(`/workflows/${activeWorkflowId}/prompts`, { globalPrompt });
      setWorkflow(res.data?.data);
      toast.success("Prompt global guardado · aplica en el próximo mensaje");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setSavingGlobal(false);
    }
  };

  // Re-read the flow into the editor WITHOUT resetting the conversation.
  const reloadFlow = async () => {
    setReloading(true);
    try {
      const wf = await loadWorkflow(activeWorkflowId);
      if (wf && currentNode) {
        const n = wf.nodes?.find((x) => x.id === currentNode.id);
        setNodePrompt(n?.prompt || "");
      }
      toast.success("Flujo recargado (la conversación se conserva)");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo recargar");
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {sandboxOnly && tokenWarned && (
        <div
          role="alert"
          className="sticky top-0 z-20 mb-4 flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/15 px-4 py-3 text-amber-200"
        >
          <span className="text-lg leading-none">⚠️</span>
          <p className="text-sm">
            El uso excesivo del simulador puede generar un consumo elevado de tokens en el motor de IA.
            Te recomendamos utilizarlo únicamente para pruebas específicas y puntuales.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Sandbox
          </h1>
          <p className="text-gray-400 text-xs mt-0.5">
            {sandboxOnly
              ? "Prueba el flujo conversando contra el motor. No afecta al bot en producción."
              : "Chatea contra el motor router+nodo y edita prompts en vivo. No afecta al bot en producción."}
          </p>
        </div>
        <div className="flex-1" />
        <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
          {[
            { k: "ad", label: "Por anuncio", hint: "Carga el flujo y la configuración ya asignados al anuncio" },
            { k: "flow", label: "Por flujo", hint: "Elige el flujo y, si quieres, arma la configuración a mano" },
          ].map((m) => (
            <button
              key={m.k}
              onClick={() => setMode(m.k)}
              title={m.hint}
              className={`px-3 py-2 text-sm ${
                mode === m.k ? "bg-primary-600 text-white font-semibold" : "bg-gray-900 text-gray-400 hover:text-gray-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {!adMode && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm min-w-[240px]"
          >
            <option value="">— selecciona un workflow —</option>
            {workflows.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name} {w.active ? "● activo" : "○ inactivo"}
              </option>
            ))}
          </select>
        )}
        {!sandboxOnly && (
          <button
            onClick={reloadFlow}
            disabled={!activeWorkflowId || reloading}
            className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50"
            title="Re-lee el flujo desde la base de datos sin reiniciar la conversación"
          >
            {reloading ? "…" : "↻ Recargar flujo"}
          </button>
        )}
      </div>

      {adMode && (
        <div className="border border-gray-700 rounded-xl p-3 bg-gray-800/40 mb-4">
          <AdSandboxPicker value={adId} onChange={setAdId} onConfig={setAdConfig} />
        </div>
      )}

      {!activeWorkflowId ? (
        <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
          {adMode
            ? "Selecciona un anuncio para simularlo."
            : workflows.length
            ? "Selecciona un workflow para simular."
            : "No hay workflows. Crea uno en Playground → Workflows."}
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Chat */}
          <div className="flex-1 min-w-0">
            <SandboxTester
              workflowId={activeWorkflowId}
              workflowName={activeWorkflowName}
              dirty={false}
              onCurrentNode={setCurrentNode}
              onSent={handleSandboxSent}
              setupOverride={adMode ? adConfig?.setup || {} : null}
              lockSetup={adMode}
              adLabel={adLabel}
              resetKey={adMode ? adId : ""}
              familyIds={
                workflow?.families && workflow.families.length
                  ? workflow.families.filter((f) => f && f.id).map((f) => f.id)
                  : workflow?.family?.id
                  ? [workflow.family.id]
                  : adConfig?.familyIds || []
              }
            />
          </div>

          {/* Live editor */}
          {!sandboxOnly && (
          <div className="w-full lg:w-96 shrink-0 space-y-4">
            {/* Current node indicator */}
            <div className="border border-gray-700 rounded-xl p-3 bg-gray-800/40">
              <p className="text-[11px] uppercase text-gray-400">Nodo actual</p>
              <p className="text-lg font-semibold text-emerald-300">{currentNode?.name || "—"}</p>
              {currentNode?.id && <p className="text-[11px] text-gray-500">id: {currentNode.id}</p>}
            </div>

            {/* Node prompt editor */}
            <div className="border border-gray-700 rounded-xl p-3 bg-gray-800/40">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase text-gray-400">Prompt del nodo actual</p>
                <button
                  onClick={saveNodePrompt}
                  disabled={!currentNode || savingNode}
                  className="text-xs px-2 py-1 rounded bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-40"
                >
                  {savingNode ? "…" : "Guardar"}
                </button>
              </div>
              {currentNode ? (
                <textarea
                  className="wf-input"
                  rows={8}
                  value={nodePrompt}
                  onChange={(e) => setNodePrompt(e.target.value)}
                  placeholder="Qué hace el bot en esta etapa…"
                />
              ) : (
                <p className="text-[11px] text-gray-500">
                  Envía un mensaje para entrar a un nodo y poder editar su prompt.
                </p>
              )}
            </div>

            {/* Global prompt editor */}
            <div className="border border-gray-700 rounded-xl p-3 bg-gray-800/40">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase text-gray-400">Prompt global</p>
                <button
                  onClick={saveGlobal}
                  disabled={savingGlobal}
                  className="text-xs px-2 py-1 rounded bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-40"
                >
                  {savingGlobal ? "…" : "Guardar"}
                </button>
              </div>
              <textarea
                className="wf-input"
                rows={8}
                value={globalPrompt}
                onChange={(e) => setGlobalPrompt(e.target.value)}
                placeholder="Estilo + formato; siempre aplica."
              />
            </div>

            <p className="text-[11px] text-gray-500">
              Los cambios guardados aquí se aplican en el siguiente mensaje, sin reiniciar la conversación.
            </p>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ConvoSimulatorView;
