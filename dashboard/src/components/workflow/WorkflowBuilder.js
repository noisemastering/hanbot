// components/workflow/WorkflowBuilder.js
//
// Visual node+edge builder (React Flow / xyflow). Edits the draft workflow's
// nodes, edges and startNode. The parent owns Save (PUT). Source of truth while
// editing is the live React Flow state, serialized back into `draft` on change.
import React, { useEffect, useCallback, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import toast from "react-hot-toast";
import API from "../../api";

const NODE_CLIPBOARD_KEY = "wf_node_clipboard";

// Strip a node down to the flow-independent, reusable fields.
function reusableNode(n) {
  return {
    name: n.name || "Nodo",
    prompt: n.prompt || "",
    kind: n.kind || "llm",
    terminal: !!n.terminal,
    autoAction: n.autoAction || { type: null, text: "" },
    toolsAllowed: Array.isArray(n.toolsAllowed) ? n.toolsAllowed : [],
  };
}

const TOOL_KEYS = [
  "share_product_link",
  "share_store_link",
  "share_catalog",
  "request_handoff",
  "capture_lead",
  "ask_location",
  "note",
  "check_product_scope",
  "switch_flow",
];

// --- custom node renderer (compact card like the reference UI) ---
function WfNode({ id, data }) {
  const n = data.node || {};
  const selected = data.selectedId === id;
  return (
    <div
      className={`rounded-lg border px-3 py-2 w-56 text-left bg-gray-800 ${
        selected ? "border-primary-400 ring-1 ring-primary-400" : "border-gray-600"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white truncate">
          {n.isStart ? "▶ " : ""}
          {n.terminal ? "⏹ " : ""}
          {n.name || id}
        </span>
        {n.kind === "auto" && <span className="text-[9px] text-amber-300 uppercase">auto</span>}
      </div>
      {n.prompt && <div className="text-[10px] text-gray-400 mt-1 line-clamp-2">{n.prompt}</div>}
      {n.toolsAllowed?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {n.toolsAllowed.map((t) => (
            <span key={t} className="text-[8px] bg-gray-700 text-gray-300 rounded px-1">
              {t}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-primary-400" />
    </div>
  );
}

export default function WorkflowBuilder({ draft, setDraft, workflowKey }) {
  const nodeTypes = useMemo(() => ({ wf: WfNode }), []);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [selNodeId, setSelNodeId] = useState(null);
  const [selEdgeId, setSelEdgeId] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);

  // Seed from draft when the selected workflow changes.
  useEffect(() => {
    const nodes = (draft.nodes || []).map((n, i) => ({
      id: n.id,
      type: "wf",
      position: n.position && (n.position.x || n.position.y) ? n.position : { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 180 },
      data: { node: n, selectedId: null },
    }));
    const edges = (draft.edges || []).map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.condition || "",
      data: { condition: e.condition || "" },
      markerEnd: { type: MarkerType.ArrowClosed },
      labelStyle: { fontSize: 10, fill: "#cbd5e1" },
      labelBgStyle: { fill: "#0f172a" },
    }));
    setRfNodes(nodes);
    setRfEdges(edges);
    setSelNodeId(null);
    setSelEdgeId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey]);

  // Load the node-template library once on mount.
  useEffect(() => {
    API.get("/workflows/node-templates/all")
      .then((res) => setTemplates(res.data?.data || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Serialize live graph back into the draft (positions, new edges, edits).
  useEffect(() => {
    if (rfNodes.length === 0 && (draft.nodes || []).length === 0) return;
    const nodes = rfNodes.map((n) => ({ ...n.data.node, id: n.id, position: n.position }));
    const edges = rfEdges.map((e) => ({ id: e.id, from: e.source, to: e.target, condition: e.data?.condition || "" }));
    const startNode = nodes.find((n) => n.isStart)?.id || draft.startNode || nodes[0]?.id || null;
    setDraft((d) => ({ ...d, nodes, edges, startNode }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfNodes, rfEdges]);

  // Reflect selection highlight into node data.
  useEffect(() => {
    setRfNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, selectedId: selNodeId } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selNodeId]);

  const onConnect = useCallback(
    (params) =>
      setRfEdges((eds) =>
        addEdge(
          {
            ...params,
            id: `e_${Date.now()}`,
            label: "(define la condición)",
            data: { condition: "" },
            markerEnd: { type: MarkerType.ArrowClosed },
            labelStyle: { fontSize: 10, fill: "#cbd5e1" },
            labelBgStyle: { fill: "#0f172a" },
          },
          eds
        )
      ),
    [setRfEdges]
  );

  const updateNode = (id, patch) =>
    setRfNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n))
    );

  const makeStart = (id) =>
    setRfNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...n.data, node: { ...n.data.node, isStart: n.id === id } } }))
    );

  // Insert a node from reusable data (used by + Nodo, paste, and templates).
  // Always assigns a FRESH id + position (never start/edges from the source).
  const insertNodeFromData = (nodeData) => {
    const id = `n_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    const base = nodeData
      ? { ...reusableNode(nodeData), id, isStart: false }
      : { id, name: "Nuevo nodo", prompt: "", kind: "llm", toolsAllowed: [] };
    setRfNodes((ns) => [
      ...ns,
      {
        id,
        type: "wf",
        position: { x: 120 + Math.random() * 160, y: 120 + Math.random() * 160 },
        data: { node: base, selectedId: id },
      },
    ]);
    setSelNodeId(id);
    return id;
  };

  const addNode = () => insertNodeFromData(null);

  // ---- copy / paste (browser clipboard via localStorage) ----
  const copyNode = (node) => {
    try {
      localStorage.setItem(NODE_CLIPBOARD_KEY, JSON.stringify(reusableNode(node)));
      toast.success(`Nodo "${node.name}" copiado`);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  const pasteNode = () => {
    try {
      const raw = localStorage.getItem(NODE_CLIPBOARD_KEY);
      if (!raw) return toast.error("No hay nodo copiado");
      insertNodeFromData(JSON.parse(raw));
      toast.success("Nodo pegado");
    } catch {
      toast.error("Portapapeles inválido");
    }
  };

  // ---- persistent node library ----
  const loadTemplates = async () => {
    try {
      const res = await API.get("/workflows/node-templates/all");
      setTemplates(res.data?.data || []);
    } catch {
      /* non-fatal */
    }
  };
  const saveAsTemplate = async (node) => {
    const name = window.prompt("Nombre de la plantilla:", node.name || "Nodo");
    if (!name) return;
    try {
      await API.post("/workflows/node-templates", { ...reusableNode(node), name });
      toast.success("Plantilla guardada");
      loadTemplates();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar la plantilla");
    }
  };
  const deleteTemplate = async (tid) => {
    try {
      await API.delete(`/workflows/node-templates/${tid}`);
      loadTemplates();
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  const deleteNode = (id) => {
    setRfNodes((ns) => ns.filter((n) => n.id !== id));
    setRfEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelNodeId(null);
  };

  const updateEdge = (id, condition) =>
    setRfEdges((es) =>
      es.map((e) => (e.id === id ? { ...e, label: condition || "(define la condición)", data: { condition } } : e))
    );

  const deleteEdge = (id) => {
    setRfEdges((es) => es.filter((e) => e.id !== id));
    setSelEdgeId(null);
  };

  const selNode = rfNodes.find((n) => n.id === selNodeId)?.data.node || null;
  const selEdge = rfEdges.find((e) => e.id === selEdgeId) || null;

  return (
    <div className="flex gap-3" style={{ height: "62vh" }}>
      <div className="flex-1 border border-gray-700 rounded-xl overflow-hidden relative">
        <div className="absolute z-10 top-2 left-2 flex gap-1">
          <button
            onClick={addNode}
            className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 hover:bg-primary-500 text-white shadow"
          >
            + Nodo
          </button>
          <button
            onClick={pasteNode}
            className="px-2 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-white shadow"
            title="Pegar el nodo copiado"
          >
            Pegar
          </button>
          <button
            onClick={() => setTplOpen((o) => !o)}
            className="px-2 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-white shadow"
            title="Insertar un nodo de la biblioteca"
          >
            Plantillas ({templates.length})
          </button>
        </div>
        {tplOpen && (
          <div className="absolute z-20 top-12 left-2 w-64 max-h-72 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg p-2 shadow-xl">
            {templates.length === 0 ? (
              <p className="text-xs text-gray-500 p-1">Sin plantillas. Guarda un nodo desde su inspector.</p>
            ) : (
              templates.map((t) => (
                <div key={t._id} className="flex items-center justify-between gap-1 py-1 border-b border-gray-700/50 last:border-0">
                  <button
                    onClick={() => {
                      insertNodeFromData(t);
                      setTplOpen(false);
                      toast.success(`Plantilla "${t.name}" insertada`);
                    }}
                    className="flex-1 text-left text-xs text-gray-200 hover:text-white"
                    title={t.prompt?.slice(0, 120)}
                  >
                    {t.name} <span className="text-[10px] text-gray-500">{t.kind}</span>
                  </button>
                  <button onClick={() => deleteTemplate(t._id)} className="text-red-400 text-xs px-1" title="Eliminar plantilla">×</button>
                </div>
              ))
            )}
          </div>
        )}
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => {
            setSelNodeId(n.id);
            setSelEdgeId(null);
          }}
          onEdgeClick={(_, e) => {
            setSelEdgeId(e.id);
            setSelNodeId(null);
          }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#334155" gap={18} />
          <Controls className="!bg-gray-800 !border-gray-700" />
          <MiniMap pannable className="!bg-gray-900" nodeColor="#475569" maskColor="rgba(2,6,23,0.7)" />
        </ReactFlow>
      </div>

      {/* Inspector */}
      <div className="w-72 shrink-0 border border-gray-700 rounded-xl bg-gray-800/40 p-3 overflow-y-auto">
        {!selNode && !selEdge && (
          <p className="text-xs text-gray-500">
            Selecciona un nodo o una conexión para editarlo. Arrastra desde el punto inferior de un nodo al superior de
            otro para crear una transición.
          </p>
        )}

        {selNode && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-gray-400">Nodo</span>
              <div className="flex items-center gap-2">
                <button onClick={() => copyNode(selNode)} className="text-xs text-gray-300 hover:text-white" title="Copiar nodo (pegar en otro flujo)">copiar</button>
                <button onClick={() => saveAsTemplate(selNode)} className="text-xs text-primary-400 hover:text-primary-300" title="Guardar como plantilla reutilizable">plantilla</button>
                <button onClick={() => deleteNode(selNode.id)} className="text-xs text-red-400 hover:text-red-300">eliminar</button>
              </div>
            </div>
            <Field label="Nombre">
              <input
                value={selNode.name || ""}
                onChange={(e) => updateNode(selNode.id, { name: e.target.value })}
                className="wf-input"
              />
            </Field>
            <Field label="Tipo">
              <select
                value={selNode.kind || "llm"}
                onChange={(e) => updateNode(selNode.id, { kind: e.target.value })}
                className="wf-input"
              >
                <option value="llm">llm (genera respuesta)</option>
                <option value="auto">auto (sin LLM)</option>
              </select>
            </Field>
            {selNode.kind === "auto" ? (
              <>
                <Field label="Acción automática">
                  <select
                    value={selNode.autoAction?.type || "text"}
                    onChange={(e) =>
                      updateNode(selNode.id, { autoAction: { ...(selNode.autoAction || {}), type: e.target.value } })
                    }
                    className="wf-input"
                  >
                    <option value="text">enviar texto</option>
                    <option value="no_reply">no responder</option>
                    <option value="handoff">pasar a humano</option>
                  </select>
                </Field>
                <Field label="Texto (opcional)">
                  <textarea
                    rows={3}
                    value={selNode.autoAction?.text || ""}
                    onChange={(e) =>
                      updateNode(selNode.id, { autoAction: { ...(selNode.autoAction || {}), text: e.target.value } })
                    }
                    className="wf-input"
                  />
                </Field>
              </>
            ) : (
              <Field label="Prompt del nodo">
                <textarea
                  rows={6}
                  value={selNode.prompt || ""}
                  onChange={(e) => updateNode(selNode.id, { prompt: e.target.value })}
                  className="wf-input"
                  placeholder="Qué hace el bot en esta etapa…"
                />
              </Field>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={!!selNode.terminal}
                  onChange={(e) => updateNode(selNode.id, { terminal: e.target.checked })}
                />
                terminal
              </label>
              <button
                onClick={() => makeStart(selNode.id)}
                className={`text-xs px-2 py-1 rounded ${
                  selNode.isStart ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {selNode.isStart ? "● nodo inicial" : "marcar como inicio"}
              </button>
            </div>

            {selNode.kind !== "auto" && (
              <div>
                <span className="text-xs uppercase text-gray-400">Herramientas permitidas</span>
                <div className="mt-1 space-y-1">
                  {TOOL_KEYS.map((tk) => {
                    const on = (selNode.toolsAllowed || []).includes(tk);
                    return (
                      <label key={tk} className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const set = new Set(selNode.toolsAllowed || []);
                            e.target.checked ? set.add(tk) : set.delete(tk);
                            updateNode(selNode.id, { toolsAllowed: [...set] });
                          }}
                        />
                        {tk}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {selEdge && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-gray-400">Transición</span>
              <button onClick={() => deleteEdge(selEdge.id)} className="text-xs text-red-400 hover:text-red-300">
                eliminar
              </button>
            </div>
            <p className="text-xs text-gray-400">
              {selEdge.source} → {selEdge.target}
            </p>
            <Field label="Condición (lenguaje natural)">
              <textarea
                rows={4}
                value={selEdge.data?.condition || ""}
                onChange={(e) => updateEdge(selEdge.id, e.target.value)}
                className="wf-input"
                placeholder="Ej. El cliente aceptó y pidió el link."
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}
