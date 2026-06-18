// pages/PromosView.js
//
// Promo Administrator (Bot menu — admins + campaign manager). CRUD over the
// /promos API. A promo is ALWAYS a product (or range of products) at a promo
// price — never a quantity deal. The free-text "reglas" field is appended
// VERBATIM to the bot's promo context, so the operator fully dictates wording.
import React, { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import API from "../api";

// ---- product tree helpers ------------------------------------------------
function flattenTree(nodes, acc = {}) {
  for (const n of nodes || []) {
    acc[String(n._id)] = { id: String(n._id), name: n.name, size: n.size, price: n.price, sellable: n.sellable };
    flattenTree(n.children, acc);
  }
  return acc;
}

function TreePicker({ tree, selected, onToggle }) {
  const [expanded, setExpanded] = useState({});
  const toggleExp = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  // Ids that are ANCESTORS of a selected node — auto-expanded so a pre-selected
  // (often deeply nested) product is visible without hunting through the tree.
  const ancestorSet = useMemo(() => {
    const set = new Set();
    const walk = (nodes, path) => {
      for (const n of nodes || []) {
        const id = String(n._id);
        if (selected.includes(id)) path.forEach((a) => set.add(a));
        walk(n.children, [...path, id]);
      }
    };
    walk(tree, []);
    return set;
  }, [tree, selected]);
  const render = (node, depth) => {
    const id = String(node._id);
    const kids = node.children || [];
    const open = expanded[id] ?? (depth < 1 || ancestorSet.has(id));
    return (
      <div key={id}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
          {kids.length ? (
            <button type="button" onClick={() => toggleExp(id)} className="text-gray-400 w-4 text-xs">
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 inline-block" />
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-200 cursor-pointer py-0.5">
            <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} />
            {node.name}
            {node.sellable ? (
              <span className="text-[10px] text-emerald-400">·{node.size || "medida"}</span>
            ) : (
              <span className="text-[10px] text-gray-500">·grupo/rango</span>
            )}
          </label>
        </div>
        {open && kids.map((k) => render(k, depth + 1))}
      </div>
    );
  };
  return (
    <div className="border border-gray-700 rounded-lg p-2 max-h-72 overflow-y-auto bg-gray-900">
      {tree.length ? tree.map((r) => render(r, 0)) : <p className="text-xs text-gray-500">Cargando productos…</p>}
    </div>
  );
}

// ---- date helpers --------------------------------------------------------
const toInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fromInput = (s) => (s ? new Date(s + "T00:00:00").toISOString() : null);

function blankPromo() {
  return {
    name: "",
    promoProductIds: [],
    promoPrices: [],
    timeframe: { startDate: null, endDate: null },
    terms: "",
    colorNote: "",
    salesPitch: "",
    active: true,
  };
}

export default function PromosView() {
  const [promos, setPromos] = useState([]);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // promo form object, or null when closed
  const [saving, setSaving] = useState(false);

  const flat = useMemo(() => flattenTree(tree), [tree]);

  const load = async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([API.get("/promos"), API.get("/product-families/tree")]);
      setPromos(p.data?.data || []);
      setTree(t.data?.data || []);
    } catch (err) {
      toast.error("No se pudieron cargar las promociones");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Open the editor. Normalize a fetched promo (populated ids → string ids).
  const openEdit = (promo) => {
    if (!promo) {
      setEditing(blankPromo());
      return;
    }
    setEditing({
      _id: promo._id,
      name: promo.name || "",
      promoProductIds: (promo.promoProductIds || []).map((x) => String(x?._id || x)),
      promoPrices: (promo.promoPrices || []).map((x) => ({ productId: String(x.productId?._id || x.productId), price: x.price })),
      timeframe: { startDate: promo.timeframe?.startDate || null, endDate: promo.timeframe?.endDate || null },
      terms: promo.terms || "",
      colorNote: promo.colorNote || "",
      salesPitch: promo.salesPitch || "",
      active: promo.active !== false,
    });
  };

  const toggleProduct = (id) => {
    setEditing((e) => {
      const has = e.promoProductIds.includes(id);
      return {
        ...e,
        promoProductIds: has ? e.promoProductIds.filter((x) => x !== id) : [...e.promoProductIds, id],
        // drop a price override if the product is deselected
        promoPrices: has ? e.promoPrices.filter((p) => p.productId !== id) : e.promoPrices,
      };
    });
  };

  const setOverride = (productId, val) => {
    setEditing((e) => {
      const rest = e.promoPrices.filter((p) => p.productId !== productId);
      if (val === "" || val == null) return { ...e, promoPrices: rest };
      return { ...e, promoPrices: [...rest, { productId, price: Number(val) }] };
    });
  };
  const overrideOf = (productId) => editing.promoPrices.find((p) => p.productId === productId)?.price ?? "";

  const save = async () => {
    if (!editing.name.trim()) return toast.error("Ponle un nombre a la promoción");
    if (!editing.promoProductIds.length) return toast.error("Selecciona al menos un producto");
    setSaving(true);
    const body = {
      name: editing.name.trim(),
      promoProductIds: editing.promoProductIds,
      promoPrices: editing.promoPrices,
      timeframe: editing.timeframe,
      terms: editing.terms.trim() || null,
      colorNote: editing.colorNote.trim() || null,
      salesPitch: editing.salesPitch.trim() || null,
      active: editing.active,
    };
    try {
      if (editing._id) await API.put(`/promos/${editing._id}`, body);
      else await API.post("/promos", body);
      toast.success("Promoción guardada");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const del = async (promo) => {
    if (!window.confirm(`¿Eliminar la promoción "${promo.name}"? Esto no se puede deshacer.`)) return;
    try {
      await API.delete(`/promos/${promo._id}`);
      toast.success("Promoción eliminada");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo eliminar");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-white">Promociones</h1>
        <div className="flex-1" />
        <button
          onClick={() => openEdit(null)}
          className="px-3 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium"
        >
          + Nueva promoción
        </button>
      </div>
      <p className="text-gray-400 text-xs mb-5">
        Una promoción es un producto (o rango de productos) a un precio especial. El texto de “reglas” se le da al bot tal cual.
      </p>

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando…</p>
      ) : promos.length === 0 ? (
        <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
          No hay promociones. Crea la primera con “+ Nueva promoción”.
        </div>
      ) : (
        <div className="space-y-2">
          {promos.map((p) => (
            <div key={p._id} className="border border-gray-700 rounded-xl p-3 bg-gray-800/40 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{p.name}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      p.active !== false ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-600/40 text-gray-400"
                    }`}
                  >
                    {p.active !== false ? "activa" : "inactiva"}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {(p.promoProductIds || []).map((x) => x?.name || "—").join(", ") || "sin productos"}
                  {(p.promoPrices || []).length > 0 && (
                    <span className="text-gray-500">
                      {" · "}
                      {p.promoPrices.map((pp) => `$${pp.price}`).join(", ")}
                    </span>
                  )}
                </div>
                {p.terms && <div className="text-[11px] text-gray-500 mt-1 italic">“{p.terms}”</div>}
              </div>
              <button onClick={() => openEdit(p)} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white">
                Editar
              </button>
              <button onClick={() => del(p)} className="text-xs px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white">
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl my-8 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing._id ? "Editar promoción" : "Nueva promoción"}</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white text-xl leading-none">
                ×
              </button>
            </div>

            <label className="block">
              <span className="block text-xs text-gray-400 mb-1">Nombre</span>
              <input
                className="wf-input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ej. Promo 6x4 Beige"
              />
            </label>

            <div>
              <span className="block text-xs text-gray-400 mb-1">
                Producto(s) / rango — {editing.promoProductIds.length} seleccionado(s)
                {editing.promoProductIds.length > 0 && (
                  <span className="text-emerald-300">
                    {": "}
                    {editing.promoProductIds.map((id) => flat[id]?.name || id).join(", ")}
                  </span>
                )}
              </span>
              <TreePicker tree={tree} selected={editing.promoProductIds} onToggle={toggleProduct} />
            </div>

            {editing.promoProductIds.length > 0 && (
              <div>
                <span className="block text-xs text-gray-400 mb-1">
                  Precio promocional (opcional — deja vacío para usar el precio de Mercado Libre/Inventario)
                </span>
                <div className="space-y-1">
                  {editing.promoProductIds.map((id) => (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-300 flex-1 truncate">
                        {flat[id]?.name || id}
                        {flat[id]?.size ? <span className="text-gray-500"> ({flat[id].size})</span> : null}
                      </span>
                      <span className="text-gray-500">$</span>
                      <input
                        type="number"
                        className="wf-input w-28 py-1"
                        value={overrideOf(id)}
                        onChange={(e) => setOverride(id, e.target.value)}
                        placeholder={flat[id]?.price != null ? String(flat[id].price) : "precio"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-gray-400 mb-1">Vigencia — inicio</span>
                <input
                  type="date"
                  className="wf-input"
                  value={toInput(editing.timeframe.startDate)}
                  onChange={(e) => setEditing({ ...editing, timeframe: { ...editing.timeframe, startDate: fromInput(e.target.value) } })}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-400 mb-1">Vigencia — fin</span>
                <input
                  type="date"
                  className="wf-input"
                  value={toInput(editing.timeframe.endDate)}
                  onChange={(e) => setEditing({ ...editing, timeframe: { ...editing.timeframe, endDate: fromInput(e.target.value) } })}
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-xs text-gray-400 mb-1">
                Reglas / descripción (el bot la usa tal cual)
              </span>
              <textarea
                className="wf-input"
                rows={3}
                value={editing.terms}
                onChange={(e) => setEditing({ ...editing, terms: e.target.value })}
                placeholder="Ej. Es la malla 6x4 m a precio promocional. Aplica solo a esa medida."
              />
            </label>

            <label className="block">
              <span className="block text-xs text-gray-400 mb-1">
                Pitch de venta (opcional — si lo llenas, el bot lo envía TAL CUAL, una sola vez, cuando el cliente pida la promo)
              </span>
              <textarea
                className="wf-input"
                rows={4}
                value={editing.salesPitch}
                onChange={(e) => setEditing({ ...editing, salesPitch: e.target.value })}
                placeholder={"Ej. 🔥 Promo Mundial: malla sombra 6x4 m beige reforzada, lista para instalar, envío gratis. Aprovecha el 51% de descuento por tiempo limitado. 🛒"}
              />
            </label>

            <label className="block">
              <span className="block text-xs text-gray-400 mb-1">Nota de color (opcional)</span>
              <input
                className="wf-input"
                value={editing.colorNote}
                onChange={(e) => setEditing({ ...editing, colorNote: e.target.value })}
                placeholder="Ej. Únicamente en color beige."
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Activa
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
