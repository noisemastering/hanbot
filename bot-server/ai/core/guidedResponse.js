// ai/core/guidedResponse.js
// Generates AI responses using a template as guidance (not copying verbatim)

const { OpenAI } = require("openai");
const { getBusinessInfo } = require("../../businessInfoManager");

// Lazy initialization to ensure env vars are loaded
let openai = null;
function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Generate an AI response using a template as guidance
 * The AI will use the template's key information but generate a natural response
 *
 * @param {string} userMessage - The user's message
 * @param {string} template - The response template to use as guidance
 * @param {string} intentName - Name of the detected intent (for context)
 * @param {object} convo - Conversation object
 * @returns {Promise<{type: string, text: string}>}
 */
async function generateGuidedResponse(userMessage, template, intentName, convo) {
  try {
    const businessInfo = await getBusinessInfo();

    const isOngoingConversation = convo?.greeted === true || convo?.state !== 'new';

    const response = await getOpenAI().chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un asistente de ventas de Hanlob, empresa mexicana de mallas sombra en Querétaro.

CONTEXTO DE LA CONVERSACIÓN:
- Intent detectado: ${intentName}
- ${isOngoingConversation ? 'Esta es una conversación EN CURSO. NO saludes.' : 'Esta es una conversación nueva.'}

INFORMACIÓN CLAVE QUE DEBES TRANSMITIR:
"""
${template}
"""

INSTRUCCIONES:
1. Usa la información clave de arriba como GUÍA para tu respuesta
2. NO copies el texto textualmente - reformúlalo de forma natural y conversacional
3. Adapta el tono al mensaje del usuario
4. Si el usuario pregunta algo específico que está en la guía, respóndelo directamente
5. Puedes añadir contexto relevante si es necesario
6. Mantén la respuesta concisa pero completa
7. Si la guía menciona precios o datos específicos, inclúyelos exactamente
8. Termina con una pregunta o invitación natural si es apropiado

DATOS DE CONTACTO (si son relevantes):
- Teléfono: ${businessInfo?.phones?.join(", ") || "442 352 1646"}
- Horario: ${businessInfo?.hours || "Lunes a Viernes 8am - 6pm"}
- Vendemos en Mercado Libre (NO incluyas links/URLs - el sistema los agrega automáticamente)`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const aiReply = response.choices?.[0]?.message?.content || template;

    // Strip greetings if ongoing conversation
    let cleanReply = aiReply;
    if (isOngoingConversation) {
      cleanReply = aiReply.replace(/^¡?Hola!?\s*/i, '');
      cleanReply = cleanReply.replace(/^Buenas\s+(tardes?|d[ií]as?|noches?)!?\s*/i, '');
      cleanReply = cleanReply.replace(/^Qu[eé]\s+tal!?\s*/i, '');
      cleanReply = cleanReply.trim();
    }

    console.log(`🤖 AI generated guided response for "${intentName}"`);

    return {
      type: "text",
      text: cleanReply,
      handledBy: "intent_ai_generate"
    };
  } catch (err) {
    console.error("❌ Error generating guided response:", err);
    // Fallback to template if AI fails
    return {
      type: "text",
      text: template,
      handledBy: "intent_ai_generate_fallback"
    };
  }
}

module.exports = { generateGuidedResponse };
