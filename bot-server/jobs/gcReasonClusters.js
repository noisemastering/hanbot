// jobs/gcReasonClusters.js
//
// "WHY ARE CUSTOMERS NOT INTERESTED ANYMORE?" (the client's question, 2026-10-28.)
//
// §8 of the campaign document already counts five FIXED buckets — precio, medidas,
// atención, información, otros — one per answered follow-up. That tells you the shape
// of the problem and nothing about its content: "precio: 30%" does not say whether
// they found it dear against Mercado Libre, against another supplier, or against what
// they expected to pay for a 100 m roll. This module does the other half: it reads
// what the customers actually WROTE and groups it into themes that come out of the
// text instead of out of our list, each one carrying the verbatim quotes it was built
// from and the conversations it covers.
//
// TWO SCOPES, NEVER MIXED:
//   • "followup"  — answers to the follow-up message. These are motives the customer
//                   STATED, in reply to being asked. This is the one the document
//                   describes.
//   • "convo"     — Ground Cover conversations that simply went cold, read from the
//                   customer's own last words. The campaign switch is still off, so
//                   this is the only scope with data today — and it answers the
//                   client's question from traffic we already have.
// They are returned separately and never added together: one is what people said when
// asked, the other is what they happened to say before going quiet. Adding them would
// make a number nobody could interpret.
//
// THE MODEL IS NEVER TRUSTED ON ITS OWN. Every cluster it proposes is verified against
// the input before it is counted: a member id that was not in the input is dropped, an
// item can belong to only one cluster, and a quote that is not actually in that
// customer's text is discarded (the member stays, the quote goes). Items the model
// leaves unassigned are reported as "sin clasificar" rather than silently vanishing,
// so the counts always add up to what was read. The client's own constraint is the
// reason: "sin asumir motivos que el cliente no haya expresado" — and a cluster with
// an invented quote under it is exactly how a dashboard starts lying.
//
// NOT EVERY CUSTOMER GIVES A REASON, and that is a finding, not a gap: items where
// nothing was stated land in `sinMotivo`, counted and never guessed at.

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const SystemState = require("../models/SystemState");
const crypto = require("crypto");

// How many texts go into one clustering call. Bounded because this runs against a
// prepaid OpenAI balance (see the low-credit watch): 120 short texts is one ~15k-token
// call, and the newest are the ones worth reading. The cap is reported in the result,
// so a partial read can never look like a full one.
const MAX_ITEMS = 120;
const MAX_TEXT = 320;
// The fixed §8 buckets. Every emergent cluster is also mapped onto one of these, so
// the document's five numbers and these themes can never tell different stories.
const CATEGORIES = ["precio", "medidas", "atencion", "informacion", "otros"];

const GC_RE = /ground[\s_-]*cover|anti[\s_-]*maleza/i;

