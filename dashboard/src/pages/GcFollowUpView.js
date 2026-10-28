import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const PERIODS = [
  { value: '7', label: '7d' },
  { value: '15', label: '15d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: 'all', label: 'Todo' },
];

// §5 of the campaign spec — what the customer's answer meant.
const OUTCOME = {
  interesado: { label: 'Sigue interesado', color: '#4caf50' },
  otra_medida: { label: 'Buscaba otra medida', color: '#3b82f6' },
  inconformidad: { label: 'Inconformidad', color: '#f5a623' },
  no_interesado: { label: 'Ya no quiere', color: '#9ca3af' },
  otro: { label: 'Otro', color: '#8b5cf6' },
};

// §8 — why they had stalled, as read by the AI from what they actually wrote.
const REASON = {
  precio: { label: 'Precio', color: '#f44336' },
  medidas: { label: 'Medidas', color: '#3b82f6' },
  atencion: { label: 'Atención', color: '#f5a623' },
  informacion: { label: 'Información insuficiente', color: '#8b5cf6' },
  otros: { label: 'Otros', color: '#6b7280' },
};

// Why a conversation was passed over (§3.3 / §4). Shown so the campaign's silence is
// accountable: a follow-up not sent is a decision, not a gap.
const SKIP = {
  excluido: 'Excluido por lo que dijo el cliente',
  no_pendiente: 'La IA no la consideró pendiente',
  el_bot_no_contesto_el_ultimo_mensaje: 'El bot le debe una respuesta',
  sin_mensajes_del_cliente: 'El cliente nunca escribió',
  envio_fallido: 'Falló el envío',
};

// Where the conversation stopped — OBSERVED, not stated. Deterministic: it is the
// last thing WE said before the customer went quiet, so it needs no inference about
// motive and it covers every conversation, not only the few that explained themselves.
const STALL = {
  pidio_cp_o_datos: { label: 'Le pedimos sus datos (CP, colonia, nombre)', color: '#f5a623' },
  pidio_medida: { label: 'Le preguntamos la medida', color: '#3b82f6' },
  precio_cotizado: { label: 'Le cotizamos el precio', color: '#f44336' },
  link_compartido: { label: 'Le compartimos el link de compra', color: '#8b5cf6' },
  catalogo_o_info: { label: 'Le dimos información del producto', color: '#06b6d4' },
  handoff: { label: 'Lo pasamos con un especialista', color: '#10b981' },
  sin_respuesta_nuestra: { label: 'Escribió y NO le contestamos', color: '#ef4444' },
  otro: { label: 'Otro', color: '#6b7280' },
};

const CATEGORY_CHIP = {
  precio: 'bg-red-500/10 text-red-300 border-red-500/30',
  medidas: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  atencion: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  informacion: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  otros: 'bg-gray-500/10 text-gray-300 border-gray-500/30',
};

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="text-gray-400 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: color || '#fff' }}>{value}</div>
      {sub ? <div className="text-gray-500 text-xs mt-1">{sub}</div> : null}
    </div>
  );
}

