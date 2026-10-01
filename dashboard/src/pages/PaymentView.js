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

// One labelled input in the plan-terms form.
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">{label}</div>
      {children}
      {hint && <div className="text-gray-600 text-xs mt-1">{hint}</div>}
    </label>
  );
}

const inputCls =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 focus:outline-none";

export default function PaymentView() {
  const { refreshBanner } = useAuth();
  const [payment, setPayment] = useState(null);
  const [plan, setPlan] = useState(null);     // saved values, for the "sin guardar" check
  const [form, setForm] = useState(null);     // what's in the inputs
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  const load = async () => {
    try {
      const [st, pl] = await Promise.all([
        API.get("/spec-ops/status"),
        API.get("/spec-ops/plan").catch(() => null), // super_admin only
      ]);
      setPayment(st.data?.payment || null);
      if (pl?.data?.plan) {
        setPlan(pl.data.plan);
        setForm(pl.data.plan);
      }
    } catch (e) {
      toast.error("No se pudo leer el estado");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const savePlan = async () => {
    setSavingPlan(true);
    try {
      const res = await API.put("/spec-ops/plan", form);
      setPlan(res.data?.plan || form);
      setForm(res.data?.plan || form);
      if (res.data?.payment) setPayment(res.data.payment);
      if (refreshBanner) refreshBanner();
      toast.success("Plan actualizado");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo guardar el plan");
    } finally {
      setSavingPlan(false);
    }
  };

  const dirty = !!(plan && form) && Object.keys(plan).some((k) => String(plan[k]) !== String(form[k]));

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

      {form && (
        <div className="rounded-2xl border border-gray-700 bg-gray-900/40 p-8 mt-6">
          <h2 className="text-lg font-bold text-white mb-1">Condiciones del plan</h2>
          <p className="text-gray-400 text-sm mb-6">
            Lo que el cliente tiene contratado. Las conversaciones incluidas son las que mide el
            medidor de <strong>Consumo</strong>: si aquí dice más de lo que paga, se le está
            regalando la diferencia cada mes.
          </p>

          <div className="grid grid-cols-2 gap-5 mb-6">
            <div className="col-span-2">
              <Field label="Nombre del plan">
                <input className={inputCls} value={form.name} onChange={setField("name")} />
              </Field>
            </div>

            <Field label="Conversaciones incluidas" hint="Al mes. Es el límite del medidor de Consumo.">
              <input type="number" min="1" className={inputCls} value={form.monthlyLimit} onChange={setField("monthlyLimit")} />
            </Field>

            <Field label="Precio mensual">
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.price} onChange={setField("price")} />
                <input className={`${inputCls} w-24`} value={form.priceCurrency} onChange={setField("priceCurrency")} />
              </div>
            </Field>

            <Field label="Conversación extra" hint="Lo que se cobra por cada una arriba del límite.">
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.overageRate} onChange={setField("overageRate")} />
                <input className={`${inputCls} w-24`} value={form.currency} onChange={setField("currency")} />
              </div>
            </Field>

            <Field label="Día de pago" hint="Del 1 al 28.">
              <input type="number" min="1" max="28" className={inputCls} value={form.dueDay} onChange={setField("dueDay")} />
            </Field>
          </div>

          <button
            onClick={savePlan}
            disabled={savingPlan || !dirty}
            className="w-full px-8 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold disabled:opacity-40 transition-all active:scale-95"
          >
            {savingPlan ? "Guardando…" : dirty ? "Guardar condiciones" : "Sin cambios"}
          </button>
        </div>
      )}
    </div>
  );
}
