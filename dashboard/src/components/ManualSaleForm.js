import React, { useState } from "react";
import { useTranslation } from "../i18n";
import API from "../api";

function ManualSaleForm({ psid, onClose }) {
  const { t } = useTranslation();
  const [productName, setProductName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [registering, setRegistering] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);

  const handleRegister = async () => {
    if (!productName.trim() || !totalAmount) return;

    setRegistering(true);
    setError(null);
    try {
      const res = await API.post(`/conversations/${psid}/register-sale`, {
        productName: productName.trim(),
        totalAmount: parseFloat(totalAmount),
        notes: notes.trim() || undefined
      });

      if (res.data.success) {
        setSuccess(res.data.clickLog);
        setTimeout(() => {
          onClose();
        }, 3000);
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

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: "#252525",
        borderRadius: "8px",
        padding: "1rem",
        marginTop: "1rem",
        border: "1px solid #3a3a3a"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h4 style={{ margin: 0, color: "white", fontSize: "1rem" }}>
          {t('manualSale.title')}
        </h4>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            cursor: "pointer",
            fontSize: "1.2rem"
          }}
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
          {/* Product Name */}
          <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            {t('manualSale.product')} *
          </label>
          <input
            type="text"
            placeholder={t('manualSale.productPlaceholder')}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "0.75rem",
              boxSizing: "border-box"
            }}
          />

          {/* Sale Amount */}
          <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            {t('manualSale.amount')} *
          </label>
          <input
            type="number"
            placeholder="0.00"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            min="0"
            step="0.01"
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "0.75rem",
              boxSizing: "border-box"
            }}
          />

          {/* Notes */}
          <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            {t('manualSale.notes')}
          </label>
          <textarea
            placeholder={t('manualSale.notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "1rem",
              boxSizing: "border-box",
              resize: "vertical",
              fontFamily: "inherit"
            }}
          />

          {/* Register Button */}
          <button
            onClick={handleRegister}
            disabled={registering || !productName.trim() || !totalAmount}
            style={{
              width: "100%",
              padding: "0.75rem",
              backgroundColor: registering ? "#666" : "#4caf50",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: registering || !productName.trim() || !totalAmount ? "not-allowed" : "pointer",
              opacity: registering || !productName.trim() || !totalAmount ? 0.6 : 1,
              fontWeight: "bold"
            }}
          >
            {registering ? t('manualSale.registering') : t('manualSale.register')}
          </button>
        </>
      )}

      {/* Error Message */}
      {error && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            backgroundColor: "#5a1a1a",
            border: "1px solid #f44336",
            borderRadius: "4px",
            color: "#f44336",
            fontSize: "0.85rem"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default ManualSaleForm;
