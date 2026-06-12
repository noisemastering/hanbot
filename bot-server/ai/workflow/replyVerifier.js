// ai/workflow/replyVerifier.js
//
// Grounding check that sits between the model's draft reply and the send. It
// compares the reply against the FACTS already resolved into the turn's context
// (the family realm — which encodes shade %, the available measures, colors,
// resolved price/links). If the reply confirms or asserts a PRODUCT SPEC
// (shade percentage, measure, color, price, availability) that the facts don't
// support or that contradicts them, it returns a corrected reply.
//
// This is data-driven, NOT a hardcoded list: it checks against whatever the
// engine actually resolved for this flow, so it generalizes to any flow /
// product (catches a fabricated 95% the same way it'd catch a fake size or
// price). On any error it returns the reply unchanged (never blocks a send).

const { getClient, CHAT_MODEL } = require("./llmClient");

/**
 * @param {string} reply - the model's draft reply
 * @param {string} facts - the grounded context (contextBlock + turn extras)
 * @returns {Promise<{ reply: string, corrected: boolean }>}
 */
async function verifyReply(reply, facts) {
  if (!reply || !reply.trim() || !facts || !facts.trim()) return { reply, corrected: false };

  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Eres un verificador de hechos para el bot de ventas de Hanlob. Recibes (A) los HECHOS disponibles (catálogo/contexto real de este flujo) y (B) una RESPUESTA que el bot quiere enviar al cliente.

Tu único trabajo: detectar si la RESPUESTA CONTRADICE un HECHO EXPLÍCITO sobre una especificación de producto. Especificaciones = porcentaje de sombra, medida/tamaño, color, precio, o disponibilidad.

REGLA CLAVE — solo CONTRADICCIONES, no omisiones:
- Corrige SOLO cuando la RESPUESTA contradice algo que los HECHOS afirman explícitamente.
  Ejemplo: los HECHOS dicen "90% de sombra" y la RESPUESTA confirma "95%" → CONTRADICCIÓN → corrígela a 90%.
  Ejemplo: los HECHOS dan el rango "2x2 a 7x10" y la RESPUESTA ofrece "20x20" → contradice el rango → corrígela.
- Si la RESPUESTA menciona algo que los HECHOS NO incluyen pero TAMPOCO contradicen (puede venir de otra parte del catálogo, del prompt o de la base de conocimiento) → NO la toques. La ausencia de un dato en los HECHOS NO es una contradicción.
- NUNCA se confirma una especificación solo porque el cliente la afirmó; pero solo intervienes si choca con un HECHO explícito.
- Saludos, preguntas, info general (envío, pago, compra protegida, handoff) → NO los toques.

Si hay una contradicción real, devuelve la RESPUESTA CORREGIDA: ajusta solo la afirmación que choca, alinéala con el HECHO explícito, conserva el tono y la intención (incluido el handoff si aplica). NUNCA inventes datos nuevos.

Responde SOLO JSON: {"ok": true|false, "corrected": "<la respuesta corregida, o la original si ok>"}`,
        },
        { role: "user", content: `HECHOS:\n${facts}\n\nRESPUESTA:\n${reply}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    if (parsed.ok === false && parsed.corrected && parsed.corrected.trim()) {
      return { reply: parsed.corrected.trim(), corrected: true };
    }
    return { reply, corrected: false };
  } catch (err) {
    console.error("⚠️ replyVerifier error (passing original through):", err.message);
    return { reply, corrected: false };
  }
}

module.exports = { verifyReply };
