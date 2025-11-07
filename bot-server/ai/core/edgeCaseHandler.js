// ai/core/edgeCaseHandler.js
const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");

/**
 * Detects if a message is unintelligible or too complex
 * @param {string} message - User's message
 * @param {object} openai - OpenAI client
 * @returns {Promise<{isUnintelligible: boolean, isComplex: boolean, confidence: number}>}
 */
async function detectEdgeCase(message, openai) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Analiza el siguiente mensaje de un cliente y clasifícalo en una de estas categorías:

UNINTELLIGIBLE: SOLO para mensajes VERDADERAMENTE incomprensibles sin ningún sentido aparente
- Ejemplos: "asdfgh", "ksksksk", "?????" (solo símbolos sin contexto), emojis aleatorios sin texto
- NO son unintelligible:
  * Errores de tipeo (ej: "recio" por "precio", "deesa" por "de esa", "donde se uvican")
  * Mensajes en MAYÚSCULAS (ej: "DONDE SE UBICAN", "CUANTO CUESTA")
  * Respuestas cortas en contexto (ej: "si", "si esa", "de esa medida", "la que envié")
  * Mensajes mal formateados con saltos de línea o puntuación extraña
  * Abreviaciones comunes (ej: "q", "tb", "tmb", "xq")
  * IMPORTANTE: Si puedes inferir la intención del mensaje, es NORMAL, no UNINTELLIGIBLE

COMPLEX: El mensaje requiere análisis técnico avanzado, cálculos complejos personalizados, o conocimiento muy especializado
- Ejemplos: "necesito calcular cuánta malla necesito para cubrir un área irregular de 45m² con altura variable entre 2.5m y 4m con sistema de tensores automáticos", "necesito certificación UV para exportación a Estados Unidos"
- NO son complejas: preguntas sobre tamaños custom simples, preguntas sobre instalación, preguntas sobre colores o materiales, preguntas sobre ubicación o precio

NORMAL: Cualquier pregunta que un chatbot de ventas básico pueda responder (¡PREFIERE ESTA CATEGORÍA en casos dudosos!)
- Ejemplos: "tienes malla sombra?", "cuánto cuesta?", "qué colores hay?", "hacen envíos?", "donde estan?", "precio", "ubicacion"
- Incluye: preguntas con typos, mensajes en mayúsculas, preguntas múltiples simples (precio + ubicación)

Responde ÚNICAMENTE con un JSON:
{
  "category": "UNINTELLIGIBLE" | "COMPLEX" | "NORMAL",
  "confidence": 0.0-1.0,
  "reason": "breve explicación"
}`
        },
        { role: "user", content: message }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      isUnintelligible: result.category === "UNINTELLIGIBLE",
      isComplex: result.category === "COMPLEX",
      confidence: result.confidence || 0.8,
      reason: result.reason || ""
    };
  } catch (error) {
    console.error("❌ Error detectando edge case:", error);
    // En caso de error, asumir mensaje normal
    return { isUnintelligible: false, isComplex: false, confidence: 0 };
  }
}

/**
 * Handles unintelligible messages - asks for clarification once, then hands off
 */
async function handleUnintelligible(psid, convo, BOT_PERSONA_NAME) {
  const clarificationCount = convo.clarificationCount || 0;

  if (clarificationCount === 0) {
    // Primera vez - pedir clarificación
    await updateConversation(psid, {
      lastIntent: "needs_clarification",
      clarificationCount: 1
    });

    return {
      type: "text",
      text: `Disculpa, no logré entender tu mensaje 😅\n¿Podrías reformular tu pregunta? Por ejemplo:\n• "¿Tienes malla sombra?"\n• "¿Cuánto cuesta?"\n• "¿Hacen envíos?"`
    };
  } else {
    // Segunda vez - derivar a humano
    const info = await getBusinessInfo();
    await updateConversation(psid, {
      lastIntent: "human_handoff",
      clarificationCount: 0,
      state: "needs_human"
    });

    return {
      type: "text",
      text: `Lo siento 😔 sigo sin comprender bien.\n\nTe paso con alguien de nuestro equipo que puede ayudarte mejor 👇\n\n📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n🕓 ${info?.hours || "Lun-Vie 9am-6pm"}\n\nTambién puedes escribirnos aquí y te responderemos pronto 💬`
    };
  }
}

/**
 * Handles complex questions - immediate human handoff
 */
async function handleComplexQuestion(psid, reason) {
  const info = await getBusinessInfo();

  await updateConversation(psid, {
    lastIntent: "complex_query",
    state: "needs_human"
  });

  return {
    type: "text",
    text: `Entiendo que tu consulta requiere una atención más especializada 🤓\n\nPermíteme conectarte con un asesor que podrá ayudarte mejor con esto:\n\n📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n🕓 ${info?.hours || "Lun-Vie 9am-6pm"}\n\nTambién puedes escribirnos aquí por Messenger y te respondemos pronto 💬`
  };
}

module.exports = {
  detectEdgeCase,
  handleUnintelligible,
  handleComplexQuestion
};
