// ai/utils/dimensionParsers.js
// AI-driven dimension extraction. No regex.

const { OpenAI } = require("openai");
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Extract width and height from a customer message using AI.
 * @param {string} str - Customer message
 * @returns {Promise<{ width: number, height: number, normalized: string, hasFractional: boolean, convertedFromFeet?: boolean, originalFeetStr?: string }|null>}
 */
async function parseConfeccionadaDimensions(str) {
  if (!str) return null;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extrae las dimensiones (ancho y largo en metros) del mensaje del cliente. Responde con JSON:
{ "found": true, "dim1": <número>, "dim2": <número>, "isFeet": false }
o si NO hay dimensiones:
{ "found": false }

REGLAS:
- Solo extrae si el cliente menciona UNA medida con dos dimensiones (ancho x largo, largo x ancho, NxN, etc.)
- Interpreta cualquier formato: "8 mts de largo por 2 de ancho", "3x4", "6 por 8", "8*9", etc.
- Números escritos en español cuentan: "seis por cuatro" → dim1: 6, dim2: 4. "tres por cinco" → dim1: 3, dim2: 5. Convierte el texto a número.
- Si las unidades son pies/feet/ft, pon isFeet: true y devuelve los números en pies (la conversión se hace después)
- Devuelve los números tal cual los expresa el cliente (pueden ser decimales: 3.5, 2.8, etc.)
- Si el mensaje NO contiene dimensiones, devuelve found: false
- Si solo hay UN número (ej: "de 18 metros", "rollo de 54"), devuelve found: false (es largo lineal, no ancho x largo)
- Solo devuelve JSON`
        },
        { role: 'user', content: str }
      ],
      temperature: 0,
      max_tokens: 60,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    if (!parsed.found) return null;

    let d1 = parseFloat(parsed.dim1);
    let d2 = parseFloat(parsed.dim2);
    if (isNaN(d1) || isNaN(d2) || d1 <= 0 || d2 <= 0) return null;

    let convertedFromFeet = false;
    let originalFeetStr = null;

    if (parsed.isFeet) {
      originalFeetStr = `${d1}x${d2} pies`;
      d1 = Math.ceil(d1 * 0.3048);
      d2 = Math.ceil(d2 * 0.3048);
      convertedFromFeet = true;
    }

    const width = Math.min(d1, d2);
    const height = Math.max(d1, d2);
    const hasFractional = (d1 % 1 !== 0) || (d2 % 1 !== 0);

    return {
      width,
      height,
      original: { dim1: d1, dim2: d2 },
      area: d1 * d2,
      normalized: `${width}x${height}`,
      userExpressed: `${parsed.dim1} x ${parsed.dim2}`,
      hasFractional,
      ...(convertedFromFeet ? { convertedFromFeet, originalFeetStr } : {})
    };
  } catch (err) {
    console.error('❌ [dimensionParsers] AI extraction error:', err.message);
    return null;
  }
}

module.exports = {
  parseConfeccionadaDimensions
};
