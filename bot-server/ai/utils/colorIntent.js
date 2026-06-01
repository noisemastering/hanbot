// ai/utils/colorIntent.js
//
// Classifies a customer's color mention into:
//   - 'beige'        → customer asked for beige directly
//   - 'brown_family' → customer asked for a brown-family shade
//                      (café / chocolate / marrón / arena / crema / tan /
//                      ocre / camel, etc.) — equivalent to our beige
//   - 'other'        → customer asked for any other color (verde, negro,
//                      azul, blanco, rojo, gris, amarillo, …)
//   - null           → no color mentioned
//
// Used by convoFlow to decide whether to offer beige (brown_family / beige)
// or to escalate to a human (other).

const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const _cache = new Map();
const _CACHE_MAX = 500;

/**
 * @param {string} message
 * @returns {Promise<{kind: 'beige'|'brown_family'|'other'|null, requestedColor: string|null}>}
 */
async function classifyColorIntent(message) {
  if (!message || typeof message !== 'string') return { kind: null, requestedColor: null };
  const key = message.trim().toLowerCase();
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un clasificador de intención de color para una conversación con un fabricante de malla sombra. El único color disponible es BEIGE.

Decide la categoría del color que pide el cliente en su mensaje:

- "beige": el cliente menciona "beige" directamente (cualquier variante: beis, beiges)
- "brown_family": el cliente pide un tono de la familia café/marrón/amarillo que para fines prácticos es equivalente a nuestro beige. Incluye: café (claro o sin matiz), chocolate, marrón, marron, arena, crema, kraft, tan, ocre, camel, beige tostado, color tierra, terracota suave, amarillo, amarilla, amarillento, mostaza, mostaza claro, paja
- "other": el cliente pide CUALQUIER otro color (verde, negro, blanco, azul, rojo, gris, naranja, morado, rosa, transparente, dorado, plata, etc.)
- "none": el cliente NO menciona color alguno

Responde JSON: {"kind": "beige"|"brown_family"|"other"|"none", "requestedColor": "<color exacto que pidió el cliente o null>"}

Ejemplos:
- "tienes en beige?" → {"kind": "beige", "requestedColor": "beige"}
- "lo tienes en café?" → {"kind": "brown_family", "requestedColor": "café"}
- "color chocolate o marrón?" → {"kind": "brown_family", "requestedColor": "chocolate"}
- "tengo opción de verde?" → {"kind": "other", "requestedColor": "verde"}
- "y en negro?" → {"kind": "other", "requestedColor": "negro"}
- "qué precio tiene?" → {"kind": "none", "requestedColor": null}
- "color crema" → {"kind": "brown_family", "requestedColor": "crema"}
- "blanco hueso" → {"kind": "other", "requestedColor": "blanco hueso"}
- "lo tienes en amarillo?" → {"kind": "brown_family", "requestedColor": "amarillo"}
- "color mostaza" → {"kind": "brown_family", "requestedColor": "mostaza"}`
        },
        { role: 'user', content: message }
      ],
      temperature: 0,
      max_tokens: 50,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const result = {
      kind: ['beige', 'brown_family', 'other'].includes(parsed.kind) ? parsed.kind : null,
      requestedColor: parsed.requestedColor || null
    };

    if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error('❌ classifyColorIntent error:', err.message);
    return { kind: null, requestedColor: null };
  }
}

module.exports = { classifyColorIntent };