function hashItems(scope, items) {
  const h = crypto.createHash("sha1");
  h.update(scope);
  for (const it of items) h.update(`${it.id}|${it.text}`);
  return h.digest("hex").slice(0, 16);
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ─────────────────────────────────────────────────────────────────────────────
// WHAT GETS READ
// ─────────────────────────────────────────────────────────────────────────────

/** Answers to the follow-up message (§6 rows that have a reply). */
async function followUpItems(range = {}) {
  const q = { "gcFollowUp.repliedAt": { $ne: null } };
  if (range.from) q["gcFollowUp.sentAt"] = { $gte: new Date(range.from) };
  if (range.to) q["gcFollowUp.sentAt"] = { ...(q["gcFollowUp.sentAt"] || {}), $lte: new Date(range.to) };
  const rows = await Conversation.find(q)
    .select("psid extractedName gcFollowUp")
    .sort({ "gcFollowUp.repliedAt": -1 })
    .limit(MAX_ITEMS)
    .lean();
  return {
    total: await Conversation.countDocuments(q),
    items: rows.map((r) => ({
      id: r.psid,
      name: r.extractedName || null,
      at: r.gcFollowUp.repliedAt,
      text: String(r.gcFollowUp.replyText || "").slice(0, MAX_TEXT),
      outcome: r.gcFollowUp.outcome || null,
    })),
  };
}

/**
 * Ground Cover conversations that went cold, read from the CUSTOMER's last words.
 * Their last two messages: the last one alone is often "ok" or a measure, and the
 * motive — when there is one — tends to sit in the message before it.
 */
async function convoItems(range = {}) {
  const q = {
    $or: [{ currentFlow: GC_RE }, { productInterest: GC_RE }, { poiRootName: GC_RE }],
    lastMessageAt: {
      $lte: new Date(Date.now() - 12 * 3600e3), // quiet for at least half a day
      ...(range.from ? { $gte: new Date(range.from) } : {}),
      ...(range.to ? { $lte: new Date(range.to) } : {}),
    },
  };
  const rows = await Conversation.find(q)
    .select("psid extractedName lastMessageAt")
    .sort({ lastMessageAt: -1 })
    .limit(MAX_ITEMS)
    .lean();
  const items = [];
  for (const r of rows) {
    const msgs = await Message.find({ psid: r.psid, senderType: "user" })
      .sort({ timestamp: -1 })
      .limit(2)
      .select("text timestamp")
      .lean();
    if (!msgs.length) continue;
    const text = msgs
      .reverse()
      .map((m) => String(m.text || "").trim())
      .filter(Boolean)
      .join(" · ")
      .slice(0, MAX_TEXT);
    if (!text) continue;
    items.push({ id: r.psid, name: r.extractedName || null, at: r.lastMessageAt, text, outcome: null });
  }
  return { total: await Conversation.countDocuments(q), items };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CLUSTERING CALL
// ─────────────────────────────────────────────────────────────────────────────

let _openai = null;
function openai() {
  if (!_openai) {
    const { OpenAI } = require("openai");
    _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
  }
  return _openai;
}

const PROMPT = `Eres analista de ventas de Hanlob (malla antimaleza / Ground Cover). Te doy mensajes REALES de clientes, numerados. Cada número es un cliente distinto.

Tu trabajo: AGRUPAR los MOTIVOS por los que estos clientes NO continuaron con su compra, usando SÓLO lo que el cliente escribió.

QUÉ ES UN MOTIVO (agrúpalo):
- Una queja o inconformidad: "está muy caro", "nunca me contestaron", "no me explicaron bien".
- Una comparación en nuestra contra: "lo encontré más barato en otro lado", "en Mercado Libre está menos".
- Algo que no teníamos o no le servía: "yo quería 5 metros lineales", "necesitaba en beige", "sólo me sirve de 1 m de ancho".
- Una decisión o un aplazamiento, incluso si es amable: "ya lo compré en otra parte", "lo voy a dejar para después", "primero tengo que consultarlo", "una vez me den respuesta yo le digo", "le escribo esta semana si me interesa". Agrúpalos: un cliente que dice que ya volverá SÍ expresó por qué se detuvo.
- Una condición que no cumplimos: "necesito factura", "sólo si es contra entrega", "me sale muy caro el envío".

QUÉ NO ES UN MOTIVO (va en "sin_motivo"):
- Una PREGUNTA normal del proceso de venta: "¿cuánto cuesta?", "¿qué medidas tienen?", "¿hacen envíos?", "¿cómo lo compro?". Preguntar un precio NO es quejarse del precio. Que la conversación se haya enfriado después NO convierte la pregunta en un motivo.
- Un saludo, un "ok", un "gracias", una medida suelta, un dato (nombre, CP, teléfono), un emoji.
- Cualquier cosa donde el cliente no dijo por qué se detuvo.

Reglas absolutas:
- NO inventes ni deduzcas motivos. Si el cliente no lo dijo, es "sin_motivo". Es NORMAL que la mayoría caiga ahí; un "sin_motivo" grande es un resultado correcto, no un fracaso. Pero NO mandes a "sin_motivo" un mensaje que sí trae una queja, una comparación, una condición o un aplazamiento: esos van agrupados aunque sean sólo dos o tres.
- Cada número va en UN SOLO grupo.
- Cada "quote" debe ser texto LITERAL copiado del mensaje de ESE número, máximo 15 palabras, y debe ser la parte donde expresa el motivo. No lo parafrasees.
- Los grupos salen de lo que dicen los clientes, no de una lista fija. Crea entre 1 y 8 grupos con etiquetas concretas ("Precio arriba de lo esperado", "Quería medida por metro lineal", "Nadie le contestó a tiempo"). Nunca etiquetas vagas tipo "consultas de precio" u "otros problemas".
- "category" clasifica el grupo en una de: precio, medidas, atencion, informacion, otros.

Responde JSON:
{"clusters":[{"label":"...","summary":"<una frase>","category":"precio|medidas|atencion|informacion|otros","members":[1,4],"quotes":[{"n":1,"quote":"..."}]}],"sin_motivo":[2,3]}`;

async function askModel(items) {
  const numbered = items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
  const res = await openai().chat.completions.create({
    // gpt-4o, not mini. This is ONE cached call per batch of answers, and mini read
    // all 40 real conversations as "sin motivo" — including two plain deferrals ("una
    // vez me den respuesta yo le digo", "le escribo esta semana si me interesa") that
    // the prompt names as examples. The same choice the convo audit and the scenario
    // battery make for their judges: the analysis is what the client reads.
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: numbered },
    ],
    max_tokens: 2000,
  });
  return JSON.parse(res.choices[0].message.content || "{}");
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICATION — the part that keeps the dashboard honest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check the model's clustering against the text it was given. Pure function, no
 * network: this is the piece under test.
 *
 * @param {{clusters?: any[], sin_motivo?: any[]}} raw   what the model answered
 * @param {{id: string, text: string, name?: string|null, at?: any}[]} items the input
 * @returns {{clusters: any[], sinMotivo: any[], unassigned: any[], dropped: object}}
 */
function verifyClusters(raw, items) {
  const dropped = { members: 0, quotes: 0, clusters: 0, duplicates: 0 };
  const taken = new Set(); // an item belongs to exactly one cluster
  const byIdx = (n) => (Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : null);

  const clusters = [];
  for (const c of Array.isArray(raw.clusters) ? raw.clusters : []) {
    const label = String(c.label || "").trim().slice(0, 60);
    if (!label) { dropped.clusters++; continue; }
    const members = [];
    for (const n of Array.isArray(c.members) ? c.members : []) {
      const it = byIdx(n);
      if (!it) { dropped.members++; continue; }          // a number we never sent in
      if (taken.has(it.id)) { dropped.duplicates++; continue; } // claimed twice
      taken.add(it.id);
      members.push({ id: it.id, name: it.name || null, at: it.at || null, text: it.text, n });
    }
    if (!members.length) { dropped.clusters++; continue; } // a theme with nobody in it
    // A quote has to be IN the customer's text, or it is not a quote.
    const quotes = [];
    for (const q of Array.isArray(c.quotes) ? c.quotes : []) {
      const it = byIdx(q && q.n);
      const quote = String((q && q.quote) || "").trim();
      if (!it || !quote || !members.some((m) => m.id === it.id)) { dropped.quotes++; continue; }
      if (!norm(it.text).includes(norm(quote))) { dropped.quotes++; continue; }
      quotes.push({ id: it.id, name: it.name || null, quote: quote.slice(0, 160) });
    }
    clusters.push({
      label,
      summary: String(c.summary || "").trim().slice(0, 200) || null,
      category: CATEGORIES.includes(c.category) ? c.category : "otros",
      count: members.length,
      members,
      // One quote per customer: four copies of the same sentence from four members is
      // not four pieces of evidence, and the first version printed exactly that.
      quotes: quotes.filter((q, i) => quotes.findIndex((o) => o.id === q.id) === i).slice(0, 4),
    });
  }
  clusters.sort((a, b) => b.count - a.count);

  const sinMotivo = [];
  for (const n of Array.isArray(raw.sin_motivo) ? raw.sin_motivo : []) {
    const it = byIdx(n);
    if (!it || taken.has(it.id)) continue;
    taken.add(it.id);
    sinMotivo.push({ id: it.id, name: it.name || null, at: it.at || null, text: it.text });
  }
  // Anything the model forgot. Reported, never dropped: the counts must add up to the
  // number of texts that were read, or the percentages mean nothing.
  const unassigned = items
    .filter((it) => !taken.has(it.id))
    .map((it) => ({ id: it.id, name: it.name || null, at: it.at || null, text: it.text }));

  return { clusters, sinMotivo, unassigned, dropped };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE CONVERSATION STOPPED — deterministic, and the other half of the answer
// ─────────────────────────────────────────────────────────────────────────────
//
// Most customers never say why they went quiet, and we are not allowed to guess. But
// we DO know, as a fact, what the last thing we said to them was — and "they went
// quiet right after we quoted the price" is a finding about our funnel that needs no
// inference at all. It is labelled OBSERVADO everywhere it is shown, and it is never
// added to the stated motives above: one is what customers told us, the other is where
// they stopped.
//
// Priority order matters: a message can quote a price AND share a link, and the link
// is the stronger fact (we handed them the buy path and they didn't take it).
const STALL_RULES = [
  { key: "handoff", re: /(especialista|supervisor|te\s+contactar|compa[nñ]ero\s+te)/i },
  { key: "link_compartido", re: /(\/r\/[a-z0-9]+|mercadolibre\.com)/i },
  { key: "pidio_cp_o_datos", re: /(c[oó]digo\s+postal|\bcolonia\b|tel[eé]fono\s+a\s+10|a\s+nombre\s+de\s+qui[eé]n)/i },
  { key: "precio_cotizado", re: /\$\s?\d/ },
  { key: "pidio_medida", re: /(qu[eé]\s+medida|cu[aá]ntos?\s+metros|ancho|largo)/i },
  { key: "catalogo_o_info", re: /(cat[aá]logo|antimaleza|ground\s*cover)/i },
];

/**
 * What the LAST thing we said was, for Ground Cover conversations that went quiet.
 * Pure counting over the transcript — no model, no inference about motive.
 *
 * @param {{from?: any, to?: any, limit?: number}} [range]
 */
async function stallPoints(range = {}) {
  const q = {
    $or: [{ currentFlow: GC_RE }, { productInterest: GC_RE }, { poiRootName: GC_RE }],
    lastMessageAt: {
      $lte: new Date(Date.now() - 12 * 3600e3),
      ...(range.from ? { $gte: new Date(range.from) } : {}),
      ...(range.to ? { $lte: new Date(range.to) } : {}),
    },
  };
  const rows = await Conversation.find(q)
    .select("psid extractedName lastMessageAt")
    .sort({ lastMessageAt: -1 })
    .limit(range.limit || 400)
    .lean();

  const buckets = {};
  const add = (key, row, last, short) => {
    buckets[key] = buckets[key] || { key, count: 0, short: 0, examples: [] };
    buckets[key].count++;
    if (short) buckets[key].short++;
    if (buckets[key].examples.length < 5) {
      buckets[key].examples.push({
        id: row.psid,
        name: row.extractedName || null,
        at: row.lastMessageAt,
        text: String(last || "").slice(0, 200),
      });
    }
  };

  for (const r of rows) {
    // The last eight messages in one query: the newest IS the stall point, and a
    // conversation that returns fewer than eight is one we can also measure the LENGTH
    // of — which separates "went quiet at the opener's data request" from "went quiet
    // at a data request after a real exchange". Those are different problems and the
    // first version lumped them together under one 52% bar.
    const msgs = await Message.find({ psid: r.psid })
      .sort({ timestamp: -1 })
      .limit(8)
      .select("text senderType")
      .lean();
    const last = msgs[0];
    if (!last) continue;
    const short = msgs.length < 8 && msgs.length <= 4;
    // The customer wrote last and nobody answered. That is not a stall, it is a debt —
    // and it is the one bucket we can act on without asking anybody anything.
    if (last.senderType === "user") {
      add("sin_respuesta_nuestra", r, last.text, short);
      continue;
    }
    const hit = STALL_RULES.find((rule) => rule.re.test(String(last.text || "")));
    add(hit ? hit.key : "otro", r, last.text, short);
  }

  const total = Object.values(buckets).reduce((n, b) => n + b.count, 0);
  return {
    read: total,
    buckets: Object.values(buckets)
      .map((b) => ({ ...b, pct: total ? Math.round((b.count / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

async function readCache(scope) {
  const st = await SystemState.findById("singleton").select("gcReasonClusters").lean();
  return (st && st.gcReasonClusters && st.gcReasonClusters[scope]) || null;
}
async function writeCache(scope, payload) {
  await SystemState.updateOne({ _id: "singleton" }, { $set: { [`gcReasonClusters.${scope}`]: payload } }, { upsert: true });
}

/**
 * Group the WHY for one scope. Cached on a hash of the texts that went in, so the
 * dashboard can be opened all day for one call; `refresh` forces a new one.
 *
 * @param {{scope?: "followup"|"convo", from?: any, to?: any, refresh?: boolean}} [opts]
 */
async function clusterReasons(opts = {}) {
  const scope = opts.scope === "convo" ? "convo" : "followup";
  const { items, total } = scope === "convo" ? await convoItems(opts) : await followUpItems(opts);

  const base = {
    scope,
    read: items.length,
    total,
    truncated: total > items.length,
    stated: 0,
    clusters: [],
    sinMotivo: [],
    unassigned: [],
    dropped: null,
    at: new Date(),
    cached: false,
  };
  if (!items.length) return { ...base, empty: true };

  const hash = hashItems(scope, items);
  if (!opts.refresh) {
    const hit = await readCache(scope);
    if (hit && hit.hash === hash && hit.result) return { ...hit.result, at: hit.at, cached: true };
  }

  let raw;
  try {
    raw = await askModel(items);
  } catch (e) {
    console.error("❌ gcReasonClusters model call failed:", e.message);
    return { ...base, error: `No se pudo agrupar: ${e.message}` };
  }

  const v = verifyClusters(raw, items);
  const stated = v.clusters.reduce((n, c) => n + c.count, 0);
  const result = {
    ...base,
    stated,
    statedPct: items.length ? Math.round((stated / items.length) * 1000) / 10 : 0,
    clusters: v.clusters,
    sinMotivo: v.sinMotivo,
    unassigned: v.unassigned,
    dropped: v.dropped,
    byCategory: v.clusters.reduce((acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + c.count;
      return acc;
    }, {}),
  };

  await writeCache(scope, { hash, at: result.at, result }).catch((e) =>
    console.error("⚠️ gcReasonClusters cache write failed:", e.message)
  );

  // The follow-up rows carry their theme, so the detail table and the §6 record can
  // show the same grouping the chart does. The "convo" scope writes nothing: those
  // conversations were never part of the campaign.
  if (scope === "followup") {
    for (const c of result.clusters) {
      await Conversation.updateMany(
        { psid: { $in: c.members.map((m) => m.id) } },
        { $set: { "gcFollowUp.clusterLabel": c.label, "gcFollowUp.clusterAt": result.at } }
      ).catch(() => {});
    }
  }
  return result;
}

module.exports = {
  clusterReasons,
  stallPoints,
  verifyClusters, // exported for scripts/gcReasonClusterTest.js
  followUpItems,
  convoItems,
  MAX_ITEMS,
  CATEGORIES,
};
