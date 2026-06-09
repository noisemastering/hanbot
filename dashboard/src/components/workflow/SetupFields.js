// components/workflow/SetupFields.js
//
// Editor for the workflow setup vars (Config-tab defaults + sandbox overrides).
// Operates on a setup object via value/onChange. `familyId` is the flow's
// mandatory family/subfamily: products and promos here are CONSTRAINED to that
// family's subtree. Products may be sellable measures OR sub-families, and
// MULTIPLE may be selected (unlike the flow-level family).
import React, { useState, useEffect, useMemo } from "react";
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

// Find a node by id anywhere in the tree.
function findNode(nodes, id) {
  for (const n of nodes || []) {
    if (String(n._id) === String(id)) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

// Collect all ids in a subtree (the node itself + descendants).
function subtreeIds(node, acc = new Set()) {
  if (!node) return acc;
  acc.add(String(node._id));
  for (const k of node.children || []) subtreeIds(k, acc);
  return acc;
}

// Multi-select picker over the flow's family subtrees (union of all flow
// families). Sellable leaves + sub-families both selectable.
function ProductsPicker({ familyIds, selected, onChange }) {
  const [tree, setTree] = useState([]);
  const [expanded, setExpanded] = useState({});
  const ids = Array.isArray(familyIds) ? familyIds.filter(Boolean) : familyIds ? [familyIds] : [];

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

  // Roots to render: the subtrees of EACH flow family (union). Each flow-family
  // node is shown as a labeled group so multiple same-named nodes (Rollo) differ.
  const roots = useMemo(() => {
    if (!ids.length) return tree;
    return ids.map((fid) => findNode(tree, fid)).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, JSON.stringify(ids)]);

  const sel = Array.isArray(selected) ? selected : [];
  const isOn = (id) => sel.some((p) => String(p.id) === String(id));
  const toggle = (node) => {
    const id = String(node._id);
    if (isOn(id)) {
      onChange(sel.filter((p) => String(p.id) !== id));
    } else {
      onChange([...sel, { kind: node.sellable ? "product" : "family", id, name: node.name }]);
    }
  };
  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const renderNode = (node, depth) => {
    const kids = node.children || [];
    const open = expanded[node._id] ?? depth < 1;
    return (
      <div key={node._id}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
          {kids.length > 0 ? (
            <button type="button" onClick={() => toggleExpand(node._id)} className="text-gray-400 w-4 text-xs">
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 inline-block" />
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-200 cursor-pointer">
            <input type="checkbox" checked={isOn(node._id)} onChange={() => toggle(node)} />
            {node.name}
            {node.sellable ? <span className="text-[10px] text-emerald-400">·medida</span> : <span className="text-[10px] text-gray-500">·grupo</span>}
          </label>
        </div>
        {open && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">
        {sel.length ? `${sel.length} seleccionado(s): ${sel.map((p) => p.name).filter(Boolean).join(", ")}` : "— ninguno —"}
        {sel.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-red-400 ml-2">
            limpiar
          </button>
        )}
      </div>
      <div className="border border-gray-700 rounded-lg p-2 max-h-56 overflow-y-auto bg-gray-900">
        {!ids.length ? (
          <p className="text-xs text-amber-400/80">Asigna primero una o más familias al flujo (pestaña Config).</p>
        ) : roots.length === 0 ? (
          <p className="text-xs text-gray-500">Las familias del flujo no tienen elementos.</p>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>
    </div>
  );
}

// Promo picker constrained to promos within the flow's family subtrees (union).
function PromoPicker({ familyIds, value, onChange }) {
  const [promos, setPromos] = useState([]);
  const [tree, setTree] = useState([]);
  const ids = Array.isArray(familyIds) ? familyIds.filter(Boolean) : familyIds ? [familyIds] : [];

  useEffect(() => {
    (async () => {
      try {
        const [p, t] = await Promise.all([API.get("/promos"), API.get("/product-families/tree")]);
        setPromos(p.data?.data || p.data || []);
        setTree(t.data?.data || []);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const familySet = useMemo(() => {
    if (!ids.length) return null;
    const set = new Set();
    ids.forEach((fid) => {
      const node = findNode(tree, fid);
      if (node) subtreeIds(node, set);
    });
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, JSON.stringify(ids)]);

  const eligible = useMemo(() => {
    if (!familySet) return promos; // no family → don't filter
    const promoIds = (pr) => {
      const ids = [];
      // Real Promo model: promoProductIds[] (ProductFamily refs, populated to
      // objects by the route) + promoPrices[].productId.
      (pr.promoProductIds || []).forEach((x) => ids.push(String(x?._id || x)));
      (pr.promoPrices || []).forEach((x) => x?.productId && ids.push(String(x.productId?._id || x.productId)));
      return ids;
    };
    return promos.filter((pr) => promoIds(pr).some((id) => familySet.has(id)));
  }, [promos, familySet]);

  return (
    <select className="wf-input" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— sin promo —</option>
      {eligible.map((p) => (
        <option key={p._id} value={p._id}>
          {p.name}
          {p.active === false ? " (inactiva)" : ""}
        </option>
      ))}
    </select>
  );
}

export default function SetupFields({ value = {}, onChange, familyIds = null }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
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
      <div className="col-span-2">
        <Labeled label="productos (medidas/grupos dentro de la familia del flujo — varios permitidos)">
          <ProductsPicker familyIds={familyIds} selected={v.products} onChange={(arr) => set({ products: arr })} />
        </Labeled>
      </div>
      <Labeled label="promo (dentro de la familia)">
        <PromoPicker familyIds={familyIds} value={v.hasPromo} onChange={(x) => set({ hasPromo: x })} />
      </Labeled>
      {/* Catalog and store link are NOT set per-ad (recipe for divergence).
          The store link comes from the company's available marketplaces, and
          the catalog from the product tree (climbing up to the general
          company catalog). Both resolve automatically at runtime. */}
    </div>
  );
}
