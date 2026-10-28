// pages/AiUsageView.js
//
// Costos IA — SUPER_ADMIN ONLY.
// Real OpenAI spend from the AiUsage telemetry (one record per API call). Shows
// windowed totals, the TRUE cost-per-conversation, a daily spend chart, and a
// per-model breakdown — in USD and MXN. Replaces the hand estimates.
import React, { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import API from "../api";

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

const DEFAULT_FX = 17.56; // USD→MXN fallback if the live rate can't be fetched

const usd = (n) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mxn = (n) => `$${(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
const int = (n) => (n || 0).toLocaleString("es-MX");

function Card({ label, primary, secondary, hint }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{primary}</div>
      {secondary && <div className="text-sm text-gray-300 mt-0.5">{secondary}</div>}
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

export default function AiUsageView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fx, setFx] = useState(DEFAULT_FX);
  const [fxDate, setFxDate] = useState(null);
  // Prepaid credit. No API returns it (a sk-proj- key gets 403 and the credit endpoint
  // is browser-only), so the balance is typed in here from platform.openai.com and then
  // drawn down by our own per-call costs — an estimate, labelled as one.
  const [credit, setCredit] = useState(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [savingCredit, setSavingCredit] = useState(false);

  // Live USD→MXN rate (editable). Falls back silently to DEFAULT_FX.
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.rates?.MXN) {
          setFx(j.rates.MXN);
          setFxDate(j.date || null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/ai-usage/summary?days=${days}`);
      setData(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.error || "No se pudieron cargar los costos");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const loadCredit = useCallback(async () => {
    try {
      const res = await API.get("/spec-ops/status");
      const c = res.data?.openAiCredit || null;
      setCredit(c);
      if (c?.thresholdUsd != null && thresholdInput === "") setThresholdInput(String(c.thresholdUsd));
    } catch {
      /* the page still works without it */
    }
  }, [thresholdInput]);

  useEffect(() => {
    loadCredit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCredit = async (payload, okMsg) => {
    setSavingCredit(true);
    try {
      const res = await API.post("/spec-ops/openai-credit", payload);
      setCredit(res.data?.openAiCredit || null);
      setBalanceInput("");
      toast.success(okMsg);
    } catch (e) {
      toast.error(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setSavingCredit(false);
    }
  };

  const t = data?.totals || {};
  const totalUsd = t.costUsd || 0;
  const perConvoUsd = data?.costPerConvoUsd || 0;
  const conversations = data?.conversations || 0;
  const chartData = (data?.daily || []).map((d) => ({
    date: d.date?.slice(5), // MM-DD
    mxn: +(d.costUsd * fx).toFixed(2),
    usd: d.costUsd,
    calls: d.calls,
  }));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">Costos IA</h1>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                days === r.days
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-400 -mt-3">
        Gasto real de OpenAI (telemetría por llamada). Costo por conversación = gasto ÷ conversaciones activas en el periodo.
      </p>

      {/* Prepaid credit — the number that decides whether the bot keeps answering. */}
      <div className={`rounded-xl p-5 border ${credit?.low ? "bg-amber-500/10 border-amber-500/50" : "bg-gray-800/50 border-gray-700/50"}`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Crédito OpenAI restante (estimado)</div>
            {credit?.configured ? (
              <>
                <div className={`text-3xl font-bold mt-1 ${credit.low ? "text-amber-400" : "text-white"}`}>
                  {usd(credit.remaining)}
                  {credit.daysLeft != null && (
                    <span className="text-base font-medium text-gray-400 ml-2">· ~{credit.daysLeft.toFixed(1)} días</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Saldo capturado {usd(credit.balanceUsd)} el {new Date(credit.asOf).toLocaleString("es-MX")} − {usd(credit.spentSince)} gastados desde entonces.
                  {credit.burnPerDay != null
                    ? ` Ritmo: ${usd(credit.burnPerDay)}/día.`
                    : " El ritmo diario aparece cuando haya 24 h de telemetría (la medición por llamada empezó el 27/10/2026)."}
                </div>
                <div className="text-xs text-gray-500">
                  Es un estimado: OpenAI no expone el saldo por API. Vuelve a capturarlo cuando lo consultes o recargues.
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-300 mt-1">
                Sin saldo capturado. Míralo en{" "}
                <a className="text-indigo-400 underline" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">
                  platform.openai.com
                </a>{" "}
                y escríbelo aquí para activar la alerta.
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Saldo actual (USD)</label>
              <input
                type="number" step="0.01" min="0" value={balanceInput} placeholder="16.76"
                onChange={(e) => setBalanceInput(e.target.value)}
                className="w-28 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => saveCredit({ balanceUsd: parseFloat(balanceInput) }, "Saldo actualizado")}
              disabled={savingCredit || balanceInput === "" || isNaN(parseFloat(balanceInput))}
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Guardar
            </button>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Avisarme en (USD)</label>
              <input
                type="number" step="0.5" min="0" value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="w-24 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => saveCredit({ thresholdUsd: parseFloat(thresholdInput) }, "Umbral actualizado")}
              disabled={savingCredit || thresholdInput === "" || isNaN(parseFloat(thresholdInput))}
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-gray-700 text-gray-100 hover:bg-gray-600 disabled:opacity-40"
            >
              Guardar umbral
            </button>
          </div>
        </div>
      </div>

      {/* FX control */}
      <div className="flex items-center gap-2 text-sm text-gray-300">
        <span>Tipo de cambio USD→MXN:</span>
        <input
          type="number"
          step="0.01"
          value={fx}
          onChange={(e) => setFx(parseFloat(e.target.value) || 0)}
          className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {fxDate && <span className="text-xs text-gray-500">(frankfurter, {fxDate})</span>}
      </div>

      {loading ? (
        <div className="flex justify-center min-h-[40vh] items-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-400"></div>
        </div>
      ) : (
        <>
          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card
              label={`Gasto total (${days}d)`}
              primary={mxn(totalUsd * fx)}
              secondary={usd(totalUsd)}
            />
            <Card
              label="Costo por conversación"
              primary={mxn(perConvoUsd * fx)}
              secondary={usd(perConvoUsd)}
              hint={`${int(conversations)} conversaciones`}
            />
            <Card
              label="Llamadas a la IA"
              primary={int(t.calls)}
              secondary={`${int(t.totalTokens)} tokens`}
            />
            <Card
              label="Tokens de razonamiento"
              primary={int(t.reasoningTokens)}
              secondary={`${int(t.cachedTokens)} en caché`}
              hint="reasoning se cobra como salida"
            />
          </div>

          {/* Daily chart */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="text-sm font-semibold text-gray-200 mb-3">Gasto diario (MXN)</div>
            {chartData.length === 0 ? (
              <div className="text-gray-500 text-sm py-10 text-center">Sin datos en este periodo todavía.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} stroke="#4b5563" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} width={48} stroke="#4b5563" />
                  <Tooltip
                    contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, color: "#e5e7eb" }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v, name) => (name === "mxn" ? [mxn(v), "Gasto"] : [v, name])}
                    labelFormatter={(l) => `Día ${l}`}
                  />
                  <Bar dataKey="mxn" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* By-model table */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="text-sm font-semibold text-gray-200 px-4 py-3 border-b border-gray-700/50">
              Desglose por modelo
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700/50">
                    <th className="px-4 py-2 font-medium">Modelo</th>
                    <th className="px-4 py-2 font-medium text-right">Gasto (MXN)</th>
                    <th className="px-4 py-2 font-medium text-right">Gasto (USD)</th>
                    <th className="px-4 py-2 font-medium text-right">% del total</th>
                    <th className="px-4 py-2 font-medium text-right">Llamadas</th>
                    <th className="px-4 py-2 font-medium text-right">Tokens ent.</th>
                    <th className="px-4 py-2 font-medium text-right">Tokens sal.</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byModel || []).map((m) => (
                    <tr key={m.model} className="border-b border-gray-800 last:border-0">
                      <td className="px-4 py-2 font-medium text-gray-100">{m.model}</td>
                      <td className="px-4 py-2 text-right text-gray-200">{mxn(m.costUsd * fx)}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{usd(m.costUsd)}</td>
                      <td className="px-4 py-2 text-right text-gray-400">
                        {totalUsd > 0 ? `${((m.costUsd / totalUsd) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400">{int(m.calls)}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{int(m.promptTokens)}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{int(m.completionTokens)}</td>
                    </tr>
                  ))}
                  {(!data?.byModel || data.byModel.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        Sin datos todavía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            La telemetría se registra por llamada desde el {data?.window?.since ? new Date(data.window.since).toLocaleDateString("es-MX") : "inicio"} del periodo. Costos calculados con precios vigentes por modelo (entrada/salida, con descuento de caché).
          </p>
        </>
      )}
    </div>
  );
}
