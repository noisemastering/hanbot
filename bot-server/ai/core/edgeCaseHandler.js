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

UNINTELLIGIBLE: El mensaje es completamente incomprensible, tiene errores graves de escritura sin sentido, es spam, o no tiene ningún contenido útil
- Ejemplos: "asdfgh", "ksksksk", "?????" (solo símbolos), emojis sin ningún contexto
- NO son unintelligible: "si", "si esa", "de esa medida", "la que envié" (respuestas cortas en contexto), "hola hola", errores de tipeo menores como "deesa" por "de esa"

COMPLEX: El mensaje requiere análisis técnico avanzado, cálculos complejos personalizados, o conocimiento muy especializado
- Ejemplos: "necesito calcular cuánta malla necesito para cubrir un área irregular de 45m² con altura variable entre 2.5m y 4m con sistema de tensores automáticos", "necesito certificación UV para exportación a Estados Unidos"
- NO son complejas: preguntas sobre tamaños custom simples, preguntas sobre instalación, preguntas sobre colores o materiales

NORMAL: Cualquier pregunta que un chatbot de ventas básico pueda responder (¡PREFIERE ESTA CATEGORÍA en casos dudosos!)
- Ejemplos: "tienes malla sombra?", "cuánto cuesta?", "qué colores hay?", "hacen envíos?", "si", "si esa", "de esa medida", "la que les envié", referencias a medidas mencionadas antes

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