// "¿Por qué los clientes ya no están interesados?" (the client's question). TWO
// SOURCES, SHOWN APART AND NEVER ADDED TOGETHER:
//   • lo que DIJERON — themes grouped out of the customers' own words, each with the
//     verbatim quotes it was built from. Every quote is checked against the message it
//     is attributed to before it reaches this screen; an unverifiable one is dropped
//     and counted, which is why the "descartados" line exists.
//   • dónde se DETUVIERON — the last thing we said before they went quiet. A fact, no
//     inference, and it covers everyone rather than the minority who explain
//     themselves.
function ReasonsSection({ period, sentCount }) {
  const [scope, setScope] = useState(sentCount > 0 ? 'followup' : 'convo');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState({});

  const load = useCallback(async (refresh) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const from = period === 'all' ? '' : `&from=${new Date(Date.now() - Number(period) * 864e5).toISOString()}`;
      const res = await fetch(`${API_URL}/gc-follow-up/reasons?scope=${scope}${from}${refresh ? '&refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(await res.json());
    } catch (e) {
      setData({ success: false, error: 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  }, [period, scope]);

  useEffect(() => { load(false); }, [load]);

  const clusters = data?.clusters || [];
  const stalls = data?.stalls?.buckets || [];
  const maxStall = Math.max(1, ...stalls.map((b) => b.count));

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold">¿Por qué no continuaron?</h2>
          <p className="text-gray-500 text-xs mt-1">
            Agrupado a partir de lo que los clientes escribieron. Cada tema trae sus citas textuales;
            una cita que no se puede verificar en el mensaje del cliente se descarta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-gray-900/50 border border-gray-700/50 rounded-lg p-1">
            {[
              { v: 'followup', l: 'Respuestas al seguimiento' },
              { v: 'convo', l: 'Conversaciones que se enfriaron' },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setScope(o.v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  scope === o.v ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900/50 border border-gray-700/50 text-gray-300 hover:text-white disabled:opacity-50"
          >
            {loading ? '…' : 'Recalcular'}
          </button>
        </div>
      </div>

      {data?.error ? <p className="text-red-400 text-sm">{data.error}</p> : null}

      {!loading && data?.empty && (
        <p className="text-gray-500 text-sm">
          {scope === 'followup'
            ? 'Todavía no hay respuestas al seguimiento que analizar — el envío está apagado.'
            : 'No hay conversaciones de Ground Cover en este periodo.'}
        </p>
      )}

      {!data?.empty && !data?.error && (
        <>
          <div className="text-xs text-gray-400">
            Leídos <strong className="text-white">{data?.read || 0}</strong>
            {data?.truncated ? ` de ${data?.total} (los más recientes)` : ''} ·{' '}
            <strong className="text-white">{data?.stated || 0}</strong> expresaron un motivo ({data?.statedPct || 0}%) ·{' '}
            {data?.sinMotivo?.length || 0} no dijeron por qué
            {data?.unassigned?.length ? ` · ${data.unassigned.length} sin clasificar` : ''}
            {data?.cached ? ' · en caché' : ''}
          </div>

          {clusters.length === 0 ? (
            <p className="text-gray-500 text-sm">
              Ningún cliente expresó un motivo en este periodo. No inventamos uno: lo que sí sabemos está abajo.
            </p>
          ) : (
            <div className="space-y-3">
              {clusters.map((c) => (
                <div key={c.label} className="bg-gray-900/40 border border-gray-700/50 rounded-lg p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-white font-medium">{c.label}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[11px] border ${CATEGORY_CHIP[c.category] || CATEGORY_CHIP.otros}`}>
                      {REASON[c.category]?.label || c.category}
                    </span>
                    <span className="ml-auto text-sm text-gray-300">
                      {c.count} cliente{c.count === 1 ? '' : 's'}
                      {data?.read ? <span className="text-gray-500"> · {Math.round((c.count / data.read) * 1000) / 10}%</span> : null}
                    </span>
                  </div>
                  {c.summary ? <p className="text-gray-400 text-xs mt-1">{c.summary}</p> : null}
                  {c.quotes?.length ? (
                    <ul className="mt-2 space-y-1">
                      {c.quotes.map((q, i) => (
                        <li key={i} className="text-sm text-gray-300 border-l-2 border-gray-600 pl-2 italic">
                          «{q.quote}»{q.name ? <span className="text-gray-500 not-italic"> — {q.name}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [c.label]: !o[c.label] }))}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {open[c.label] ? 'Ocultar' : `Ver los ${c.count} clientes`}
                  </button>
                  {open[c.label] && (
                    <div className="mt-2 space-y-1">
                      {c.members.map((m) => (
                        <div key={m.id} className="text-xs text-gray-400 flex flex-wrap gap-2">
                          <a href={`/messages?psid=${encodeURIComponent(m.id)}`} className="text-blue-400 hover:text-blue-300 shrink-0">
                            {m.name || m.id}
                          </a>
                          <span className="text-gray-500 shrink-0">{fmtDateTime(m.at)}</span>
                          <span className="text-gray-400">{m.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {data?.dropped && (data.dropped.quotes || data.dropped.members || data.dropped.duplicates || data.dropped.clusters) ? (
            <p className="text-[11px] text-gray-600">
              Descartados por no poder verificarse: {data.dropped.quotes} cita(s), {data.dropped.members} miembro(s),{' '}
              {data.dropped.duplicates} duplicado(s), {data.dropped.clusters} tema(s) vacío(s).
            </p>
          ) : null}

          {stalls.length > 0 && (
            <div className="pt-4 border-t border-gray-700/50">
              <h3 className="text-white text-sm font-semibold">Dónde se detuvo la conversación</h3>
              <p className="text-gray-500 text-xs mt-1 mb-3">
                Observado, no declarado: lo último que le dijimos antes de que dejara de contestar.
                Son {data?.stalls?.read || 0} conversaciones de Ground Cover — no se suma con los motivos de arriba.
              </p>
              <div className="space-y-2">
                {stalls.map((b) => (
                  <div key={b.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{STALL[b.key]?.label || b.key}</span>
                      <span className="text-gray-400">
                        {b.count} · {b.pct}%
                        {b.short ? <span className="text-gray-600"> · {b.short} nunca pasó del primer intercambio</span> : null}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(b.count / maxStall) * 100}%`, backgroundColor: STALL[b.key]?.color || '#6b7280' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GcFollowUpView() {
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const qs = period === 'all'
        ? ''
        : `?from=${new Date(Date.now() - Number(period) * 864e5).toISOString()}`;
      const res = await fetch(`${API_URL}/gc-follow-up/stats${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) setData(json);
      else setError(json.error || 'Error al cargar los seguimientos');
    } catch (e) {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // The switch itself lives in SystemState (Spec Ops). It is offered here too, because
  // this is the page where you can see exactly who would be messaged — deciding to turn
  // it on anywhere else means deciding blind.
  const toggle = async (engage) => {
    if (engage && !window.confirm(
      'Se enviará UN mensaje de seguimiento a cada conversación de Ground Cover que lleve 23 h sin respuesta ' +
      'y que el sistema considere pendiente (lunes a viernes 7:00–20:00; sábados hasta las 14:00; domingos no se ' +
      'envía nada). Son mensajes reales a clientes reales. ¿Activar?'
    )) return;
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/spec-ops/gc-follow-up`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ engage }),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'No se pudo cambiar el interruptor');
      else setError(null);
      fetchData();
    } catch (e) {
      setError('Error de conexión');
    } finally {
      setBusy(false);
    }
  };

  // A dry run answers "who would get a message if I turned this on?" without sending
  // anything — the only safe way to inspect the campaign before engaging it.
  const runDry = async () => {
    setBusy(true);
    setDryRun(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/gc-follow-up/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await res.json();
      setDryRun(json.success ? json : { error: json.error });
      fetchData();
    } catch (e) {
      setDryRun({ error: 'Error de conexión' });
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (filter === 'all') return all;
    if (filter === 'replied') return all.filter((r) => r.repliedAt);
    if (filter === 'silent') return all.filter((r) => !r.repliedAt);
    return all.filter((r) => r.outcome === filter);
  }, [data, filter]);

  const outcomeData = useMemo(() => Object.entries(data?.outcomes || {})
    .map(([k, v]) => ({ key: k, name: OUTCOME[k]?.label || k, value: v, color: OUTCOME[k]?.color || '#6b7280' }))
    .sort((a, b) => b.value - a.value), [data]);

  const reasonData = useMemo(() => Object.entries(data?.reasons || {})
    .map(([k, v]) => ({
      key: k, name: REASON[k]?.label || k, value: v,
      pct: data?.reasonPct?.[k] || 0, color: REASON[k]?.color || '#6b7280',
    }))
    .sort((a, b) => b.value - a.value), [data]);

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" />
          <p className="mt-4 text-gray-400">Cargando seguimientos…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-400">{error}</div>
      </div>
    );
  }

  const skipEntries = Object.entries(data?.skipped || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Seguimiento · Ground Cover</h1>
          <p className="text-gray-400 text-sm mt-1">
            Un mensaje, {data?.waitHours || 23} h después del último mensaje del cliente ·
            lunes a viernes {data?.window?.openHour ?? 7}:00–{data?.window?.closeHour ?? 20}:00,
            sábados hasta las {data?.window?.saturdayCloseHour ?? 14}:00 (hora del centro)
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Si las {data?.waitHours || 23} h caen más tarde un sábado, se envía antes de las{' '}
            {data?.window?.saturdayCloseHour ?? 14}:00 — lo que pase primero. Las que vencen en domingo se dejan ir.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  period === p.value ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={runDry}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800/50 border border-gray-700/50 text-gray-300 hover:text-white hover:bg-gray-700/50 disabled:opacity-50"
            title="Muestra a quién se le enviaría, sin enviar nada"
          >
            {busy ? 'Revisando…' : 'Simular envío'}
          </button>
        </div>
      </div>

      {/* The switch state — the whole campaign is off until it's engaged in Spec Ops */}
      <div className={`rounded-xl p-4 border ${data?.enabled
        ? 'bg-green-500/10 border-green-500/30 text-green-300'
        : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'}`}>
        <div className="flex items-start gap-3">
          <span className="text-lg leading-none mt-0.5">{data?.enabled ? '🟢' : '⏸️'}</span>
          <div className="text-sm">
            {data?.enabled ? (
              <>
                <strong>Seguimiento activo.</strong> El sistema envía un único mensaje por conversación pendiente
                {data?.window?.inWindowNow
                  ? ' (ahora está dentro del horario permitido).'
                  : ` (ahora está FUERA del horario; el siguiente envío posible es ${data?.window?.nextOpenAt
                      ? new Date(data.window.nextOpenAt).toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
                      : 'a las 7:00'}).`}
              </>
            ) : (
              <>
                <strong>Seguimiento apagado.</strong> No se está enviando ningún mensaje.
                Usa <em>Simular envío</em> para ver a quién le llegaría antes de activarlo.
              </>
            )}
          </div>
          <button
            onClick={() => toggle(!data?.enabled)}
            disabled={busy}
            className={`ml-auto shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${
              data?.enabled
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {busy ? '…' : data?.enabled ? 'Apagar' : 'Activar'}
          </button>
        </div>
      </div>

      {dryRun && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-sm">
          {dryRun.error ? (
            <span className="text-red-400">{dryRun.error}</span>
          ) : (
            <div className="text-gray-300">
              <strong className="text-white">Simulación:</strong>{' '}
              {dryRun.send?.sent || 0} conversación(es) recibirían el seguimiento ahora
              {dryRun.send?.deferred === -1 && ' — pero estamos fuera del horario permitido'}
              {dryRun.send?.considered != null && ` · ${dryRun.send.considered} evaluadas`}
              {Object.keys(dryRun.send?.skipped || {}).length > 0 && (
                <> · omitidas: {Object.entries(dryRun.send.skipped).map(([k, v]) => `${k} (${v})`).join(', ')}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* §8 — the indicators */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Seguimientos enviados" value={data?.sent || 0} />
        <Stat
          label="Respondieron"
          value={`${data?.replied || 0}`}
          sub={`${data?.repliedPct || 0}% de los enviados`}
          color="#4caf50"
        />
        <Stat
          label="No respondieron"
          value={`${data?.notReplied || 0}`}
          sub={`${data?.notRepliedPct || 0}% de los enviados`}
          color="#9ca3af"
        />
        <Stat
          label="Retomaron interés"
          value={`${data?.recovered || 0}`}
          sub={`${data?.recoveredPct || 0}% · siguen interesados o buscaban otra medida`}
          color="#3b82f6"
        />
      </div>

      {(data?.sent || 0) === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-8 text-center text-gray-400">
          Todavía no se ha enviado ningún seguimiento en este periodo.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* §5 — what the answers meant */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-white font-semibold mb-1">Qué contestaron</h2>
            <p className="text-gray-500 text-xs mb-4">De los {data?.replied || 0} que respondieron</p>
            {outcomeData.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin respuestas analizadas todavía.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={outcomeData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                  <XAxis type="number" stroke="#9ca3af" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#9ca3af" width={130} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                    formatter={(v) => [`${v} cliente(s)`, 'Total']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {outcomeData.map((d) => <Cell key={d.key} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* §8 — the reasons they had stalled */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-white font-semibold mb-1">Por qué no habían continuado</h2>
            <p className="text-gray-500 text-xs mb-4">
              Sólo cuando el cliente lo expresó — la IA no infiere motivos que nadie dijo
            </p>
            {reasonData.length === 0 ? (
              <p className="text-gray-500 text-sm">Ningún cliente ha expresado un motivo todavía.</p>
            ) : (
              <div className="space-y-3">
                {reasonData.map((d) => (
                  <div key={d.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{d.name}</span>
                      <span className="text-gray-400">{d.value} · {d.pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: d.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* The client's question, 2026-10-28: why are they not interested anymore */}
      <ReasonsSection period={period} sentCount={data?.sent || 0} />

      {/* §3.3 / §4 — the conversations we deliberately did NOT message */}
      {skipEntries.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-1">Conversaciones omitidas</h2>
          <p className="text-gray-500 text-xs mb-4">
            Pendientes que el sistema decidió no contactar. No enviar también es una decisión.
          </p>
          <div className="flex flex-wrap gap-2">
            {skipEntries.map(([k, v]) => (
              <span key={k} className="px-3 py-1.5 rounded-lg text-xs bg-gray-900/50 border border-gray-700/50 text-gray-300">
                {SKIP[k] || k} · <strong className="text-white">{v}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* The rows themselves (§6) */}
      {(data?.sent || 0) > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="p-4 flex flex-wrap items-center gap-2 border-b border-gray-700/50">
            <h2 className="text-white font-semibold mr-2">Detalle</h2>
            {[
              { value: 'all', label: 'Todos' },
              { value: 'replied', label: 'Respondieron' },
              { value: 'silent', label: 'Sin respuesta' },
              ...Object.entries(OUTCOME).map(([k, v]) => ({ value: k, label: v.label })),
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-900/50 text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Cliente</th>
                  <th className="text-left px-4 py-2 font-medium">Enviado</th>
                  <th className="text-left px-4 py-2 font-medium">Respondió</th>
                  <th className="text-left px-4 py-2 font-medium">Qué dijo</th>
                  <th className="text-left px-4 py-2 font-medium">Resultado</th>
                  <th className="text-left px-4 py-2 font-medium">Motivo</th>
                  <th className="text-left px-4 py-2 font-medium">Tema</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Nada que mostrar con este filtro.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.psid} className="border-t border-gray-700/30 hover:bg-gray-700/20">
                    <td className="px-4 py-2">
                      <a
                        href={`/messages?psid=${encodeURIComponent(r.psid)}`}
                        className="text-blue-400 hover:text-blue-300"
                        title={r.psid}
                      >
                        {r.name || r.psid}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{fmtDateTime(r.sentAt)}</td>
                    <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                      {r.repliedAt ? fmtDateTime(r.repliedAt) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-300 max-w-xs truncate" title={r.replyText || ''}>
                      {r.replyText || <span className="text-gray-600">Sin respuesta</span>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.outcome ? (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs"
                          style={{
                            color: OUTCOME[r.outcome]?.color,
                            backgroundColor: `${OUTCOME[r.outcome]?.color}22`,
                            border: `1px solid ${OUTCOME[r.outcome]?.color}`,
                          }}
                        >
                          {OUTCOME[r.outcome]?.label || r.outcome}
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-400" title={r.reasonNote || ''}>
                      {r.reasonCategory ? (REASON[r.reasonCategory]?.label || r.reasonCategory) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {r.clusterLabel || <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default GcFollowUpView;
