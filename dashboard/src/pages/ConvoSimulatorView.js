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
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import API from "../api";
import SandboxTester from "../components/workflow/SandboxTester";

function ConvoSimulatorView({ sandboxOnly = false }) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [workflow, setWorkflow] = useState(null);
  const [currentNode, setCurrentNode] = useState(null);
  const [nodePrompt, setNodePrompt] = useState("");
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [savingNode, setSavingNode] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [reloading, setReloading] = useState(false);

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

  // Load full workflow when selection changes.
  useEffect(() => {
    setCurrentNode(null);
    setNodePrompt("");
    loadWorkflow(selectedId).catch((err) =>
      toast.error(err.response?.data?.error || "No se pudo cargar el workflow")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
      const res = await API.patch(`/workflows/${selectedId}/prompts`, {
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
      const res = await API.patch(`/workflows/${selectedId}/prompts`, { globalPrompt });
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
      const wf = await loadWorkflow(selectedId);
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
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Simulador de conversación
          </h1>
          <p className="text-gray-400 text-xs mt-0.5">
            {sandboxOnly
              ? "Prueba el flujo conversando contra el motor. No afecta al bot en producción."
              : "Chatea contra el motor router+nodo y edita prompts en vivo. No afecta al bot en producción."}
          </p>
        </div>
        <div className="flex-1" />
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
        {!sandboxOnly && (
          <button
            onClick={reloadFlow}
            disabled={!selectedId || reloading}
            className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50"
            title="Re-lee el flujo desde la base de datos sin reiniciar la conversación"
          >
            {reloading ? "…" : "↻ Recargar flujo"}
          </button>
        )}
      </div>

      {!selectedId ? (
        <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
          {workflows.length ? "Selecciona un workflow para simular." : "No hay workflows. Crea uno en Playground → Workflows."}
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Chat */}
          <div className="flex-1 min-w-0">
            <SandboxTester
              workflowId={selectedId}
              dirty={false}
              onCurrentNode={setCurrentNode}
              familyIds={
                workflow?.families && workflow.families.length
                  ? workflow.families.filter((f) => f && f.id).map((f) => f.id)
                  : workflow?.family?.id
                  ? [workflow.family.id]
                  : []
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
