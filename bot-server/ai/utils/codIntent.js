// ai/utils/codIntent.js
//
// AI-based classifier for "is the customer asking about cash-on-delivery?".
// Replaces the regex which missed typos ("pago al recivir"), creative
// phrasings ("ya cuando llegue pago"), and English ("pay on delivery").
//
// Cached in memory to avoid spamming the API on repeats.

const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const _cache = new Map();
const _CACHE_MAX = 500;

/**
 * @param {string} message
 * @returns {Promise<boolean>} true if the customer is asking about COD / pay-on-delivery
 */
async function asksAboutCOD(message) {
  if (!message || typeof message !== 'string') return false;
  const key = message.trim().toLowerCase();
  if (key.length < 3) return false;
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Decide si el cliente está preguntando o mencionando el método de pago "contra entrega" / "pago al recibir" / "pago a la entrega" (cash on delivery). Incluye variantes con typos como "recivir", "contra-entrega", "pago al recogerlo", "lo pago cuando llegue", "hasta que me llegue", "pay on delivery", "COD". También incluye cuando el cliente afirma haber visto que ofrecemos pago contra entrega (ej: "en sus anuncios dice contra entrega").

Responde JSON: {"asksAboutCOD": true|false}

EJEMPLOS true:
- "pago al recibir"
- "pago al recivir" (typo)
- "Pago a la entrega"
- "contra entrega"
- "se paga cuando llegue"
- "puedo pagar al recogerlo?"
- "tienen pago contra entrega"
- "en sus anuncios dice pago en contra entrega"
- "lo pago hasta que me llegue"

EJEMPLOS false:
- "ya la pagué"
- "cuánto cuesta"
- "puedo pagar con tarjeta"
- "el envío es gratis?"
- cualquier otro tema`
        },
        { role: 'user', content: message }
      ],
      temperature: 0,
      max_tokens: 20,
      response_format: { type: 'json_object' }
    });
    const result = JSON.parse(res.choices[0].message.content).asksAboutCOD === true;
    if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error('❌ asksAboutCOD error:', err.message);
    return false;
  }
}

module.exports = { asksAboutCOD };
