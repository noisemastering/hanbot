// components/workflow/SetupFields.js
//
// Shared editor for the workflow setup vars. Used for workflow defaults
// (Config tab) and per-test overrides (Sandbox). Operates on a setup object via
// value/onChange. Product is picked from the family tree; promo from a list.
import React, { useState, useEffect } from "react";
import API from "../../api";

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Sel({ label, val, opts, onChange }) {
  return (
    <Labeled label={label}>
      <select className="wf-input" value={val || ""} onChange={(e) => onChange(e.target.value || null)}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

// Compact tree picker for a specific product/family (ProductFamily tree).
function ProductTreePicker({ productSpecific, onPick }) {
  const [tree, setTree] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [open, setOpen] = useState(false);
  const [selName, setSelName] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/product-families/tree");
        setTree(res.data?.data || []);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const renderNode = (node, depth) => {
    const kids = node.children || [];
    const isOpen = expanded[node._id];
    const selected = String(productSpecific?.id) === String(node._id);
    if (selected && selName !== node.name) setSelName(node.name);
    return (
      <div key={node._id}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
          {kids.length > 0 ? (
            <button type="button" onClick={() => toggle(node._id)} className="text-gray-400 w-4 text-xs">
              {isOpen ? "v" : ">"}
            </button>
          ) : (
            <span className="w-4 inline-block" />
          )}
          <button
            type="button"
            onClick={() => {
              // sellable leaf → 'product' realm; otherwise treat as 'family'
              const kind = node.sellable ? "product" : "family";
              onPick({ kind, id: node._id });
              setSelName(node.name);
              setOpen(false);
            }}
            className={"text-left text-xs px-1.5 py-0.5 rounded " + (selected ? "bg-primary-600 text-white" : "text-gray-200 hover:bg-gray-700")}
          >
            {node.name}
          </button>
        </div>
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="wf-input text-left">
          {productSpecific?.id ? selName || `(${productSpecific.kind}) seleccionado` : "— elegir del árbol —"}
        </button>
        {productSpecific?.id && (
          <button type="button" onClick={() => onPick({ kind: null, id: null })} className="text-red-400 text-xs">
            quitar
          </button>
        )}
      </div>
      {open && (
        <div className="border border-gray-700 rounded-lg p-2 mt-1 max-h-56 overflow-y-auto bg-gray-900">
          {tree.length === 0 ? (
            <p className="text-xs text-gray-500">Cargando árbol…</p>
          ) : (
            tree.map((r) => renderNode(r, 0))
          )}
        </div>
      )}
    </div>
  );
}

function PromoPicker({ value, onChange }) {
  const [promos, setPromos] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/promos");
        setPromos(res.data?.data || res.data || []);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);
  return (
    <select className="wf-input" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— sin promo —</option>
      {promos.map((p) => (
        <option key={p._id} value={p._id}>
          {p.name}
          {p.active === false ? " (inactiva)" : ""}
        </option>
      ))}
    </select>
  );
}

export default function SetupFields({ value = {}, onChange }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const setNested = (key, patch) => onChange({ ...v, [key]: { ...(v[key] || {}), ...patch } });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Sel label="buyer (cliente)" val={v.buyer} onChange={(x) => set({ buyer: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "end_user", label: "end_user (consumidor final)" }, { value: "reseller", label: "reseller (revendedor)" }]} />
      <Sel label="tono" val={v.tone} onChange={(x) => set({ tone: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "casual", label: "casual" }, { value: "professional", label: "professional" }, { value: "technical", label: "technical" }]} />
      <Sel label="purchase_type" val={v.purchaseType} onChange={(x) => set({ purchaseType: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "retail", label: "retail" }, { value: "wholesale", label: "wholesale" }]} />
      <Sel label="sale_channel" val={v.saleChannel} onChange={(x) => set({ saleChannel: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "marketplace", label: "marketplace" }, { value: "manual", label: "manual" }]} />
      <Labeled label="producto específico (del árbol)">
        <ProductTreePicker productSpecific={v.productSpecific} onPick={(p) => set({ productSpecific: p })} />
      </Labeled>
      <Labeled label="promo">
        <PromoPicker value={v.hasPromo} onChange={(x) => set({ hasPromo: x })} />
      </Labeled>
      <Sel label="catalog (tipo)" val={v.catalog?.kind} onChange={(x) => setNested("catalog", { kind: x })}
        opts={[{ value: "", label: "— (nil)" }, { value: "pdf", label: "pdf" }, { value: "store_link", label: "store_link" }]} />
      <Labeled label="catalog (valor / link)">
        <input className="wf-input" placeholder="URL del PDF o tienda" value={v.catalog?.value || ""} onChange={(e) => setNested("catalog", { value: e.target.value || null })} />
      </Labeled>
    </div>
  );
}
