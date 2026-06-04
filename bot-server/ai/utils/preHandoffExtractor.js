// ai/utils/preHandoffExtractor.js
//
// AI extractor for the pre-handoff checklist: name, zip code, quantity.
// The full name is what the customer wants the agent to call them; zip is
// for routing/shipping; quantity is how many units they want.
//
// Caller is responsible for handling each field (saving to convo,
// re-asking if missing, etc).

const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Extract {name, zip, quantity} from a customer message.
 * Returns nulls for fields not detected. Never invents.
 *
 * @param {string} message
 * @returns {Promise<{ name: string|null, zip: string|null, quantity: number|null }>}
 */
async function extractPreHandoffData(message) {
  if (!message || typeof message !== 'string') {
    return { name: null, zip: null, quantity: null };
  }

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extrae datos de contacto del cliente para una mesa de ventas. Responde JSON:
{ "name": "<nombre completo si lo mencionó o null>", "zip": "<código postal de 5 dígitos si lo mencionó o null>", "quantity": <cantidad entera de piezas/unidades si la mencionó o null> }

REGLAS:
- name: extrae si el cliente da su nombre claramente ("soy Tony", "me llamo María", "Carlos Pérez", "es para Juan"). NO inventes; si no hay nombre claro → null.
- zip: SOLO 5 dígitos juntos. Si menciona código postal con menos/más dígitos → null.
- quantity: cantidad entera de piezas. Acepta: "dos" → 2, "una" → 1, "10 piezas" → 10, "necesito 3" → 3. Distingue entre cantidad y MEDIDAS: "5 metros" no es cantidad. Si el cliente solo dice "una", interpreta como 1.
- Si un dato no aparece o es ambiguo → null para ese campo.
- Solo JSON, sin texto extra.`
        },
        { role: 'user', content: message }
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const result = {
      name: parsed.name && typeof parsed.name === 'string' && parsed.name.trim().length >= 2
        ? parsed.name.trim().slice(0, 80) : null,
      zip: parsed.zip && /^\d{5}$/.test(String(parsed.zip).trim())
        ? String(parsed.zip).trim() : null,
      quantity: Number.isInteger(parsed.quantity) && parsed.quantity > 0 && parsed.quantity < 10000
        ? parsed.quantity : null
    };
    return result;
  } catch (err) {
    console.error('❌ extractPreHandoffData error:', err.message);
    return { name: null, zip: null, quantity: null };
  }
}

module.exports = { extractPreHandoffData };
