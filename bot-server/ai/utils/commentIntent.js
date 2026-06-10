// ai/utils/commentIntent.js
//
// AI-based classifier for "should we auto-reply to this Facebook comment, and
// with what?". Replaces the keyword `isQuestion` / regex `isShippingQuestion`
// gate, which only fired on question-shaped text and silently ignored
// declarative purchase intent like "me interesa una malla roja" or "quiero una
// de 6x4". Intent — not keyword presence — decides whether we engage.
//
// Returns { reply: boolean, type: 'shipping'|'general'|null }:
//   - shipping → the comment is about delivery/shipping (cost, coverage, time).
//   - general → any other comment worth engaging: purchase interest, product
//     mention, a question, a price ask, etc.
//   - null + reply:false → not worth replying (spam, insults, emojis only,
//     off-topic chatter, generic praise with no intent).
//
// Cached in memory to avoid re-calling the API on repeated/identical comments.

const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const _cache = new Map();
const _CACHE_MAX = 500;

/**
 * @param {string} comment
 * @returns {Promise<{reply: boolean, type: 'shipping'|'general'|null}>}
 */
async function classifyComment(comment) {
  const empty = { reply: false, type: null };
  if (!comment || typeof comment !== 'string') return empty;
  const key = comment.trim().toLowerCase();
  if (key.length < 2) return empty;
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un clasificador de COMENTARIOS de Facebook para Hanlob (fabricante mexicano de malla sombra). Decides si vale la pena responder al comentario y de qué tipo.

Hanlob vende malla sombra (confeccionada y en rollo) y accesorios de jardín. Los comentarios vienen de publicaciones/anuncios de estos productos.

Devuelve JSON: {"reply": true|false, "type": "shipping"|"general"|null}

REGLAS:
- "shipping": el comentario es sobre ENVÍO/entrega (costo, cobertura, tiempo, "hacen envíos?", "llega a Monterrey?", "cuánto el flete"). → reply:true, type:"shipping".
- "general": CUALQUIER comentario que valga la pena atender: interés de compra aunque sea afirmación ("me interesa", "quiero una de 6x4", "ocupo malla", "info por favor"), mención de un producto/medida/color, una pregunta de precio/disponibilidad, o cualquier duda. → reply:true, type:"general".
- reply:false (type:null): NO vale la pena responder. Spam, insultos, groserías, solo emojis, etiquetar a alguien ("@Juan mira"), elogios genéricos sin intención ("qué bonito", "👏"), comentarios fuera de tema.

IMPORTANTE: una AFIRMACIÓN de interés ("me interesa una lona en color rojo", "quiero la promo") SÍ amerita respuesta (general), aunque no sea pregunta. No te bases en signos de interrogación.

EJEMPLOS:
- "me interesa una lona en color rojo" → {"reply":true,"type":"general"}
- "quiero una de 6x4" → {"reply":true,"type":"general"}
- "cuánto cuesta?" → {"reply":true,"type":"general"}
- "hacen envíos a Sonora?" → {"reply":true,"type":"shipping"}
- "llega a mi ciudad" → {"reply":true,"type":"shipping"}
- "info" → {"reply":true,"type":"general"}
- "qué bonito 😍" → {"reply":false,"type":null}
- "👏👏👏" → {"reply":false,"type":null}
- "@Maria mira esto" → {"reply":false,"type":null}
- "puro fraude" → {"reply":false,"type":null}`
        },
        { role: 'user', content: comment }
      ],
      temperature: 0,
      max_tokens: 25,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    const type = parsed.type === 'shipping' || parsed.type === 'general' ? parsed.type : null;
    const result = { reply: parsed.reply === true && !!type, type: parsed.reply === true ? type : null };
    if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error('❌ classifyComment error:', err.message);
    // On error, default to a general reply — better to engage a real comment
    // than to silently ignore it (the failure mode we're fixing).
    return { reply: true, type: 'general' };
  }
}

module.exports = { classifyComment };
