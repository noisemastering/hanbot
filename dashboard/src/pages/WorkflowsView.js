// pages/WorkflowsView.js
//
// Conversation Workflow studio (super_admin only). Tabs:
//   Workflow  → visual node/edge graph builder (React Flow)
//   Config    → name, description, active, global prompt, variables
//   Knowledge → reference snippets injected into the model context
//   Versions  → snapshots taken on each Save
//   Tester    → chat-style sandbox driving the router+node engine
//
// The bot currently in production is unaffected: workflows are opt-in and the
// engine runs alongside the legacy flow system.
import React, { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import API from "../api";
import WorkflowBuilder from "../components/workflow/WorkflowBuilder";
import SandboxTester from "../components/workflow/SandboxTester";
import SetupFields from "../components/workflow/SetupFields";

const TABS = [
  { id: "workflow", label: "Workflow" },
  { id: "config", label: "Config" },
  { id: "knowledge", label: "Knowledge" },
  { id: "versions", label: "Versions" },
  { id: "tester", label: "Tester" },
];

const CORE_KEYS = ["name", "description", "active", "globalPrompt", "variables", "knowledge", "nodes", "edges", "startNode", "setup", "family", "families"];

// Normalized array of the flow's family ids (families[] or legacy single family).
function familyIdsOf(draft) {
  if (!draft) return [];
  if (Array.isArray(draft.families) && draft.families.length) {
    return draft.families.filter((f) => f && f.id).map((f) => f.id);
  }
  return draft.family?.id ? [draft.family.id] : [];
}
const coreString = (d) => {
  const o = {};
  CORE_KEYS.forEach((k) => {
    o[k] = d?.[k];
  });
  return JSON.stringify(o);
};

function WorkflowsView() {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("workflow");
  const [loadNonce, setLoadNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const loadedRef = useRef("");

  const dirty = draft ? coreString(draft) !== loadedRef.current : false;

  const loadList = useCallback(async (selectFirst = false) => {
    try {
      const res = await API.get("/workflows");
      const list = res.data?.data || [];
      setWorkflows(list);
      if (selectFirst && !selectedId && list.length) setSelectedId(list[0]._id);
      return list;
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron cargar los workflows");
      return [];
    }
  }, [selectedId]);

  useEffect(() => {
    loadList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load full workflow when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    (async () => {
      try {
        const res = await API.get(`/workflows/${selectedId}`);
        const wf = res.data?.data;
        setDraft(wf);
        loadedRef.current = coreString(wf);
        setLoadNonce((n) => n + 1);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudo cargar el workflow");
      }
    })();
  }, [selectedId]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await API.put(`/workflows/${selectedId}`, draft);
      const wf = res.data?.data;
      setDraft(wf);
      loadedRef.current = coreString(wf);
      setLoadNonce((n) => n + 1);
      await loadList();
      toast.success("Workflow guardado (v" + wf.version + ")");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    const name = window.prompt("Nombre del nuevo workflow:");
    if (!name) return;
    try {
      const res = await API.post("/workflows", {
        name,
        active: false,
        globalPrompt: "Eres una asesora de ventas de Hanlob. Habla como persona real, español de México, breve y natural.",
        nodes: [{ id: "inicio", name: "Inicio", kind: "llm", isStart: true, prompt: "Saluda y pregunta en qué puedes ayudar.", toolsAllowed: ["note"], position: { x: 120, y: 120 } }],
        edges: [],
        startNode: "inicio",
      });
      await loadList();
      setSelectedId(res.data.data._id);
      toast.success("Workflow creado");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo crear");
    }
  };

  const duplicate = async () => {
    if (!selectedId) {
      toast.error("Selecciona un flujo para duplicar");
      return;
    }
    const name = window.prompt("Nombre del nuevo flujo (copia):", `${draft?.name || "Flujo"} (copia)`);
    if (!name) return;
    try {
      const res = await API.post(`/workflows/${selectedId}/duplicate`, { name });
      await loadList();
      setSelectedId(res.data.data._id);
      toast.success("Flujo duplicado (inactivo) — ajusta familia/producto y guarda");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo duplicar");
    }
  };

  const remove = async () => {
    if (!selectedId) return;
    const nm = draft?.name || "este flujo";
    if (!window.confirm(`¿Eliminar "${nm}"? Esta acción no se puede deshacer.`)) return;
    try {
      await API.delete(`/workflows/${selectedId}`);
      setSelectedId("");
      setDraft(null);
      await loadList();
      toast.success("Flujo eliminado");
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.ads?.length) {
        toast.error(`${data.error}\nAnuncios: ${data.ads.join(", ")}`, { duration: 7000 });
      } else {
        toast.error(data?.error || "No se pudo eliminar");
      }
    }
  };

  const doImport = async () => {
    try {
      const parsed = JSON.parse(importText);
      const res = await API.post("/workflows/import", parsed);
      setImportOpen(false);
      setImportText("");
      await loadList();
      setSelectedId(res.data.data._id);
      toast.success("Workflow importado");
    } catch (err) {
      toast.error(err.response?.data?.error || "JSON inválido o error al importar");
    }
  };

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Workflows
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">beta · super admin</span>
          </h1>
          <p className="text-gray-400 text-xs mt-0.5">Motor router+nodo (Claude), opt-in. El bot actual no se ve afectado.</p>
        </div>
        <div className="flex-1" />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm min-w-[220px]"
        >
          <option value="">— selecciona —</option>
          {workflows.map((w) => (
            <option key={w._id} value={w._id}>
              {w.name} {w.active ? "● activo" : "○ inactivo"}
            </option>
          ))}
        </select>
        <button onClick={createNew} className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white">+ Nuevo</button>
        <button onClick={duplicate} disabled={!selectedId} className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40">Duplicar</button>
        <button onClick={remove} disabled={!selectedId} className="px-3 py-2 text-sm rounded-lg bg-red-900/60 hover:bg-red-800 text-red-200 disabled:opacity-40">Eliminar</button>
        <button onClick={() => setImportOpen(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white">Importar JSON</button>
        <button
          onClick={save}
          disabled={!draft || saving || !dirty}
          className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium disabled:opacity-40"
        >
          {saving ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
        </button>
      </div>

      {!draft ? (
        <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
          {workflows.length ? "Selecciona un workflow para editarlo." : "No hay workflows. Crea uno o impórtalo."}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-700 mb-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm rounded-t-lg ${
                  tab === t.id ? "bg-gray-800 text-white border-b-2 border-primary-500" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {t.label}
                {t.id === "versions" && draft.versions?.length ? ` (${draft.versions.length})` : ""}
              </button>
            ))}
          </div>

          {tab === "workflow" && (
            <WorkflowBuilder draft={draft} setDraft={setDraft} workflowKey={`${selectedId}:${loadNonce}`} />
          )}

          {tab === "config" && (
            <div className="space-y-4 max-w-2xl">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={!!draft.active} onChange={(e) => patch({ active: e.target.checked })} />
                Activo
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={!!draft.isColdStart} onChange={(e) => patch({ isColdStart: e.target.checked })} />
                Flujo de arranque en frío (cold-start)
              </label>
              {draft.isColdStart && (
                <p className="text-[11px] text-amber-300/90 -mt-2 ml-6">
                  Este flujo atenderá TODAS las conversaciones que NO vengan de un anuncio (mensajes orgánicos). Solo un flujo puede tener esta marca; activarla aquí la quita de los demás. Debe estar también <b>Activo</b>.
                </p>
              )}
              <Labeled label="Nombre">
                <input className="wf-input" value={draft.name || ""} onChange={(e) => patch({ name: e.target.value })} />
              </Labeled>
              <Labeled label="Descripción">
                <input className="wf-input" value={draft.description || ""} onChange={(e) => patch({ description: e.target.value })} />
              </Labeled>
              <Labeled label="Familia / Subfamilia (global)">
                <FamilyPicker
                  value={draft.families && draft.families.length ? draft.families : draft.family?.id ? [draft.family] : []}
                  onChange={(arr) => patch({ families: arr, family: { id: null, name: null } })}
                />
                <span className="block text-[11px] text-gray-500 mt-1">
                  Realm de producto para todo el workflow (familia raíz o subfamilia). Es global, no por conversación.
                </span>
              </Labeled>
              <Labeled label="Global prompt (estilo + formato; siempre aplica)">
                <textarea className="wf-input" rows={8} value={draft.globalPrompt || ""} onChange={(e) => patch({ globalPrompt: e.target.value })} />
              </Labeled>

              <div className="border border-gray-700 rounded-lg p-3">
                <p className="text-xs uppercase text-gray-400 mb-2">Setup vars (defaults)</p>
                <p className="text-[11px] text-gray-500 mb-3">
                  Moldean el comportamiento. Cuando el workflow se asigna a un anuncio, el producto/promo/audiencia
                  del anuncio sobreescriben estos valores por conversación.
                </p>
                <SetupFields value={draft.setup} onChange={(s) => patch({ setup: s })} familyIds={familyIdsOf(draft)} />
              </div>

              <VariablesEditor draft={draft} patch={patch} />
            </div>
          )}

          {tab === "knowledge" && <KnowledgeEditor draft={draft} patch={patch} />}

          {tab === "versions" && (
            <div className="space-y-2 max-w-2xl">
              <p className="text-sm text-gray-400">Versión actual: <span className="text-white font-medium">v{draft.version}</span></p>
              {(draft.versions || []).length === 0 && <p className="text-xs text-gray-500">Aún no hay versiones anteriores.</p>}
              {(draft.versions || []).slice().reverse().map((v) => (
                <div key={v.version} className="border border-gray-700 rounded-lg p-3 text-sm flex items-center justify-between">
                  <span className="text-gray-200">v{v.version}</span>
                  <span className="text-xs text-gray-500">
                    {v.savedBy || "—"} · {v.savedAt ? new Date(v.savedAt).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === "tester" && <SandboxTester workflowId={selectedId} dirty={dirty} familyIds={familyIdsOf(draft)} />}
        </>
      )}

      {/* Import modal */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 w-full max-w-2xl">
            <h3 className="text-white font-semibold mb-2">Importar workflow (JSON)</h3>
            <textarea
              className="wf-input font-mono"
              rows={12}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{ "name": "...", "nodes": [...], "edges": [...] }'
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setImportOpen(false)} className="px-3 py-2 text-sm rounded-lg bg-gray-700 text-white">Cancelar</button>
              <button onClick={doImport} className="px-3 py-2 text-sm rounded-lg bg-primary-600 text-white">Importar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

// Global family/subfamily picker - expandable tree (from /product-families/tree).
// MULTI-select: tick one or more families/subfamilies (e.g. Rollo under each
// shade %). Sellable products are not eligible as a flow family. `value` is an
// array [{id, name}]; onChange receives the updated array.
function FamilyPicker({ value, onChange }) {
  const [tree, setTree] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);

  const selected = Array.isArray(value) ? value : value && value.id ? [value] : [];
  const isOn = (id) => selected.some((f) => String(f.id) === String(id));

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/product-families/tree");
        const data = res.data?.data || [];
        setTree(data);
        // expand paths to every currently-selected family
        let exp = {};
        selected.forEach((f) => {
          exp = { ...exp, ...(pathToNode(data, f.id) || {}) };
        });
        setExpanded(exp);
      } catch {
        /* non-fatal */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  // Build "Root > Sub > Leaf" label so multiple same-named nodes (Rollo) differ.
  const labelFor = (node, ancestry) => [...ancestry, node.name].join(" > ");

  const toggleSelect = (node, ancestry) => {
    const id = String(node._id);
    if (isOn(id)) {
      onChange(selected.filter((f) => String(f.id) !== id));
    } else {
      onChange([...selected, { id, name: labelFor(node, ancestry) }]);
    }
  };

  const renderNode = (node, depth, ancestry) => {
    const kids = node.children || [];
    const open = expanded[node._id];
    return (
      <div key={node._id}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
          {kids.length > 0 ? (
            <button type="button" onClick={() => toggleExpand(node._id)} className="text-gray-400 w-4 text-xs">
              {open ? "v" : ">"}
            </button>
          ) : (
            <span className="w-4 inline-block" />
          )}
          {node.sellable ? (
            <span className="text-sm px-1.5 py-0.5 text-gray-600 cursor-not-allowed" title="Un producto vendible no puede ser la familia del flujo; elige una familia o subfamilia">
              {node.name} <span className="text-[10px]">(producto)</span>
            </span>
          ) : (
            <label className="flex items-center gap-1.5 text-sm text-gray-200 cursor-pointer">
              <input type="checkbox" checked={isOn(node._id)} onChange={() => toggleSelect(node, ancestry)} />
              {node.name}
            </label>
          )}
        </div>
        {open && kids.map((k) => renderNode(k, depth + 1, [...ancestry, node.name]))}
      </div>
    );
  };

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">
        {selected.length ? (
          <>
            Seleccionadas ({selected.length}):{" "}
            <span className="text-emerald-300">{selected.map((f) => f.name).join("  ·  ")}</span>
            <button type="button" onClick={() => onChange([])} className="text-red-400 ml-2">
              limpiar
            </button>
          </>
        ) : (
          <span className="text-amber-400/80">Ninguna — selecciona al menos una familia/subfamilia.</span>
        )}
      </div>
      <div className="border border-gray-700 rounded-lg p-2 max-h-64 overflow-y-auto bg-gray-900">
        {loading ? (
          <p className="text-xs text-gray-500">Cargando arbol...</p>
        ) : tree.length === 0 ? (
          <p className="text-xs text-gray-500">Sin familias.</p>
        ) : (
          tree.map((r) => renderNode(r, 0, []))
        )}
      </div>
    </div>
  );
}

// Build an {id: true} expansion map for every ancestor of the target node.
function pathToNode(nodes, targetId, acc = {}) {
  for (const n of nodes) {
    if (String(n._id) === String(targetId)) return acc;
    const kids = n.children || [];
    if (kids.length) {
      const found = pathToNode(kids, targetId, { ...acc, [n._id]: true });
      if (found) return found;
    }
  }
  return null;
}
function VariablesEditor({ draft, patch }) {
  const vars = draft.variables || [];
  const update = (i, field, val) => patch({ variables: vars.map((v, j) => (j === i ? { ...v, [field]: val } : v)) });
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Variables ([key] en los prompts)</span>
        <button onClick={() => patch({ variables: [...vars, { key: "", description: "" }] })} className="text-xs text-primary-400">+ agregar</button>
      </div>
      {vars.map((v, i) => (
        <div key={i} className="flex gap-2 mb-1">
          <input className="wf-input" placeholder="key" value={v.key || ""} onChange={(e) => update(i, "key", e.target.value)} />
          <input className="wf-input" placeholder="descripción" value={v.description || ""} onChange={(e) => update(i, "description", e.target.value)} />
          <button onClick={() => patch({ variables: vars.filter((_, j) => j !== i) })} className="text-red-400 text-xs px-2">×</button>
        </div>
      ))}
    </div>
  );
}

function KnowledgeEditor({ draft, patch }) {
  const kb = draft.knowledge || [];
  const update = (i, field, val) => patch({ knowledge: kb.map((k, j) => (j === i ? { ...k, [field]: val } : k)) });
  return (
    <div className="space-y-3 max-w-2xl">
      <button onClick={() => patch({ knowledge: [...kb, { title: "", content: "" }] })} className="text-sm text-primary-400">+ agregar nota</button>
      {kb.length === 0 && <p className="text-xs text-gray-500">Sin notas de conocimiento.</p>}
      {kb.map((k, i) => (
        <div key={i} className="border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input className="wf-input" placeholder="Título" value={k.title || ""} onChange={(e) => update(i, "title", e.target.value)} />
            <button onClick={() => patch({ knowledge: kb.filter((_, j) => j !== i) })} className="text-red-400 text-xs px-2">eliminar</button>
          </div>
          <textarea className="wf-input" rows={3} placeholder="Contenido" value={k.content || ""} onChange={(e) => update(i, "content", e.target.value)} />
        </div>
      ))}
    </div>
  );
}

export default WorkflowsView;
