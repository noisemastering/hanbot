// Consolidated conversation QA audit. One routine for every error check we've
// been running. Usage:  node scripts/convoAudit.js <ISO_CUTOFF>
//   e.g. node scripts/convoAudit.js 2026-06-22T00:00:00Z
//
// Covers, since the cutoff:
//   LLM-judge per bot reply → nonsense | wrong/odd price | bad link |
//                              false denial | vague discount | multi-measure miss
//   Deterministic scan      → handoffs (real reason + lead name/phone captured)
const mongoose = require("mongoose");
require("dotenv").config();
const { OpenAI } = require("openai");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { buildClientBrief } = require("../utils/clientBrief");

const CUTOFF = new Date(process.argv[2] || "2026-06-22T00:00:00Z");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const RUBRIC = `Eres un auditor de calidad de un bot de ventas de malla sombra (Hanlob), español mexicano.
Te doy el ÚLTIMO mensaje del BOT y el contexto previo. Marca SOLO errores reales (severidad media o alta).

CATEGORÍAS de error:
- nonsense: incoherente, se contradice, ignora lo que preguntó el cliente, mezcla productos equivocados.
- precio: da un precio que parece equivocado, contradice un precio ya dado para la misma medida, o dice "con descuento" SIN dar el precio concreto.
- link: comparte un link genérico/de homepage, un link equivocado, o NO comparte link cuando el cliente quiere comprar.
- negacion_falsa: dice que NO vendemos / no manejamos algo que sí está en catálogo (malla sombra, confeccionada, rollos, borde, sobre medida).
- descuento_vago: responde "con descuento / en promoción" o "¿te interesa?" sin dar el PRECIO exacto y el LINK cuando el cliente pidió precio.
- multimedida: el cliente pidió 2+ medidas y el bot no cotizó cada una con su propio precio/link.
- impermeable: el cliente busca protección contra la LLUVIA o algo IMPERMEABLE, y el bot ofrece/cotiza malla sombra (que NO es impermeable, deja pasar el agua) sin aclarar que no detiene la lluvia.

NO son errores (NUNCA marcar):
- Respuestas breves/cortas, saludos, pedir un dato faltante (medida, color, CP).
- Borde separador SÍ se vende por largo (6/9/18/54 m): preguntar "¿qué largo?" para borde NO es error.
- El BORDE SEPARADOR mide 13 cm de alto × el largo en metros. Una medida como "13x18m" / "13x54m" para borde es CORRECTA (13 cm × 18 m), NO es una malla de 13 m × 18 m. NUNCA la marques como error de medida ni mezcla de productos.
- Cotizaciones válidas, handoffs legítimos.

Devuelve SOLO JSON:
{"error": true|false, "categoria": "nonsense|precio|link|negacion_falsa|descuento_vago|multimedida|impermeable|otro", "severidad": "media|alta", "cita": "<texto literal del bot>", "motivo": "<por qué; NUNCA 'breve'>"}
Si no hay error: {"error": false}. Solo error:true si severidad media o alta; "cita" obligatoria y literal.`;

async function judge(botText, contextLines) {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RUBRIC },
        { role: "user", content: `CONTEXTO (cronológico):\n${contextLines}\n\n=== RESPUESTA DEL BOT A EVALUAR ===\n${botText}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  } catch (e) {
    return { error: false, _err: e.message };
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`\n════════ CONVERSATION QA AUDIT — since ${CUTOFF.toISOString()} ════════`);

  // ---- PART 1: LLM-judge per bot reply ----
  const bots = await Message.find({ senderType: "bot", timestamp: { $gte: CUTOFF } })
    .sort({ timestamp: 1 }).select("psid text timestamp").lean();
  console.log(`\n[1] Reply quality — judging ${bots.length} bot replies (gpt-4o)…`);
  const flags = [];
  let judged = 0;
  for (const b of bots) {
    if (!b.text || b.text.trim().length < 2) continue;
    const ctx = await Message.find({ psid: b.psid, timestamp: { $lt: b.timestamp } })
      .sort({ timestamp: -1 }).limit(4).select("senderType text").lean();
    const contextLines = ctx.reverse().map((m) => `${m.senderType === "user" ? "CLIENTE" : "BOT"}: ${(m.text || "").slice(0, 200)}`).join("\n");
    const v = await judge(b.text, contextLines || "(sin contexto)");
    judged++;
    if (v && v.error === true && (v.severidad === "media" || v.severidad === "alta")) {
      flags.push({ ...v, psid: b.psid, ts: b.timestamp.toISOString() });
    }
  }
  const byCat = {};
  for (const f of flags) (byCat[f.categoria] = byCat[f.categoria] || []).push(f);
  console.log(`    judged ${judged} | flagged ${flags.length}`);
  for (const cat of Object.keys(byCat).sort()) {
    console.log(`\n    ── ${cat.toUpperCase()} (${byCat[cat].length}) ──`);
    byCat[cat].sort((a, b) => (a.severidad === "alta" ? -1 : 1)).forEach((f) => {
      console.log(`    [${f.severidad}] ${f.ts} | psid ${f.psid}`);
      console.log(`        cita: ${f.cita || "(n/a)"}`);
      console.log(`        motivo: ${f.motivo || "(n/a)"}`);
    });
  }

  // ---- PART 2: deterministic handoff audit ----
  const convos = await Conversation.find({
    $or: [
      { handoffTimestamp: { $gte: CUTOFF } },
      { handoffRequested: true, lastMessageAt: { $gte: CUTOFF } },
      { state: { $in: ["needs_human", "human_handling", "human_active", "human_takeover"] }, lastMessageAt: { $gte: CUTOFF } },
    ],
  }).lean();
  console.log(`\n[2] Handoffs — ${convos.length} in window (reason + reachable lead?)`);
  for (const c of convos) {
    const hasContact = !!((c.leadData && c.leadData.contact) || c.extractedName || c.profileName);
    const issues = [];
    if (!c.handoffReason) issues.push("SIN motivo registrado");
    if (!hasContact) issues.push("SIN contacto (nombre/teléfono) para el humano");
    const tag = issues.length ? `⚠️  ${issues.join(" + ")}` : "✅ ok";
    console.log(`\n    ${tag} | psid ${c.psid} | state=${c.state}`);
    console.log(`        motivo: ${c.handoffReason || "(NINGUNO)"}`);
    console.log(`        brief: ${buildClientBrief(c)}`);
  }

  console.log(`\n════════ END — reply flags: ${flags.length} | handoff convos: ${convos.length} ════════\n`);
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
