// ai/utils/flowFallback.js
// AI fallback for flow dead-ends — when regex can't parse user intent,
// ask AI to interpret the message in context and return a structured action.

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const Message = require("../../models/Message");

/**
 * Get recent conversation history for context
 */
async function getRecentMessages(psid, limit = 6) {
  try {
    const messages = await Message.find({ psid })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    return messages.reverse();
  } catch (err) {
    console.error("❌ flowFallback: Error fetching messages:", err.message);
    return [];
  }
}

/**
 * Resolve user intent with AI when regex fails.
 *
 * @param {object} opts
 * @param {string} opts.psid - User ID for fetching conversation history
 * @param {string} opts.userMessage - The message regex couldn't parse
 * @param {string} opts.flowType - "malla" | "rollo" | "borde"
 * @param {string} opts.stage - Current flow stage
 * @param {object} opts.basket - convo.productSpecs (accumulated specs)
 * @param {Array}  opts.lastQuotedProducts - Products shown in the last bot message
 * @returns {object} Structured action: { action, confidence, ... }
 */
async function resolveWithAI({ psid, userMessage, flowType, stage, basket, lastQuotedProducts }) {
  try {
    // Build conversation context from recent messages
    const recentMessages = await getRecentMessages(psid, 6);
    const chatLines = recentMessages.map(m => {
      const role = m.sender === 'user' ? 'Cliente' : 'Bot';
      return `${role}: ${m.text || m.message || ''}`;
    }).filter(line => line.length > 5);

    const quotedList = (lastQuotedProducts || []).map((p, i) =>
      `  [${i}] ${p.displayText || `${p.width}x${p.height}m`}${p.price ? ` - $${p.price}` : ''}`
    ).join('\n');

    const systemPrompt = `Eres un intérprete de intenciones para un chatbot de ventas de malla sombra (Hanlob).
El bot acaba de mostrar productos o hacer una pregunta, y el cliente respondió algo que el regex no pudo parsear.
Tu trabajo es interpretar QUÉ QUIERE el cliente y devolver una acción estructurada en JSON.

DATOS DE LA EMPRESA (usa estos para answer_question):
- Envío GRATIS a todo México y Estados Unidos a través de Mercado Libre
- Tiempo de entrega: normalmente 1 a 2 días hábiles, el tiempo exacto se confirma una vez realizada la compra
- Malla sombra confeccionada: raschel 90% sombra, con argollas y refuerzos, lista para instalar
- Rollos: malla sombra raschel en rollos de 100m, disponibles en 35%, 50%, 70%, 80% y 90%
- Borde separador: cinta plástica para delimitar jardín
- Formas de pago: las que acepta Mercado Libre (tarjeta, transferencia, efectivo en OXXO, etc.)
- La malla confeccionada NO incluye cuerda/lazo para instalar, se vende por separado
- Fabricante directo (no revendedor)

CONTEXTO:
- Flujo actual: ${flowType}
- Etapa: ${stage}
- Specs acumulados: ${JSON.stringify(basket || {})}
${quotedList ? `- Productos cotizados en el último mensaje:\n${quotedList}` : '- No hay productos cotizados recientes'}

CONVERSACIÓN RECIENTE:
${chatLines.join('\n')}

ACCIONES POSIBLES:
1. "select_products" — El cliente quiere VARIOS de los productos cotizados (ej: "las dos", "todas", "la primera y la tercera")
   Devuelve: { "action": "select_products", "selectedIndices": [0, 1], "confidence": 0.9 }

2. "select_one" — El cliente quiere UNO de los productos cotizados (ej: "la primera", "esa", "la de 5x7", "sí esa")
   Devuelve: { "action": "select_one", "selectedIndex": 0, "confidence": 0.85 }

3. "provide_dimensions" — El cliente está dando medidas de una forma no estándar
   Devuelve: { "action": "provide_dimensions", "dimensions": { "width": 5, "height": 7 }, "confidence": 0.8 }

4. "answer_question" — El cliente hace una pregunta que puedes responder con los DATOS DE LA EMPRESA
   Devuelve: { "action": "answer_question", "text": "Los envíos normalmente toman de 1 a 2 días hábiles, el tiempo exacto se confirma una vez realizada la compra.", "confidence": 0.9 }

5. "none" — No puedes interpretar la intención con confianza
   Devuelve: { "action": "none", "confidence": 0.3 }

REGLAS:
- Solo devuelve JSON válido, sin texto adicional
- selectedIndices y selectedIndex son 0-based y DEBEN corresponder a los productos cotizados
- Si el cliente dice "las dos", "ambas", "todas" → select_products con todos los índices
- Si dice "la primera", "la de arriba" → select_one con index 0
- Si dice "la segunda", "la otra", "la de abajo" → select_one con index 1
- Si dice "sí", "esa", "ésa", "sí esa", "va", "dale" y solo hay 1 producto cotizado → select_one index 0
- Si dice "sí" con múltiples productos → NO asumas cuál, devuelve none
- Confidence < 0.7 = el bot no actuará sobre tu interpretación
- Para answer_question: responde en español, máximo 2 oraciones, como vendedor amable
- Para answer_question: USA SOLO los datos de la empresa listados arriba, NO inventes información`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Mensaje del cliente: "${userMessage}"` }
      ],
      temperature: 0.3,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    console.log(`🧠 flowFallback [${flowType}/${stage}]: "${userMessage}" → ${JSON.stringify(parsed)}`);
    return parsed;
  } catch (error) {
    console.error("❌ flowFallback AI error:", error.message);
    return { action: "none", confidence: 0 };
  }
}

module.exports = { resolveWithAI };
