// scripts/handoffAudit.js
//
// FOCUSED handoff audit — three buckets the daily audit doesn't fully cover:
//   [A] BAD handoffs   — a handoff FIRED but has no reason recorded (or is broken)
//   [B] MISSED handoffs — a human was clearly needed and it NEVER fired (LLM-judged)
//   [C] INFO GAPS      — handed off (or should have) but NO name/phone captured
//
//   node scripts/handoffAudit.js                       # default: last 3 days
//   node scripts/handoffAudit.js 2026-07-20T00:00:00Z  # explicit cutoff
//
// It NEVER writes anything. Missed-handoff detection is a deterministic signal
// pre-filter (cheap) → LLM confirmation (only on candidates), so cost stays low.
require("dotenv").config();
const mongoose = require("mongoose");
const { OpenAI } = require("openai");

const CUTOFF = new Date(process.argv[2] || new Date(Date.now() - 3 * 24 * 3600e3).toISOString());
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// A message that, on its own, suggests the bot should have escalated to a human.
// Kept broad on purpose (pre-filter) — the LLM confirms; false positives are cheap.
const HANDOFF_SIGNAL = new RegExp(
  [
    "mayoreo", "medio\\s*mayoreo", "por\\s*mayor", "revend", "distribu", "negocio propio",
    "monofilamento",
    "impermeable", "a prueba de agua", "que no (pase|entre|cale) (el )?agua", "\\btoldo\\b",
    "asesor", "\\bhumano\\b", "una persona", "hablar con", "me pueden? (llamar|marcar|contactar)", "me (llaman|marcan|contactan)",
    "medida especial", "sobre\\s*medida", "a la medida", "personaliz",
    "reembolso", "garant[ií]a", "factura", "no me (ha )?lleg", "ya (compr[eé]|pagu[eé]|orden[eé])", "mi pedido",
  ].join("|"),
  "i"
);
const PHONE = /\b\d{10}\b/; // a valid phone is ALL 10 digits — a 9-digit fragment is NOT contact

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Best-effort name/phone for a conversation (mirrors buildClientBrief's sources).
function contactOf(c, userTexts) {
  const first = (...xs) => { for (const x of xs) if (x !== undefined && x !== null && x !== "") return x; return null; };
  const specs = c.productSpecs || {};
  const name = first(c.extractedName, specs.customerName, c.customerName, c.profileName, c.crm && c.crm.name);
  let phone = first(c.leadData && c.leadData.contact, c.crm && c.crm.phone);
  if (!phone && c.handoffReason) { try { phone = require("../ai/workflow/handoffGate").extractPhone(c.handoffReason); } catch { /* ignore */ } }
  if (!phone) { for (const t of userTexts || []) { const m = String(t || "").match(PHONE); if (m) { phone = m[0]; break; } } }
  return { name: name || null, phone: phone || null };
}

async function judgeMissed(transcript) {
  const sys = `Eres auditor de calidad de un bot de ventas de malla sombra (Hanlob), español mexicano.
Decide si el bot DEBIÓ pasar al cliente con un ASESOR HUMANO y NO lo hizo en esta conversación.

DEBE pasar a humano (missed=true) cuando el cliente:
- pide MAYOREO / medio mayoreo / es revendedor / distribuidor / quiere precio de negocio.
- pide MONOFILAMENTO (producto sin flujo activo).
- insiste en algo IMPERMEABLE / para lluvia / toldo (la malla NO es impermeable; si insiste en cotización, va a asesor).
- pide una MEDIDA ESPECIAL / sobre medida / personalizada que requiere cotización de un asesor.
- pide EXPLÍCITAMENTE hablar con una persona / asesor / que le llamen.
- tiene un tema de POSTVENTA: reclama un pedido no recibido, reembolso, garantía, factura.
- el bot se quedó ATORADO (no pudo resolver, dio vueltas, repitió sin avanzar).

NO es handoff necesario (missed=false): preguntas normales de precio, medida, color, disponibilidad o envío que el bot SÍ puede contestar; un simple saludo; que el cliente no responda.

Responde SOLO JSON: {"missed":true|false,"categoria":"mayoreo|monofilamento|impermeable|medida_especial|pide_humano|postventa|bot_atorado|na","motivo":"<breve>","dejo_datos":true|false}
"dejo_datos" = ¿el cliente dejó su NOMBRE y/o TELÉFONO en la conversación?`;
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: transcript }],
    });
    return JSON.parse(r.choices[0].message.content);
  } catch (e) { return { missed: false, categoria: "na", motivo: "judge error: " + e.message, dejo_datos: false }; }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Conversation = require("../models/Conversation");
  const Message = require("../models/Message");

  console.log(`\n════════ HANDOFF AUDIT — since ${CUTOFF.toISOString()} ════════`);

  // ─── [A] BAD handoffs — a handoff FIRED; is it well-formed? ───────────────────
  const fired = await Conversation.find({
    $or: [
      { handoffTimestamp: { $gte: CUTOFF } },
      { handoffRequested: true, lastMessageAt: { $gte: CUTOFF } },
      { state: { $in: ["needs_human", "human_handling", "human_active", "human_takeover"] }, lastMessageAt: { $gte: CUTOFF } },
    ],
  }).lean();

  const badHandoffs = [], firedNoInfo = [];
  const firedPsids = new Set();
  console.log(`\n[A] Handoffs que SÍ ocurrieron — ${fired.length} en ventana`);
  for (const c of fired) {
    firedPsids.add(c.psid);
    const isBot = !!(c.handoffRequested || c.handoffTimestamp || c.state === "needs_human");
    if (!isBot) continue; // manual takeover — no bot reason/contact by design
    const uMsgs = await Message.find({ psid: c.psid, senderType: "user", timestamp: { $gte: CUTOFF } }).select("text").lean();
    const { name, phone } = contactOf(c, uMsgs.map((m) => m.text));
    const reasonMissing = !c.handoffReason;
    // Customer not answering the contact ask is EXPECTED (captured in the reason) — not a gap.
    const contactExpected = /sin respuesta|no proporcion|30s/i.test(c.handoffReason || "");
    const noInfo = !name && !phone && !contactExpected;
    const issues = [];
    if (reasonMissing) issues.push("SIN motivo");
    if (noInfo) issues.push("SIN nombre ni teléfono");
    if (issues.length) {
      badHandoffs.push({ psid: c.psid, issues, reason: c.handoffReason, name, phone });
      if (noInfo) firedNoInfo.push({ psid: c.psid, reason: c.handoffReason });
    }
  }
  const okFired = fired.length - badHandoffs.length;
  console.log(`    ✅ bien formados: ${okFired} · ⚠️ con problema: ${badHandoffs.length}`);
  for (const b of badHandoffs) {
    console.log(`\n    ⚠️  ${b.issues.join(" + ")} | psid ${b.psid}`);
    console.log(`        motivo: ${b.reason || "(NINGUNO)"}`);
    console.log(`        datos: ${b.name ? "nombre=" + b.name : "sin nombre"} · ${b.phone ? "tel=" + b.phone : "sin tel"}`);
  }

  // ─── [B] MISSED handoffs — a human was needed but none fired ──────────────────
  // Pre-filter: user messages in window that carry a handoff signal → candidate psids
  // that did NOT already hand off. Then LLM-confirms each.
  const sigMsgs = await Message.find({
    senderType: "user", timestamp: { $gte: CUTOFF }, text: { $regex: HANDOFF_SIGNAL },
  }).select("psid text timestamp").lean();
  const candidatePsids = [...new Set(sigMsgs.map((m) => m.psid))].filter((p) => !firedPsids.has(p));
  console.log(`\n[B] Handoffs que FALTARON — ${candidatePsids.length} candidatos (con señal, sin handoff) a confirmar…`);

  const missed = [];
  for (const psid of candidatePsids) {
    // Build a compact session transcript (last ~14 msgs since cutoff).
    const msgs = await Message.find({ psid, timestamp: { $gte: CUTOFF } })
      .sort({ timestamp: 1 }).limit(30).select("senderType text").lean();
    if (!msgs.length) continue;
    const transcript = msgs.map((m) => `${m.senderType === "user" ? "CLIENTE" : "BOT"}: ${(m.text || "").slice(0, 220)}`).join("\n");
    const v = await judgeMissed(transcript);
    if (v && v.missed === true) {
      const c = await Conversation.findOne({ psid }).lean().catch(() => null);
      const { name, phone } = contactOf(c || {}, msgs.filter((m) => m.senderType === "user").map((m) => m.text));
      missed.push({ psid, categoria: v.categoria, motivo: v.motivo, name, phone, dejoDatos: v.dejo_datos });
    }
  }
  console.log(`    🔺 confirmados: ${missed.length}`);
  const byCat = {};
  for (const m of missed) (byCat[m.categoria] = byCat[m.categoria] || []).push(m);
  for (const cat of Object.keys(byCat).sort()) {
    console.log(`\n    ── ${cat.toUpperCase()} (${byCat[cat].length}) ──`);
    for (const m of byCat[cat]) {
      console.log(`    🔺 psid ${m.psid} — ${m.motivo}`);
      console.log(`        datos: ${m.name ? "nombre=" + m.name : "sin nombre"} · ${m.phone ? "tel=" + m.phone : "sin tel"}`);
    }
  }

  // ─── [C] INFO GAPS — needed a human, no way to reach them ─────────────────────
  const missedNoInfo = missed.filter((m) => !m.name && !m.phone);
  console.log(`\n[C] Sin datos del cliente (no hay cómo contactarlo)`);
  console.log(`    handoffs SÍ ocurridos pero sin nombre/teléfono: ${firedNoInfo.length}`);
  console.log(`    handoffs FALTANTES sin nombre/teléfono:          ${missedNoInfo.length}`);
  const totalUnreachable = firedNoInfo.length + missedNoInfo.length;

  console.log(`\n════════ END — handoffs: ${fired.length} (⚠️ ${badHandoffs.length}) | faltantes: ${missed.length} | sin datos: ${totalUnreachable} ════════\n`);
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
