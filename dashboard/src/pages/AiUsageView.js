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
