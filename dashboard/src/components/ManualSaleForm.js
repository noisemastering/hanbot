import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "../i18n";
import API from "../api";

const inputStyle = {
  width: "100%",
  padding: "0.5rem",
  borderRadius: "4px",
  border: "1px solid #3a3a3a",
  backgroundColor: "#1a1a1a",
  color: "white",
  boxSizing: "border-box"
};

const labelStyle = { display: "block", color: "#aaa", fontSize: "0.8rem", marginBottom: "0.25rem" };

function ManualSaleForm({ psid, channel, onClose }) {
  const { t } = useTranslation();

  // Customer info
  const [crmName, setCrmName] = useState("");
  const [crmPhone, setCrmPhone] = useState("");
  const [crmEmail, setCrmEmail] = useState("");
  const [zipCode, setZipCode] = useState("");

  // Sale info — "current line" inputs, added to the cart before registering
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");

  // Cart: line items the client is ordering
  const [cart, setCart] = useState([]);

  const [registering, setRegistering] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [allProducts, setAllProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);

  // Auto-populate phone from WhatsApp psid
  useEffect(() => {
    if (channel === 'whatsapp' && psid?.startsWith('wa:')) {
      setCrmPhone(psid.substring(3));
    }
  }, [psid, channel]);

  // Fetch existing CRM data for this customer
  useEffect(() => {
    if (!psid) return;
    API.get(`/crm/customers/${encodeURIComponent(psid)}`).then(res => {
      if (res.data.success && res.data.customer) {
        const c = res.data.customer;
        if (c.crmName) setCrmName(c.crmName);
        if (c.crmPhone) setCrmPhone(c.crmPhone);
        if (c.crmEmail) setCrmEmail(c.crmEmail);
        if (c.zipCode) setZipCode(c.zipCode);
      }
    }).catch(() => {});
  }, [psid]);

  // Pre-fill from what the BOT collected in THIS conversation (handoff data) so the agent
  // taking over doesn't re-type it. Fills only EMPTY fields (functional setState) → never
  // clobbers CRM data that already loaded or an edit the agent made. Product isn't in CRM,
  // so it always comes from here (product + size + shade% + color).
  useEffect(() => {
    if (!psid) return;
    API.get(`/conversations/${encodeURIComponent(psid)}/handoff-info`).then(res => {
      const c = res.data && res.data.collected;
      if (!c) return;
      if (c.name) setCrmName(prev => prev || c.name);
      if (c.contact) setCrmPhone(prev => prev || c.contact);
      if (c.zip) setZipCode(prev => prev || c.zip);
      const prod = [
        c.product && String(c.product).replace(/_/g, " "),
        c.size,
        c.percentage ? `${c.percentage}%` : null,
        c.color,
      ].filter(Boolean).join(" ").trim();
      if (prod) setProductName(prev => prev || prod);
      if (c.quantity) setQuantity(prev => (!prev || prev === "1") ? String(c.quantity) : prev);
    }).catch(() => {});
  }, [psid]);

  useEffect(() => {
    API.get('/crm/products').then(res => {
      if (res.data.success) setAllProducts(res.data.products);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (productName.length >= 1 && allProducts.length > 0) {
      // Tokenized AND match: every word the agent types must appear somewhere
      // in the product's full path. So "malla rollo" or "rollo 6x4" both work,
      // and "rollo" returns ALL rollos (malla, borde, groundcover) — not just
      // the alphabetically-first 8.
      const tokens = productName.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const scored = allProducts
        .map((p) => {
          const lower = p.toLowerCase();
          if (!tokens.every((tk) => lower.includes(tk))) return null;
          // Rank: earliest position of the first token (a match near the start
          // of the path, e.g. "Malla Sombra…", outranks a deep one), then shorter.
          const pos = lower.indexOf(tokens[0]);
          return { p, score: pos * 1000 + p.length };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score)
        .slice(0, 25)
        .map((x) => x.p);
      setSuggestions(scored);
      setShowSuggestions(scored.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [productName, allProducts]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add the current line inputs to the cart
  const addToCart = () => {
    if (!productName.trim() || !totalAmount) return;
    setCart((c) => [
      ...c,
      {
        productName: productName.trim(),
        quantity: parseInt(quantity) || 1,
        amount: parseFloat(totalAmount) || 0,
      },
    ]);
    // reset the line inputs for the next product
    setProductName("");
    setQuantity("1");
    setTotalAmount("");
    setError(null);
  };

  const removeFromCart = (idx) => setCart((c) => c.filter((_, i) => i !== idx));

  const cartTotal = cart.reduce((s, it) => s + (it.amount || 0), 0);

  const handleRegister = async () => {
    // Build the line items: the cart, plus the current line if it's filled in
    // (so a single-product sale doesn't require clicking "Agregar").
    const items = [...cart];
    if (productName.trim() && totalAmount) {
      items.push({
        productName: productName.trim(),
        quantity: parseInt(quantity) || 1,
        amount: parseFloat(totalAmount) || 0,
      });
    }
    if (items.length === 0) return;

    setRegistering(true);
    setError(null);
    try {
      const res = await API.post(`/conversations/${psid}/register-sale`, {
        items,
        notes: notes.trim() || undefined,
        crmName: crmName.trim() || undefined,
        crmPhone: crmPhone.trim() || undefined,
        crmEmail: crmEmail.trim() || undefined,
        zipCode: zipCode.trim() || undefined
      });

      if (res.data.success) {
        setSuccess(res.data.clickLog);
        setTimeout(() => { onClose(); }, 3000);
      } else {
        setError(res.data.error || t('manualSale.error'));
      }
    } catch (err) {
      console.error("Error registering sale:", err);
      setError(t('manualSale.error'));
    } finally {
      setRegistering(false);
    }
  };

  const customerId = psid?.startsWith('wa:') ? psid.substring(3) : psid?.replace(/^fb:/, '') || '-';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: "#252525",
        borderRadius: "8px",
        padding: "1rem",
        marginTop: "1rem",
        border: "1px solid #3a3a3a",
        maxHeight: "60vh",
        overflowY: "auto"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h4 style={{ margin: 0, color: "white", fontSize: "1rem" }}>
          {t('manualSale.title')}
        </h4>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "1.2rem" }}
        >
          &times;
        </button>
      </div>

      {success ? (
        <div style={{
          padding: "1rem",
          backgroundColor: "#1a3a1a",
          border: "1px solid #4caf50",
          borderRadius: "4px",
          textAlign: "center"
        }}>
          <div style={{ color: "#4caf50", fontWeight: "bold", fontSize: "1rem", marginBottom: "0.5rem" }}>
            {t('manualSale.success')}
          </div>
          <div style={{ color: "#ccc", fontSize: "0.9rem" }}>
            {success.productName} - ${success.totalAmount.toLocaleString()}
          </div>
        </div>
      ) : (
        <>
          {/* Customer Info Section */}
          <div style={{ marginBottom: "0.75rem", padding: "0.75rem", backgroundColor: "#1e1e1e", borderRadius: "6px", border: "1px solid #333" }}>
            <div style={{ color: "#888", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.5rem", letterSpacing: "0.05em" }}>
              Datos del cliente
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label style={labelStyle}>Nombre</label>
                <input
                  type="text"
                  placeholder="Nombre del cliente"
                  value={crmName}
                  onChange={(e) => setCrmName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Celular {channel === 'whatsapp' && <span style={{ color: "#4caf50", fontSize: "0.7rem" }}>(WhatsApp)</span>}</label>
                <input
                  type="text"
                  placeholder="5551234567"
                  value={crmPhone}
                  onChange={(e) => setCrmPhone(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={crmEmail}
                  onChange={(e) => setCrmEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Código Postal</label>
                <input
                  type="text"
                  placeholder="12345"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ marginTop: "0.5rem", color: "#555", fontSize: "0.7rem" }}>
              ID: {customerId}
            </div>
          </div>

          {/* Product Name with Autocomplete */}
          <label style={labelStyle}>
            {t('manualSale.product')} *
          </label>
          <div style={{ position: "relative", marginBottom: "0.75rem" }} ref={suggestionsRef}>
            <input
              type="text"
              placeholder={t('manualSale.productPlaceholder')}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              style={inputStyle}
            />
            {showSuggestions && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                backgroundColor: "#1a1a1a",
                border: "1px solid #3a3a3a",
                borderRadius: "4px",
                maxHeight: "180px",
                overflowY: "auto",
                zIndex: 10
              }}>
                {suggestions.map((s) => (
                  <div
                    key={s}
                    onClick={() => { setProductName(s); setShowSuggestions(false); }}
                    style={{
                      padding: "0.5rem 0.75rem",
                      color: "#ddd",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      borderBottom: "1px solid #2a2a2a"
                    }}
                    onMouseEnter={(e) => { e.target.style.backgroundColor = "#2a2a2a"; }}
                    onMouseLeave={(e) => { e.target.style.backgroundColor = "transparent"; }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quantity + Amount row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div>
              <label style={labelStyle}>Cantidad *</label>
              <input
                type="number"
                placeholder="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                step="1"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('manualSale.amount')} *</label>
              <input
                type="number"
                placeholder="0.00"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Add-to-cart */}
          <button
            onClick={addToCart}
            disabled={!productName.trim() || !totalAmount}
            style={{
              width: "100%",
              padding: "0.5rem",
              marginBottom: "0.75rem",
              backgroundColor: "transparent",
              color: (!productName.trim() || !totalAmount) ? "#555" : "#4caf50",
              border: `1px dashed ${(!productName.trim() || !totalAmount) ? "#444" : "#4caf50"}`,
              borderRadius: "4px",
              cursor: (!productName.trim() || !totalAmount) ? "not-allowed" : "pointer",
              fontWeight: "bold",
              fontSize: "0.85rem"
            }}
          >
            + Agregar producto al pedido
          </button>

          {/* Cart */}
          {cart.length > 0 && (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", backgroundColor: "#1e1e1e", borderRadius: "6px", border: "1px solid #333" }}>
              <div style={{ color: "#888", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.4rem", letterSpacing: "0.05em" }}>
                Pedido ({cart.length})
              </div>
              {cart.map((it, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0", borderBottom: idx < cart.length - 1 ? "1px solid #2a2a2a" : "none" }}>
                  <span style={{ color: "#bbb", fontSize: "0.75rem", minWidth: "1.5rem" }}>{it.quantity}×</span>
                  <span style={{ color: "#ddd", fontSize: "0.8rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.productName}>{it.productName}</span>
                  <span style={{ color: "#4caf50", fontSize: "0.8rem", fontFamily: "monospace" }}>${it.amount.toLocaleString()}</span>
                  <button onClick={() => removeFromCart(idx)} style={{ background: "none", border: "none", color: "#f44336", cursor: "pointer", fontSize: "1rem", padding: "0 0.2rem" }} title="Quitar">×</button>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #3a3a3a" }}>
                <span style={{ color: "#aaa", fontSize: "0.8rem", fontWeight: "bold" }}>Total</span>
                <span style={{ color: "#4caf50", fontSize: "0.9rem", fontWeight: "bold", fontFamily: "monospace" }}>${cartTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <label style={labelStyle}>
            {t('manualSale.notes')}
          </label>
          <textarea
            placeholder={t('manualSale.notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              ...inputStyle,
              marginBottom: "1rem",
              resize: "vertical",
              fontFamily: "inherit"
            }}
          />

          {/* Register Button — enabled if the cart has items OR the current line is filled */}
          {(() => {
            const canRegister = cart.length > 0 || (productName.trim() && totalAmount);
            const disabled = registering || !canRegister;
            return (
              <button
                onClick={handleRegister}
                disabled={disabled}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: registering ? "#666" : "#4caf50",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1,
                  fontWeight: "bold"
                }}
              >
                {registering ? t('manualSale.registering') : t('manualSale.register')}
              </button>
            );
          })()}
        </>
      )}

      {error && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.5rem",
          backgroundColor: "#5a1a1a",
          border: "1px solid #f44336",
          borderRadius: "4px",
          color: "#f44336",
          fontSize: "0.85rem"
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default ManualSaleForm;
