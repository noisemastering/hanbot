// components/workflow/SetupFields.js
//
// Shared editor for the six workflow setup vars. Used for workflow defaults
// (Config tab) and per-test overrides (Sandbox). Operates on a setup object via
// value/onChange.
import React from "react";

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

export default function SetupFields({ value = {}, onChange }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const setNested = (key, patch) => onChange({ ...v, [key]: { ...(v[key] || {}), ...patch } });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Sel label="buyer" val={v.buyer} onChange={(x) => set({ buyer: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "end_user", label: "end_user" }, { value: "reseller", label: "reseller" }]} />
      <Sel label="purchase_type" val={v.purchaseType} onChange={(x) => set({ purchaseType: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "retail", label: "retail" }, { value: "wholesale", label: "wholesale" }]} />
      <Sel label="sale_channel" val={v.saleChannel} onChange={(x) => set({ saleChannel: x })}
        opts={[{ value: "", label: "— (sin definir)" }, { value: "marketplace", label: "marketplace" }, { value: "manual", label: "manual" }]} />
      <Sel label="catalog (tipo)" val={v.catalog?.kind} onChange={(x) => setNested("catalog", { kind: x })}
        opts={[{ value: "", label: "— (nil)" }, { value: "pdf", label: "pdf" }, { value: "store_link", label: "store_link" }]} />
      <Labeled label="product_specific (tipo)">
        <select className="wf-input" value={v.productSpecific?.kind || ""} onChange={(e) => setNested("productSpecific", { kind: e.target.value || null })}>
          <option value="">— (nil)</option>
          <option value="product">product</option>
          <option value="family">family</option>
        </select>
      </Labeled>
      <Labeled label="product_specific (id)">
        <input className="wf-input" placeholder="ObjectId o vacío" value={v.productSpecific?.id || ""} onChange={(e) => setNested("productSpecific", { id: e.target.value || null })} />
      </Labeled>
      <Labeled label="has_promo (id de promo o vacío)">
        <input className="wf-input" placeholder="promoId o vacío" value={typeof v.hasPromo === "string" ? v.hasPromo : ""} onChange={(e) => set({ hasPromo: e.target.value || null })} />
      </Labeled>
      <Labeled label="catalog (valor / link)">
        <input className="wf-input" placeholder="URL del PDF o tienda" value={v.catalog?.value || ""} onChange={(e) => setNested("catalog", { value: e.target.value || null })} />
      </Labeled>
    </div>
  );
}
