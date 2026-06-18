// ai/utils/promoIntent.js
//
// Tiny AI intent check: does the customer's latest message ask about / want the
// active promotion? Used by the workflow engine to fire a promo's verbatim sales
// pitch exactly once. Runs only while a pitch exists and hasn't been sent yet,
// so it's cheap (gpt-4o-mini, tiny output). Intent — not keywords — so it
// catches "quiero la promo", "comprar promoción 6x4", "me interesa la oferta",
// the ad quick-reply, etc.
const { OpenAI } = require("openai");
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const _cache = new Map();
const _CACHE_MAX = 500;

/**
 * @param {string} message
 * @returns {Promise<boolean>} true when the customer is asking about/wanting the promo
 */
async function wantsPromo(message) {
  if (!message || typeof message !== "string") return false;
  const key = message.trim().toLowerCase();
  if (key.length < 2) return false;
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un clasificador para Hanlob (malla sombra). Hay una PROMOCIÓN activa. Decide si el mensaje del cliente pide, acepta o pregunta por la promoción/oferta.

Devuelve JSON: {"wants": true|false}

wants:true cuando el cliente:
- pide o acepta la promo/oferta ("quiero la promoción", "me interesa la oferta", "comprar promoción", "sí, la promo", "cómo adquiero la promoción", "la de 6x4 en promoción").
- responde al anuncio de la promo expresando interés en comprarla.

wants:false cuando:
- es un saludo o pregunta general no relacionada a la promo.
- pregunta por OTRO producto/medida específica sin mencionar la promoción.
- es ruido (emojis, "ok", "gracias") sin pedir la oferta.

Solo el JSON.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 10,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    const result = parsed.wants === true;
    if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error("❌ wantsPromo error:", err.message);
    return false; // on error, don't fire the pitch — fall through to normal LLM flow
  }
}

module.exports = { wantsPromo };
