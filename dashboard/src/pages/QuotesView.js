// pages/QuotesView.js — Cotizaciones: every quote an asesor recorded on a
// conversation the bot handed over (folio, items, customer, the ad it came from).
// Quotes are recorded from the chat ("Cotizar"); this page is the list.
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";

const fmtDate = (d) =>
  new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function QuotesView() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [totals, setTotals] = useState({ quotes: 0, conversations: 0 });
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 30 };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = `${dateFrom}T00:00:00.000-06:00`;
      if (dateTo) params.dateTo = `${dateTo}T23:59:59.999-06:00`;
      const res = await API.get("/quotes", { params });
      setQuotes(res.data.quotes || []);
      setTotals(res.data.totals || { quotes: 0, conversations: 0 });
      setPagination(res.data.pagination || { total: 0, pages: 1 });
    } catch (err) {
      setError(err.response?.data?.error || "No se pudieron cargar las cotizaciones");
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const input = "bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Cotizaciones</h1>
        <p className="text-sm text-gray-400 mt-1">
          Conversaciones que pasaron a una persona y se cotizaron. Se registran desde el chat con el botón “Cotizar”.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase">Cotizaciones</p>
          <p className="text-2xl font-bold text-sky-400">{totals.quotes.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase">Conversaciones cotizadas</p>
          <p className="text-2xl font-bold text-white">{totals.conversations.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-gray-400 mb-1">Buscar</label>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Número de cotización, cliente o producto"
            className={`${input} w-full`}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={input} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={input} />
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-x-auto">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : quotes.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">
            {search || dateFrom || dateTo ? "Ninguna cotización coincide con el filtro." : "Todavía no hay cotizaciones registradas."}
          </p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-4 py-3">Cotización</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Productos cotizados</th>
                <th className="px-4 py-3">Anuncio</th>
                <th className="px-4 py-3">Registró</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {quotes.map((q) => (
                <tr key={q._id} className="hover:bg-gray-700/20 align-top">
                  <td className="px-4 py-3 text-sm text-sky-300 font-mono font-semibold whitespace-nowrap">#{q.quoteNumber}</td>
                  <td className="px-4 py-3 text-xs text-gray-300 whitespace-nowrap">{fmtDate(q.createdAt)}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{q.customer?.name || "Sin nombre"}</p>
                    <p className="text-xs text-gray-500">
                      {q.customer?.channel === "whatsapp" ? "WhatsApp" : "Facebook"}
                      {q.customer?.phone ? ` · ${q.customer.phone}` : ""}
                      {q.customer?.city ? ` · ${q.customer.city}${q.customer.state ? `, ${q.customer.state}` : ""}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-0.5">
                      {(q.items || []).map((it, i) => (
                        <li key={i} className="text-xs text-gray-300 leading-snug">
                          <span className="text-gray-500">{it.qty} ×</span> {it.label}
                          {!it.productId && <span className="text-amber-400/80"> · fuera de catálogo</span>}
                        </li>
                      ))}
                    </ul>
                    {q.note && <p className="text-[11px] text-gray-500 italic mt-1">{q.note}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-300 max-w-[200px]">
                    {q.origin?.organic || !q.origin ? <span className="text-gray-500">Orgánico</span> : q.origin.label}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{q.by || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/conversations?psid=${encodeURIComponent(q.psid)}`)}
                      className="px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20 rounded-lg whitespace-nowrap"
                    >
                      Ver chat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-4 text-sm text-gray-400">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg bg-gray-700 text-white disabled:opacity-40">Anterior</button>
          <span>Página {page} de {pagination.pages}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg bg-gray-700 text-white disabled:opacity-40">Siguiente</button>
        </div>
      )}
    </div>
  );
}
