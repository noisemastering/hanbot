// ai/utils/measureExtractor.js
//
// AI-based measure extractor for CUSTOMER free-text. Replaces regex parsing of
// the customer's message (which kept missing phrasings: "13 de largo x 3 de
// ancho", "mide 13 por 3", "una de 3 de ancho y 13 de largo", "13m largo 3m
// ancho", worded numbers, etc.). Returns the two dimensions in meters, sorted
// ascending so order doesn't matter (4x6 == 6x4) — same contract as the old
// dimsOf, so it's a drop-in for the customer-message side.
//
// NOTE: this is ONLY for parsing what the CUSTOMER wrote. Catalog `size` fields
// ("6x4m", "13x54m") are clean, controlled data and keep their deterministic
// parse — no AI needed there.
//
// Cached in memory. A measure needs a number, so messages without any digit
// skip the API entirely (cheap cost guard, not a meaning check).

const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const _cache = new Map();
const _CACHE_MAX = 500;

/**
 * @param {string} text - the customer's message
 * @returns {Promise<number[]|null>} [min, max] in meters, or null if no measure
 */
async function extractMeasure(text) {
  if (!text || typeof text !== 'string') return null;
  // A measure requires a quantity. No digit anywhere → can't be a measure.
  // (Worded-only like "seis por cuatro" is rare; handled below if a digit-free
  // message ever needs it, but skipping the API on "hola"/"gracias" is worth it.)
  if (!/\d/.test(text)) return null;

  const key = text.trim().toLowerCase();
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extrae las DOS dimensiones (medida) que pide el cliente para una malla sombra / lona / rollo, en METROS. El cliente puede expresarlas de cualquier forma:
- "6x4", "6 x 4", "6 por 4", "6X4M"
- "13 de largo x 3 de ancho", "13 metros de largo por 3 de ancho"
- "una de 3 de ancho y 13 de largo", "mide 13 por 3", "3 ancho 13 largo"
- decimales: "5.5 x 3", "2.30x1.80"
- centímetros: conviértelos a metros (150 cm = 1.5)

Devuelve SOLO JSON:
{"found": true, "a": <numero>, "b": <numero>}  // las dos dimensiones en metros
{"found": false}                                 // si el mensaje NO contiene una medida de 2 dimensiones

REGLAS:
- Si solo hay UNA dimensión (ej. "rollo de 9 m" = largo, ancho fijo), devuelve found:false (no es una medida de 2 lados) A MENOS que el contexto deje claro las dos.
- Cantidades que NO son medidas (precio $699, "2 piezas", porcentajes 90%, códigos postales) → found:false.
- No inventes una segunda dimensión.

EJEMPLOS:
- "13 de largo x 3 de ancho" → {"found":true,"a":13,"b":3}
- "una maya 3x6" → {"found":true,"a":3,"b":6}
- "5.5 por 3 metros" → {"found":true,"a":5.5,"b":3}
- "150x200 cm" → {"found":true,"a":1.5,"b":2}
- "quiero la de 699" → {"found":false}
- "2 piezas" → {"found":false}
- "rollo de 9 m" → {"found":false}`
        },
        { role: 'user', content: text }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    let result = null;
    if (parsed.found === true) {
      const a = Number(parsed.a);
      const b = Number(parsed.b);
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
        result = [a, b].sort((x, y) => x - y);
      }
    }
    if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error('❌ extractMeasure error:', err.message);
    return null;
  }
}

module.exports = { extractMeasure };
