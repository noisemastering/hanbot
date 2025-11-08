// ai/core/fallback.js
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");

// Helper function to check if we're in business hours (Mon-Fri, 9am-6pm Mexico City time)
function isBusinessHours() {
  // Get current time in Mexico City (UTC-6)
  const now = new Date();
  const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

  const day = mexicoTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = mexicoTime.getHours();

  // Monday-Friday (1-5) and between 9am-6pm
  const isWeekday = day >= 1 && day <= 5;
  const isDuringHours = hour >= 9 && hour < 18;

  return isWeekday && isDuringHours;
}

async function handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME) {
  const businessInfo = await getBusinessInfo();

  // Determine if this is an ongoing conversation
  const isOngoingConversation = convo.greeted === true || convo.state !== 'new';
  const conversationContext = isOngoingConversation
    ? "\n⚠️ CRÍTICO: Esta es una conversación EN CURSO. NO saludes con 'Hola', '¡Hola!', 'Buenas', etc. Ve directo al punto de la respuesta."
    : "\n✅ Esta es una conversación NUEVA. Puedes saludar brevemente si es apropiado.";

  const response = await openai.chat.completions.create({
    model: process.env.AI_MODEL || "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `Eres ${BOT_PERSONA_NAME}, asesora de ventas de Hanlob, empresa mexicana de mallas sombra en Querétaro.
${conversationContext}

PRODUCTOS Y CARACTERÍSTICAS:
- Malla sombra beige 90% confeccionada (medidas: 3x4m - $450, 4x6m - $650)
- **CRÍTICO SOBRE DIMENSIONES**: Las mallas son rectangulares y las dimensiones se pueden voltear:
  * Si preguntan por 4x3m → SÍ TENEMOS, es la misma que 3x4m por $450
  * Si preguntan por 6x4m → SÍ TENEMOS, es la misma que 4x6m por $650
  * Responde: "Sí, la de 4x3m (que es la misma que 3x4m) la tenemos en $450"
- Rollos de malla sombra beige y monofilamento
- Color: Solo BEIGE
- **IMPORTANTE: La malla sombra es PERMEABLE (permite que pase el agua). NO es impermeable ni repele el agua.**
- Proporciona sombra 90% y permite circulación de aire
- Si preguntan por impermeabilidad: aclarar que es PERMEABLE, sugerir lona si necesitan impermeabilidad

TIEMPOS DE ENTREGA:
- CDMX y zona metropolitana: 1-2 días hábiles
- Interior de la República: 3-5 días hábiles

FORMA DE PAGO:
- Pago 100% POR ADELANTADO en Mercado Libre al momento de hacer el pedido (NO se paga al recibir)
- Aceptamos todas las formas de pago de Mercado Libre (tarjetas, efectivo, meses sin intereses)
- Alternativa: Venir a las oficinas en Querétaro y pagar en efectivo o con tarjeta en persona

LO QUE NO OFRECEMOS:
- ❌ NO ofrecemos servicio de instalación, montaje, colocación ni armado
- ❌ NO hacemos instalaciones a domicilio
- El cliente debe instalarla por su cuenta o contratar a alguien

LO QUE SÍ OFRECEMOS:
- ✅ Envíos a toda la República Mexicana (incluido en Querétaro zona urbana)
- ✅ Tienda física en Querétaro (${businessInfo.address})
- ✅ Venta en Tienda Oficial de Mercado Libre

CONTACTO:
- Teléfonos: ${businessInfo.phones.join(", ")}
- Horarios: ${businessInfo.hours}
- Tienda Oficial de Mercado Libre: https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob

INSTRUCCIONES CRÍTICAS:
- **SIEMPRE incluir el link de la Tienda Oficial de Mercado Libre cuando se menciona envío, compra, o ubicación**
- **Si el cliente hace MÚLTIPLES preguntas, responde TODAS en un solo mensaje**
- **Si el cliente pregunta por MÚLTIPLES medidas (ej: "4x3 y 4x4"), responde sobre TODAS las medidas mencionadas**
- Responde con tono humano, empático y completo (responder TODAS las preguntas)
- Si preguntan medidas/precios: menciona las disponibles (3x4m / 4x3m - $450, 4x6m / 6x4m - $650)
- Si preguntan colores: solo beige disponible
- Si preguntan por agua/impermeabilidad: aclarar que es PERMEABLE, no impermeable
- Si preguntan tiempos: especificar 1-2 días CDMX, 3-5 días foráneos
- Si preguntan pago: mencionar que se paga al ordenar en Mercado Libre
- Si una medida pedida no está disponible, sugerir las más cercanas (3x4m o 4x6m)
- Si no sabes algo: discúlpate y ofrece contacto directo
- NUNCA inventes información o servicios que no ofrecemos`
      },
      { role: "user", content: userMessage }
    ],
    temperature: 0.7
  });

  let aiReply = response.choices?.[0]?.message?.content || `Lo siento 😔 no tengo información sobre eso.`;

  // CRITICAL: Strip out greetings from ongoing conversations
  if (isOngoingConversation) {
    // Remove common greetings at the start of the message
    aiReply = aiReply.replace(/^¡?Hola!?\s*/i, '');
    aiReply = aiReply.replace(/^Buenas\s+(tardes?|d[ií]as?|noches?)!?\s*/i, '');
    aiReply = aiReply.replace(/^Qu[eé]\s+tal!?\s*/i, '');
    aiReply = aiReply.replace(/^Hey!?\s*/i, '');
    // Trim any leading whitespace left after removing greeting
    aiReply = aiReply.trim();
  }

  const newUnknownCount = (convo.unknownCount || 0) + 1;
  await updateConversation(psid, { lastIntent: "fallback", unknownCount: newUnknownCount });

  // Determine handoff threshold based on business hours
  // During business hours: hand over immediately (threshold = 1)
  // After hours/weekends: try harder (threshold = 2)
  const inBusinessHours = isBusinessHours();
  const handoffThreshold = inBusinessHours ? 1 : 2;

  console.log(`🕒 Business hours check: ${inBusinessHours ? 'YES' : 'NO'} - Handoff threshold: ${handoffThreshold}`);

  // Flag conversation for human help when bot is struggling
  if (newUnknownCount >= handoffThreshold) {
    const info = await getBusinessInfo();

    // Mark conversation as needing human intervention
    const handoffContext = inBusinessHours
      ? "during business hours"
      : "after hours/weekend";

    await updateConversation(psid, {
      unknownCount: 0,
      handoffRequested: true,
      handoffReason: `Bot unable to help after ${newUnknownCount} unknown message(s) ${handoffContext}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    if (!info) {
      return { type: "text", text: `Lo siento 😔, no tengo información disponible. Si deseas hablar con un asesor, puedo darte los teléfonos.` };
    }

    return {
      type: "text",
      text:
        `Lo siento 😔, por el momento no tengo información disponible.\n` +
        `Si deseas hablar directamente con alguien de nuestro equipo, puedes comunicarte 📞:\n\n` +
        `${info.phones.join(" / ")}\n🕓 Horarios de atención: ${info.hours}\n📍 ${info.address}`
    };
  }

  return { type: "text", text: aiReply };
}

module.exports = { handleFallback };
