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
- ${flowType === 'rollo' ? 'La compra es directa con nosotros (no por Mercado Libre). Se requiere código postal para cotizar envío.' : 'La compra se realiza a través de Mercado Libre, el envío está incluido'}
- Tiempo de entrega: normalmente 1 a 2 días hábiles, el tiempo exacto se confirma una vez realizada la compra
${flowType === 'borde' ? `- Borde separador: cinta plástica para delimitar jardín, se mide en metros lineales
- Fabricante directo (no revendedor)` : `- Malla sombra confeccionada: raschel 90% sombra, con ojillos para sujeción cada 80 cm por lado, refuerzo en esquinas, lista para instalar. Colores disponibles: negro y beige
- Rollos: malla sombra raschel en rollos de 100m, disponibles en 35%, 50%, 70%, 80% y 90%
- Borde separador: cinta plástica para delimitar jardín
- La malla confeccionada NO incluye cuerda/lazo para instalar, se vende por separado
- Fabricante directo (no revendedor) — SÍ hacemos malla a la medida que el cliente necesite
- Si preguntan si hacen medidas especiales/personalizadas/a la medida: SÍ, somos fabricantes y hacemos la malla a la medida`}
- Formas de pago: las que acepta Mercado Libre (tarjeta, transferencia, efectivo en OXXO, etc.)

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
- Si dice "sí", "esa", "ésa", "sí esa", "va", "dale", "por favor", "xfavor", "xfa" → select_one index 0 si solo hay 1 producto
- Si dice "sí", "va", "dale", "por favor", "xfavor" con múltiples productos → select_products con TODOS los índices (el bot acaba de preguntar "¿Quieres los enlaces?", así que "sí" = todos)
- Confidence < 0.7 = el bot no actuará sobre tu interpretación
- PRIORIDAD: Si el cliente selecciona un producto Y además hace una pregunta (ej: "la de 4x6 y cómo es la entrega"), SIEMPRE devuelve select_one/select_products. La pregunta sobre entrega/pago se responderá automáticamente al darle el enlace de compra.
- Las medidas SIEMPRE se expresan con 2 lados: ancho x largo (ej: 5x5m, 4x3m). NUNCA uses 3 dimensiones — la malla es un producto plano.
- Para answer_question: responde en español, máximo 2 oraciones, directo y sin relleno. NO uses frases como "Gracias por mencionarlo", "¡Excelente pregunta!", "Claro que sí" ni muletillas. Ve directo a la respuesta.
- Para answer_question: USA SOLO los datos de la empresa listados arriba, NO inventes información
- Para answer_question: NUNCA incluyas URLs ni enlaces en el texto. Si el cliente pide el link de compra o no sabe cómo comprar, usa select_one (index 0 si solo hay 1 producto) para que el sistema genere el enlace correcto
- ${flowType === 'rollo' ? 'Cuando hables de compra/envío, di "La compra es directa con nosotros, necesitamos tu código postal para cotizar el envío"' : 'Cuando hables de entrega/envío/compra, di "La compra se realiza a través de Mercado Libre y el envío está incluido"'}
- NUNCA digas "Envíamos a todo México" como respuesta genérica`;

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
