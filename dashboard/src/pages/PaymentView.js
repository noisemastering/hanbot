// pages/PaymentView.js
//
// Spec Ops · Pago (super_admin). Shows the current month's plan-payment status and
// lets the operator mark the account as PAID — which clears the payment banner shown
// to admins across the dashboard.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";
import { useAuth } from "../contexts/AuthContext";

function Info({ label, value }) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );
}

export default function PaymentView() {
  const { refreshBanner } = useAuth();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await API.get("/spec-ops/status");
      setPayment(res.data?.payment || null);
    } catch (e) {
      toast.error("No se pudo leer el estado");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const markPaid = async () => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/mark-paid", {});
      setPayment(res.data?.payment || null);
      if (refreshBanner) refreshBanner();
      toast.success("💵 Cuenta marcada como PAGADA para este mes");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo marcar como pagado");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !payment) return <div className="p-8 text-gray-400">Cargando…</div>;

  const { status, month, price, currency, dueDay, cancelPolicy, paidForMonth, lastPaidAt, lastPaidBy } = payment;
  const badge = status === "paid" ? { label: "PAGADO", cls: "text-green-400 border-green-500 bg-green-950/30" }
    : status === "overdue" ? { label: "VENCIDO", cls: "text-red-400 border-red-500 bg-red-950/30" }
    : { label: "PENDIENTE", cls: "text-indigo-300 border-indigo-500 bg-indigo-950/30" };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Pago del plan</h1>
      <p className="text-gray-400 mb-6">
        Estado del pago del mes en curso. Marca la cuenta como <strong>pagada</strong> para retirar el aviso que ven los administradores en todo el sistema.
      </p>

      <div className={`rounded-2xl border p-8 ${badge.cls}`}>
        <div className="flex items-center justify-between mb-6">
          <span className="text-xl font-extrabold">{badge.label}</span>
          <span className="text-sm text-gray-400">{month}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <Info label="Plan" value={`$${price} ${currency} / mes`} />
          <Info label="Vence el día" value={dueDay} />
          <Info label="Cancelación" value={cancelPolicy === "anytime" ? "Cuando quieras" : cancelPolicy} />
          <Info label="Pagado hasta" value={paidForMonth || "—"} />
        </div>

        {lastPaidAt && (
          <p className="text-xs text-gray-500 mb-5">
            Último pago registrado: {new Date(lastPaidAt).toLocaleString()} {lastPaidBy ? `por ${lastPaidBy}` : ""}
          </p>
        )}

        {status !== "paid" ? (
          <button
            onClick={markPaid}
            disabled={busy}
            className="w-full px-8 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? "Guardando…" : `Marcar como pagado (${month})`}
          </button>
        ) : (
          <div className="text-center text-green-400 font-semibold py-2">✅ Pagado para {month}</div>
        )}
      </div>
    </div>
  );
}
