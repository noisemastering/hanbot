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

// Helper function to get recent conversation history
async function getRecentConversationHistory(psid, limit = 4) {
  try {
    const Message = require('../../models/Message');
    // Get last N messages (user, bot, and human) sorted by timestamp descending
    const messages = await Message.find({ psid })
      .sort({ timestamp: -1 })
      .limit(limit);

    // Return in chronological order (oldest first)
    return messages.reverse();
  } catch (err) {
    console.error("❌ Error fetching conversation history:", err);
    return [];
  }
}

// Helper function to try understanding a message with AI
async function tryUnderstandMessage(message, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory = []) {
  const isOngoingConversation = convo.greeted === true || convo.state !== 'new';
  const conversationContext = isOngoingConversation
    ? "\n⚠️ CRÍTICO: Esta es una conversación EN CURSO. NO saludes con 'Hola', '¡Hola!', 'Buenas', etc. Ve directo al punto de la respuesta."
    : "\n✅ Esta es una conversación NUEVA. Puedes saludar brevemente si es apropiado.";

  // Build conversation history context
  let historyContext = "";
  if (conversationHistory.length > 0) {
    historyContext = "\n\n📜 HISTORIAL DE LA CONVERSACIÓN:\n";
    conversationHistory.forEach(msg => {
      const role = msg.senderType === 'user' ? 'Cliente' : 'Tú (bot)';
      historyContext += `${role}: ${msg.text}\n`;
    });
    historyContext += "\n⚠️ IMPORTANTE: NO repitas información que YA le dijiste al cliente en el historial anterior. Si ya explicaste algo, simplemente reconoce su respuesta y ofrece el siguiente paso.";
  }

  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Eres ${BOT_PERSONA_NAME}, asesora de ventas de Hanlob, empresa mexicana de mallas sombra en Querétaro.
${conversationContext}${historyContext}

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
- NUNCA inventes información o servicios que no ofrecemos

**IMPORTANTE: Si el mensaje es confuso, fragmentado, o no puedes entender qué pregunta el cliente, responde exactamente: "MENSAJE_NO_ENTENDIDO"**`
        },
        { role: "user", content: message }
      ],
      temperature: 0.7
    });

    const aiReply = response.choices?.[0]?.message?.content || '';

    // Check if AI couldn't understand
    if (aiReply.includes('MENSAJE_NO_ENTENDIDO') || aiReply.includes('no tengo información') || aiReply.length < 20) {
      return { text: aiReply, isGeneric: true };
    }

    // Strip greetings if ongoing conversation
    let cleanReply = aiReply;
    if (isOngoingConversation) {
      cleanReply = aiReply.replace(/^¡?Hola!?\s*/i, '');
      cleanReply = cleanReply.replace(/^Buenas\s+(tardes?|d[ií]as?|noches?)!?\s*/i, '');
      cleanReply = cleanReply.replace(/^Qu[eé]\s+tal!?\s*/i, '');
      cleanReply = cleanReply.replace(/^Hey!?\s*/i, '');
      cleanReply = cleanReply.trim();
    }

    return { text: cleanReply, isGeneric: false };
  } catch (err) {
    console.error("❌ Error in tryUnderstandMessage:", err);
    return null;
  }
}

// Helper function to get previous user message
async function getPreviousUserMessage(psid) {
  try {
    const Message = require('../../models/Message');
    // Get last 2 user messages
    const messages = await Message.find({ psid, senderType: 'user' })
      .sort({ timestamp: -1 })
      .limit(2);

    // Return the second one (previous message) if it exists
    return messages.length > 1 ? messages[1].text : null;
  } catch (err) {
    console.error("❌ Error fetching previous message:", err);
    return null;
  }
}

async function handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME) {
  const businessInfo = await getBusinessInfo();

  // 🏭 Detect frustration about size limitations / custom manufacturing requests
  const customManufacturingFrustration = /\b(fabricante|manufacturer|manufactur|hacer.*medid|medid.*especial|medid.*solicit|no\s+cubre|no\s+cubr|área\s+que\s+necesito|no.*ayud.*nada|pueden\s+hacer|puede\s+hacer)\b/i.test(userMessage);

  if (customManufacturingFrustration) {
    console.log(`🏭 Custom manufacturing frustration detected, handing off to specialist`);

    await updateConversation(psid, {
      unknownCount: 0,
      handoffRequested: true,
      handoffReason: "Customer requesting custom manufacturing - needs specialist",
      handoffTimestamp: new Date(),
      state: "needs_human",
      lastIntent: "custom_manufacturing_request"
    });

    return {
      type: "text",
      text:
        `Tienes toda la razón, somos fabricantes y SÍ podemos hacer mallas a la medida que necesites.\n\n` +
        `Voy a transferir tu caso con un especialista que te dará una cotización personalizada. ` +
        `Por favor comunícate con nuestro equipo:\n\n` +
        `📞 ${businessInfo.phones.join(" / ")}\n` +
        `🕓 ${businessInfo.hours}\n` +
        `📍 ${businessInfo.address}`
    };
  }

  // 📜 Get recent conversation history (last 4 messages for context)
  const conversationHistory = await getRecentConversationHistory(psid, 4);
  console.log(`📜 Retrieved ${conversationHistory.length} messages for conversation context`);

  // 🧠 Try to understand the message with full conversation context
  const contextualResponse = await tryUnderstandMessage(userMessage, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory);

  if (contextualResponse && !contextualResponse.isGeneric) {
    console.log(`✅ Message understood with conversation context!`);
    await updateConversation(psid, { lastIntent: "fallback_contextual", unknownCount: 0 });
    return { type: "text", text: contextualResponse.text };
  }

  // 🔗 Try stitching with previous message as fallback
  const previousMessage = await getPreviousUserMessage(psid);
  if (previousMessage) {
    const stitchedMessage = `${previousMessage} ${userMessage}`;
    console.log(`🧩 Trying stitched message: "${stitchedMessage}"`);

    // Try to understand the stitched message
    const stitchedResponse = await tryUnderstandMessage(stitchedMessage, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory);

    if (stitchedResponse && !stitchedResponse.isGeneric) {
      console.log(`✅ Stitched message understood!`);
      await updateConversation(psid, { lastIntent: "fallback_stitched", unknownCount: 0 });
      return { type: "text", text: stitchedResponse.text };
    }
  }

  // If stitching didn't work, use simple clarification message
  console.log(`❓ Message not understood, using simple clarification`);

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

  // Before reaching handoff threshold, use simple clarification message
  return { type: "text", text: "Lo siento, no entendí la pregunta. ¿Podrías repetirla?" };
}

module.exports = { handleFallback };
