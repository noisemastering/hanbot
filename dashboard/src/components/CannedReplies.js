// components/CannedReplies.js
//
// Our own "Saved Replies" — a Messenger-style canned-message picker that lives in
// the reply composer. Click the button → searchable popover → click a reply to
// insert it into the composer. Add / edit / delete inline. Self-contained: it owns
// its own data via /canned-messages and only calls onInsert(text) back to the composer.
import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "../i18n";
import API from "../api";

export default function CannedReplies({ onInsert, psid, agentName }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | "<id>"
  const [form, setForm] = useState({ title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState(null); // fixed-position anchor for the portal popover
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  // The composer sits inside a scrollable (overflow) container, so the popover is
  // rendered in a PORTAL with position:fixed — otherwise it gets clipped/hidden
  // behind the conversation. Anchor it just above the button.
  const openPop = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ left: Math.max(8, Math.min(r.left, window.innerWidth - 388)), bottom: window.innerHeight - r.top + 8 });
    setOpen(true);
  };

  const load = useCallback(async () => {
    try {
      const { data } = await API.get("/canned-messages");
      if (data.success) setItems(data.data);
    } catch (_) { /* silent */ }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return; // clicks inside the portal
      close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const close = () => { setOpen(false); setEditing(null); setSearch(""); };

  const insert = async (m) => {
    let text = m.body;
    // Dynamic messages: resolve {{tokens}} live against THIS conversation before inserting.
    if (m.dynamic || /\{\{/.test(m.body)) {
      try {
        const { data } = await API.post("/canned-messages/resolve", { id: m._id, psid, agentName });
        if (data.success && data.resolved) text = data.resolved;
      } catch (_) { /* fall back to the raw body */ }
    }
    onInsert(text);
    API.post(`/canned-messages/${m._id}/used`).catch(() => {});
    close();
  };

  const startNew = () => { setForm({ title: "", body: "" }); setEditing("new"); };
  const startEdit = (m) => { setForm({ title: m.title, body: m.body }); setEditing(m._id); };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSaving(true);
    try {
      if (editing === "new") await API.post("/canned-messages", form);
      else await API.put(`/canned-messages/${editing}`, form);
      setEditing(null);
      await load();
    } catch (_) { /* silent */ } finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm(t("canned.confirmDelete"))) return;
    try { await API.delete(`/canned-messages/${id}`); await load(); } catch (_) { /* silent */ }
  };

  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter((m) => `${m.title} ${m.body}`.toLowerCase().includes(q)) : items;

  // ── styles (match the dark composer) ──
  const S = {
    btn: { padding: "12px 14px", borderRadius: "8px", border: "2px solid #4a4a4a", backgroundColor: "#2a2a2a", color: "white", cursor: "pointer", fontSize: "1.2rem" },
    pop: { position: "fixed", width: 380, maxHeight: 440, display: "flex", flexDirection: "column", backgroundColor: "#1f1f1f", border: "1px solid #3a3a3a", borderRadius: "10px", boxShadow: "0 8px 30px rgba(0,0,0,0.6)", zIndex: 100000, overflow: "hidden" },
    head: { padding: "10px 12px", borderBottom: "1px solid #2f2f2f", display: "flex", gap: 8, alignItems: "center" },
    searchInput: { flex: 1, padding: "8px 10px", borderRadius: "6px", border: "1px solid #3a3a3a", backgroundColor: "#2a2a2a", color: "white", fontSize: "0.9rem" },
    list: { overflowY: "auto", padding: "6px" },
    row: { padding: "8px 10px", borderRadius: "6px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 2 },
    title: { fontSize: "0.85rem", fontWeight: 600, color: "#e6e6e6", display: "flex", justifyContent: "space-between", alignItems: "center" },
    preview: { fontSize: "0.78rem", color: "#9a9a9a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    iconBtn: { background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", padding: "0 4px", opacity: 0.7 },
    footer: { padding: "8px", borderTop: "1px solid #2f2f2f" },
    addBtn: { width: "100%", padding: "8px", borderRadius: "6px", border: "1px dashed #4a4a4a", background: "none", color: "#8ab4f8", cursor: "pointer", fontSize: "0.85rem" },
    field: { width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #3a3a3a", backgroundColor: "#2a2a2a", color: "white", fontSize: "0.9rem", marginBottom: 8, boxSizing: "border-box" },
    saveBtn: { flex: 1, padding: "8px", borderRadius: "6px", border: "none", background: "#4a7cff", color: "white", cursor: "pointer", fontWeight: 600 },
    cancelBtn: { flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #3a3a3a", background: "none", color: "#bbb", cursor: "pointer" },
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())} title={t("canned.button")} style={S.btn}>💬</button>

      {open && coords && ReactDOM.createPortal(
        <div ref={popRef} style={{ ...S.pop, left: coords.left, bottom: coords.bottom }}>
          {editing ? (
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: "0.85rem", color: "#bbb", marginBottom: 8 }}>
                {editing === "new" ? t("canned.new") : t("canned.edit")}
              </div>
              <input
                style={S.field}
                placeholder={t("canned.titlePlaceholder")}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
                maxLength={40}
              />
              <textarea
                style={{ ...S.field, minHeight: 90, resize: "vertical" }}
                placeholder={t("canned.bodyPlaceholder")}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.cancelBtn} onClick={() => setEditing(null)}>{t("canned.cancel")}</button>
                <button style={{ ...S.saveBtn, opacity: !form.title.trim() || !form.body.trim() || saving ? 0.6 : 1 }} disabled={!form.title.trim() || !form.body.trim() || saving} onClick={save}>
                  {saving ? "..." : t("canned.save")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={S.head}>
                <input style={S.searchInput} placeholder={t("canned.search")} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              </div>
              <div style={S.list}>
                {filtered.map((m) => (
                  <div
                    key={m._id}
                    style={S.row}
                    onClick={() => insert(m)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2c2c2c")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <div style={S.title}>
                      <span>{m.title}</span>
                      <span>
                        <button style={S.iconBtn} title={t("canned.edit")} onClick={(e) => { e.stopPropagation(); startEdit(m); }}>✏️</button>
                        <button style={S.iconBtn} title={t("canned.delete")} onClick={(e) => { e.stopPropagation(); remove(m._id); }}>🗑️</button>
                      </span>
                    </div>
                    <div style={S.preview}>{m.body}</div>
                  </div>
                ))}
                {!filtered.length && (
                  <div style={{ padding: 16, textAlign: "center", color: "#777", fontSize: "0.85rem" }}>
                    {q ? t("canned.noResults") : t("canned.empty")}
                  </div>
                )}
              </div>
              <div style={S.footer}>
                <button style={S.addBtn} onClick={startNew}>+ {t("canned.new")}</button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
