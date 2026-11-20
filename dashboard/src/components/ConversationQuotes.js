// components/ConversationQuotes.js
//
// "Cotizada": once the bot has handed a conversation to a person, the asesor can
// record the quote they issued — the folio from the quoting system (we never
// generate it) and the items it covers. The form opens prefilled with what the
// bot read in the conversation, and the asesor confirms the list before saving.
//
// One chat can be several conversations (a customer returns weeks later about
// something else), so a quote is filed under the VISIT it belongs to, and a
// visit can carry more than one quote when they cover different items.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import API from "../api";

const fmtDay = (d) => new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const visitLabel = (s) => (sameDay(s.start, s.end) ? fmtDay(s.start) : `${fmtDay(s.start)} – ${fmtDay(s.end)}`);
const digits = (v) => String(v || "").replace(/\D/g, "").slice(0, 6);

export default function ConversationQuotes({ psid }) {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // null | { quote? }

  const load = useCallback(async () => {
    if (!psid) return;
    try {
      const res = await API.get(`/quotes/convo/${encodeURIComponent(psid)}`);
      setData(res.data);
    } catch (err) {
      setData(null);
    }
  }, [psid]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const remove = async (q) => {
    if (!window.confirm(`¿Quitar la cotización ${q.quoteNumber} de esta conversación?`)) return;
    try {
      await API.delete(`/quotes/${q._id}`);
      toast.success("Cotización quitada");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo quitar");
    }
  };

  if (!data || (!data.eligible && !data.quotes?.length)) return null;
  const quotes = data.quotes || [];

  return (
    <div className="mt-3 pt-2 border-t border-gray-700/60">
      <div className="text-[10px] uppercase text-gray-500 mb-1">
        Cotización
        {quotes.length > 0 && <span className="ml-1 text-sky-400">· cotizada</span>}
      </div>

      {quotes.map((q) => (
        <div key={q._id} className="mb-2 rounded border border-sky-700/50 bg-sky-900/20 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-sky-200 font-mono font-semibold">#{q.quoteNumber}</span>
            <span className="text-[10px] text-gray-500">
              {fmtDay(q.createdAt)}{q.by ? ` · ${q.by}` : ""}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {(q.items || []).map((it, i) => (
              <li key={i} className="text-[11px] text-gray-300 leading-snug">
                <span className="text-gray-400">{it.qty} ×</span> {it.label}
                {!it.productId && <span className="text-amber-400/80"> · fuera de catálogo</span>}
              </li>
            ))}
          </ul>
          {q.sessionStart && data.sessions?.length > 1 && (
            <div className="mt-1 text-[10px] text-gray-500">Conversación del {fmtDay(q.sessionStart)}</div>
          )}
          {q.note && <div className="mt-1 text-[10px] text-gray-400 italic">{q.note}</div>}
          <div className="mt-1 flex gap-3">
            <button onClick={() => setModal({ quote: q })} className="text-[10px] text-gray-400 hover:text-white underline">editar</button>
            <button onClick={() => remove(q)} className="text-[10px] text-gray-500 hover:text-red-300 underline">quitar</button>
          </div>
        </div>
      ))}

      {data.eligible && (
        <button
          onClick={() => setModal({})}
          className="w-full text-xs px-2 py-1 rounded border border-sky-600/60 text-sky-300 hover:bg-sky-600/20"
        >
          {quotes.length ? "+ Agregar otra cotización" : "Marcar como cotizada"}
        </button>
      )}

      {modal && (
        <QuoteModal
          psid={psid}
          data={data}
          quote={modal.quote || null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function QuoteModal({ psid, data, quote, onClose, onSaved }) {
  const editing = !!quote;
  const sessions = data.sessions || [];
  const [session, setSession] = useState(data.defaultSession >= 0 ? data.defaultSession : sessions.length - 1);
  const [number, setNumber] = useState(quote?.quoteNumber || "");
  const [note, setNote] = useState(quote?.note || "");
  // Each row: { key, productId, productCode, label, qty, source, checked }
  const [items, setItems] = useState(
    editing ? (quote.items || []).map((it, i) => ({ ...it, key: `e${i}`, checked: true })) : []
  );
  const [topic, setTopic] = useState(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    API.get("/quotes/catalog").then((r) => setCatalog(r.data?.items || [])).catch(() => {});
  }, []);

  // The bot's prefill, per visit. Changing the visit re-reads it, but anything the
  // asesor added by hand stays.
  useEffect(() => {
    if (editing) return;
    let alive = true;
    setReading(true);
    setReadFailed(false);
    API.get(`/quotes/suggest/${encodeURIComponent(psid)}`, { params: { session } })
      .then((r) => {
        if (!alive) return;
        setTopic(r.data?.topic || null);
        setReadFailed(!r.data?.readByModel);
        const found = (r.data?.items || []).map((it, i) => ({ ...it, key: `b${session}-${i}`, checked: true }));
        setItems((prev) => [...found, ...prev.filter((p) => p.source === "manual")]);
      })
      .catch(() => { if (alive) { setReadFailed(true); setItems((prev) => prev.filter((p) => p.source === "manual")); } })
      .finally(() => { if (alive) setReading(false); });
    return () => { alive = false; };
  }, [psid, session, editing]);

  const patch = (key, change) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...change } : it)));

  const matches = useMemo(() => {
    const words = search.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const taken = new Set(items.map((i) => i.productId).filter(Boolean));
    return catalog
      .filter((c) => !taken.has(c.productId))
      .filter((c) => {
        const hay = `${c.label} ${c.productCode || ""} ${c.size || ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
  }, [search, catalog, items]);

  const addProduct = (c) => {
    setItems((prev) => [...prev, { key: `m${Date.now()}`, productId: c.productId, productCode: c.productCode, label: c.label, qty: 1, source: "manual", checked: true }]);
    setSearch("");
  };
  const addFree = () => {
    const label = search.trim();
    if (label.length < 3) return;
    setItems((prev) => [...prev, { key: `f${Date.now()}`, productId: null, productCode: null, label, qty: 1, source: "manual", checked: true }]);
    setSearch("");
  };

  const chosen = items.filter((i) => i.checked);
  const numberOk = /^\d{4,6}$/.test(number);
  const canSave = numberOk && chosen.length > 0 && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        psid,
        session,
        quoteNumber: number,
        note,
        items: chosen.map(({ productId, label, qty, source }) => ({ productId, label, qty: Number(qty) || 1, source })),
      };
      const res = editing ? await API.put(`/quotes/${quote._id}`, payload) : await API.post("/quotes", payload);
      toast.success(editing ? "Cotización actualizada" : `Conversación marcada como cotizada (#${number})`);
      if (res.data?.alsoIn?.length) {
        toast(`Ojo: la cotización #${number} también está registrada en otra conversación`, { icon: "⚠️", duration: 7000 });
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar la cotización");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-white font-semibold mb-3">{editing ? `Editar cotización #${quote.quoteNumber}` : "Marcar como cotizada"}</h3>

        {!editing && sessions.length > 1 && (
          <>
            <label className="block text-xs text-gray-400 mb-1">
              Este chat tiene {sessions.length} conversaciones. ¿Cuál se cotizó?
            </label>
            <div className="space-y-1 mb-3">
              {[...sessions].reverse().map((s) => (
                <button
                  key={s.index}
                  onClick={() => setSession(s.index)}
                  className={`w-full text-left rounded-lg border px-3 py-1.5 ${session === s.index ? "border-sky-500 bg-sky-900/30" : "border-gray-700 hover:border-gray-500"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white">{visitLabel(s)}</span>
                    <span className="text-[10px] text-gray-500">
                      {s.count} mensajes{s.quoteNumbers?.length ? ` · ya cotizada #${s.quoteNumbers.join(", #")}` : ""}
                    </span>
                  </div>
                  {s.firstUserText && <div className="text-[11px] text-gray-400 truncate">“{s.firstUserText}”</div>}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="block text-xs text-gray-400 mb-1">Número de cotización (4 a 6 dígitos)</label>
        <input
          autoFocus
          value={number}
          onChange={(e) => setNumber(digits(e.target.value))}
          onPaste={(e) => { e.preventDefault(); setNumber(digits(e.clipboardData.getData("text"))); }}
          inputMode="numeric"
          placeholder="Pega aquí el número"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono mb-1"
        />
        <div className="text-[10px] mb-3 h-3">
          {number && !numberOk && <span className="text-amber-400">Deben ser de 4 a 6 dígitos</span>}
        </div>

        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs text-gray-400">Productos cotizados — confirma la lista</label>
          {topic && !reading && <span className="text-[10px] text-gray-500">{topic}</span>}
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 mb-2">
          {reading ? (
            <p className="text-xs text-gray-500 px-3 py-3">Leyendo la conversación…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-gray-500 px-3 py-3">
              {readFailed ? "No se pudo leer la conversación." : "No encontré productos en esta conversación."} Agrégalos abajo.
            </p>
          ) : (
            items.map((it) => (
              <div key={it.key} className={`flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 last:border-b-0 ${it.checked ? "" : "opacity-40"}`}>
                <input type="checkbox" checked={it.checked} onChange={(e) => patch(it.key, { checked: e.target.checked })} />
                <input
                  type="number" min="1" value={it.qty}
                  onChange={(e) => patch(it.key, { qty: e.target.value })}
                  className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-white text-xs text-right"
                  title="Cantidad"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-200 leading-snug">{it.label}</div>
                  <div className="text-[10px] text-gray-500">
                    {it.productId ? it.productCode || "catálogo" : <span className="text-amber-400/80">fuera de catálogo</span>}
                    {it.source === "bot" ? " · sugerido por el bot" : " · agregado a mano"}
                  </div>
                </div>
                <button onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))} className="text-gray-500 hover:text-red-300 text-sm" title="Quitar">✕</button>
              </div>
            ))
          )}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !matches.length) addFree(); }}
          placeholder="Agregar producto: busca en el catálogo (ej. reforzada 4x6 beige)"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs"
        />
        {search.trim() && (
          <div className="rounded-lg border border-gray-700 bg-gray-900 mt-1 mb-2">
            {matches.map((c) => (
              <button key={c.productId} onClick={() => addProduct(c)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-800 border-b border-gray-800">
                <span className="text-xs text-gray-200">{c.label}</span>
                <span className="text-[10px] text-gray-500"> · {c.productCode}{c.active ? "" : " · inactivo"}</span>
              </button>
            ))}
            {search.trim().length >= 3 && (
              <button onClick={addFree} className="block w-full text-left px-3 py-1.5 hover:bg-gray-800">
                <span className="text-xs text-amber-300">+ Agregar “{search.trim()}” como producto fuera de catálogo</span>
              </button>
            )}
          </div>
        )}

        <label className="block text-xs text-gray-400 mb-1 mt-3">Nota (opcional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs mb-4"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg bg-gray-700 text-white">Cancelar</button>
          <button onClick={save} disabled={!canSave} className="px-3 py-2 text-sm rounded-lg bg-sky-600 text-white disabled:opacity-50">
            {saving ? "Guardando…" : editing ? "Guardar cambios" : "Guardar cotización"}
          </button>
        </div>
      </div>
    </div>
  );
}
