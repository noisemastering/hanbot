// LLM-judge nonsense audit. Judges bot replies for genuine semantic nonsense
// (incoherence, contradiction, ignoring the question, product-mix) — NOT brevity.
// Usage: node scripts/nonsenseAudit.js [ISO_CUTOFF]
//   e.g. node scripts/nonsenseAudit.js 2026-06-23T21:00:00Z
const mongoose = require("mongoose");
require("dotenv").config();
const { OpenAI } = require("openai");
const Message = require("../models/Message");

const CUTOFF = new Date(process.argv[2] || "2026-06-23T21:00:00Z");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const RUBRIC = `Eres un auditor de calidad de un bot de ventas de malla sombra (Hanlob), en español mexicano.
Te doy el ÚLTIMO mensaje del BOT y el contexto previo de la conversación. Decide si la respuesta del bot es SIN SENTIDO (nonsense): incoherente, se contradice, ignora lo que el cliente preguntó, mezcla productos equivocados, o da un dato que contradice algo que acaba de decir.

NO es sin sentido (NUNCA marques estos como sin_sentido):
- Respuestas BREVES o cortas (saludos, "¿qué medida necesitas?", "con gusto", una cotización corta válida). La brevedad JAMÁS es motivo.
- Pedir un dato que falta y es necesario (medida, color, código postal).
- Cotizaciones válidas, links, handoffs a un asesor.
- Repetir un saludo o una pregunta legítima.
- IMPORTANTE: el BORDE SEPARADOR sí se vende POR LARGO en rollos de 6, 9, 18 y 54 m. Cuando el cliente pregunta por borde separador (o ya viene de un anuncio de borde) y el bot pregunta "¿qué largo necesitas? rollos de 18 m y 54 m" o cotiza esos largos, ESO ES CORRECTO — NO es mezcla de productos. Solo es mezcla de productos si el cliente claramente pedía MALLA SOMBRA confeccionada (una medida ancho x largo, ej "3x3") y el bot respondió con largos de rollo de borde.

SÍ es sin sentido (ejemplos reales):
- El cliente pide el precio de una medida de MALLA confeccionada (ej "3x3") y el bot responde sobre OTRO producto/familia (ej "¿qué largo necesitas? rollos de 18 m") — mezcla de productos.
- El bot da un precio para una medida y momentos después un precio distinto para la MISMA medida sin razón.
- El bot dice que no puede confirmar un precio que sí tiene, o se contradice.
- Respuesta totalmente fuera de tema respecto a lo que el cliente preguntó.

Devuelve SOLO JSON:
{"sin_sentido": true|false, "severidad": "media"|"alta", "categoria": "mezcla_productos"|"contradiccion"|"ignora_pregunta"|"incoherente"|"otro", "cita": "<copia textual del fragmento del bot que es sin sentido>", "motivo": "<por qué, refiriéndote a la cita; NUNCA digas 'breve' o 'corta'>"}
Si NO es sin sentido: {"sin_sentido": false}
Reglas de salida: solo marca sin_sentido:true si la severidad es media o alta. "cita" es OBLIGATORIA y debe ser texto literal del bot.`;

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
    return { sin_sentido: false, _err: e.message };
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const bots = await Message.find({ senderType: "bot", timestamp: { $gte: CUTOFF } })
    .sort({ timestamp: 1 })
    .select("psid text timestamp")
    .lean();
  console.log(`Bot replies since ${CUTOFF.toISOString()}: ${bots.length}`);

  const flags = [];
  let judged = 0;
  for (const b of bots) {
    if (!b.text || b.text.trim().length < 2) continue;
    const ctx = await Message.find({ psid: b.psid, timestamp: { $lt: b.timestamp } })
      .sort({ timestamp: -1 })
      .limit(4)
      .select("senderType text timestamp")
      .lean();
    const contextLines = ctx
      .reverse()
      .map((m) => `${m.senderType === "user" ? "CLIENTE" : "BOT"}: ${(m.text || "").slice(0, 200)}`)
      .join("\n");
    const v = await judge(b.text, contextLines || "(sin contexto previo)");
    judged++;
    if (v && v.sin_sentido === true && (v.severidad === "media" || v.severidad === "alta")) {
      flags.push({ ...v, psid: b.psid, ts: b.timestamp.toISOString(), bot: b.text.slice(0, 180) });
    }
  }

  const order = { alta: 0, media: 1 };
  flags.sort((a, b) => (order[a.severidad] ?? 9) - (order[b.severidad] ?? 9));
  console.log(`\nJudged ${judged} | flagged ${flags.length} (severidad >= media)\n`);
  for (const f of flags) {
    console.log(`[${f.severidad.toUpperCase()}] ${f.categoria} | ${f.ts} | psid ${f.psid}`);
    console.log(`  cita: ${f.cita || "(n/a)"}`);
    console.log(`  motivo: ${f.motivo || "(n/a)"}\n`);
  }
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
