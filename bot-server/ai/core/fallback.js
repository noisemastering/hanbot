// ai/core/fallback.js
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getAngleMessaging } = require("../utils/adContextHelper");

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

// Helper function to build ad context section for the prompt
function buildAdContextPrompt(adContext) {
  if (!adContext) return "";

  let prompt = "\n\n🎯 CONTEXTO DEL ANUNCIO QUE TRAJO AL CLIENTE:";

  // Add angle-specific guidance
  if (adContext.adAngle) {
    const angleMsg = getAngleMessaging(adContext.adAngle);
    const angleDescriptions = {
      price_sensitive: "El cliente llegó por un anuncio enfocado en PRECIO/VALOR. Enfatiza precios competitivos y buena relación calidad-precio.",
      quality_premium: "El cliente llegó por un anuncio enfocado en CALIDAD. Enfatiza durabilidad, garantía y calidad premium.",
      urgency_offer: "El cliente llegó por un anuncio con OFERTA/PROMOCIÓN. Menciona que la promoción está vigente.",
      problem_pain: "El cliente llegó por un anuncio sobre PROTECCIÓN SOLAR. Enfatiza cómo la malla resuelve problemas de sol/calor.",
      bulk_b2b: "El cliente llegó por un anuncio para NEGOCIOS/MAYOREO. Usa tono profesional, menciona precios por volumen.",
      diy_ease: "El cliente llegó por un anuncio de FÁCIL INSTALACIÓN. Enfatiza que es fácil de instalar uno mismo.",
      comparison_switching: "El cliente llegó por un anuncio COMPARATIVO. Enfatiza por qué somos mejor opción que la competencia."
    };
    prompt += `\n- Ángulo: ${angleDescriptions[adContext.adAngle] || adContext.adAngle}`;
    if (angleMsg?.emphasis) {
      prompt += ` (énfasis en: ${angleMsg.emphasis})`;
    }
  }

  // Add audience context
  if (adContext.adIntent?.audienceType) {
    prompt += `\n- Audiencia: ${adContext.adIntent.audienceType}`;

    // Adjust tone based on audience
    const audience = adContext.adIntent.audienceType.toLowerCase();
    if (audience.includes("agricultor") || audience.includes("invernadero") || audience.includes("vivero") || audience.includes("agr")) {
      prompt += "\n- Tono: TÉCNICO/PROFESIONAL - usa términos como 'protección de cultivos', 'sombreado agrícola', 'regulación de temperatura'";
    } else if (audience.includes("casa") || audience.includes("hogar") || audience.includes("residencial") || audience.includes("jardín")) {
      prompt += "\n- Tono: AMIGABLE/CASUAL - usa términos como 'patio', 'jardín', 'terraza', 'disfrutar tu espacio'";
    } else if (audience.includes("negocio") || audience.includes("comercial") || audience.includes("distribuidor")) {
      prompt += "\n- Tono: PROFESIONAL/B2B - menciona volumen, disponibilidad inmediata, pedidos masivos";
    }
  }

  // Add primary use context
  if (adContext.adIntent?.primaryUse) {
    prompt += `\n- Uso principal del anuncio: ${adContext.adIntent.primaryUse}`;
  }

  // Add offer hook reminder
  if (adContext.adIntent?.offerHook) {
    prompt += `\n- Gancho de la oferta: "${adContext.adIntent.offerHook}" (puedes mencionarlo cuando sea relevante)`;
  }

  return prompt;
}

// Helper function to try understanding a message with AI
async function tryUnderstandMessage(message, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory = [], adContext = null) {
  const isOngoingConversation = convo.greeted === true || convo.state !== 'new';
  const conversationContext = isOngoingConversation
    ? "\n⚠️ CRÍTICO: Esta es una conversación EN CURSO. NO saludes con 'Hola', '¡Hola!', 'Buenas', etc. Ve directo al punto de la respuesta."
    : "\n✅ Esta es una conversación NUEVA. Puedes saludar brevemente si es apropiado.";

  // Build ad context section
  const adContextPrompt = buildAdContextPrompt(adContext);

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
${conversationContext}${historyContext}${adContextPrompt}

PRODUCTOS Y CARACTERÍSTICAS:
- Ofrecemos una amplia variedad de mallas sombra en diferentes medidas y precios
- **SOBRE DIMENSIONES**: Las mallas rectangulares pueden usarse en cualquier orientación (4x3m es lo mismo que 3x4m), pero NO necesitas aclararlo - simplemente da el precio de la medida que pidieron
- Rollos de malla sombra beige y monofilamento
- Color: Solo BEIGE
- **IMPORTANTE: La malla sombra es PERMEABLE (permite que pase el agua). NO es impermeable ni repele el agua.**
- Proporciona sombra 90% y permite circulación de aire
- Si preguntan por impermeabilidad: aclarar que es PERMEABLE, sugerir lona si necesitan impermeabilidad
- Para conocer todas las medidas y precios disponibles, consulta el catálogo en Mercado Libre

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

UBICACIÓN Y ENVÍOS:
- ✅ Tenemos UNA SOLA tienda física en Querétaro: ${businessInfo.address}
- ✅ Enviamos a TODO MÉXICO (toda la República Mexicana)
- ✅ También enviamos a ESTADOS UNIDOS
- ✅ Venta en Tienda Oficial de Mercado Libre
- ⚠️ NO tenemos sucursales en otras ciudades - solo Querétaro

CONTACTO:
- Teléfonos: ${businessInfo.phones.join(", ")}
- Horarios: ${businessInfo.hours}
- Tienda Oficial de Mercado Libre: https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob

INSTRUCCIONES CRÍTICAS:
- **SIEMPRE incluir el link de la Tienda Oficial de Mercado Libre cuando se menciona envío, compra, o ubicación**
- **Si el cliente hace MÚLTIPLES preguntas, responde TODAS en un solo mensaje**
- **Si el cliente pregunta por MÚLTIPLES medidas (ej: "4x3 y 4x4"), responde sobre TODAS las medidas mencionadas**
- Responde con tono humano, empático y completo (responder TODAS las preguntas)
- Si preguntan medidas/precios: dirige al catálogo en Mercado Libre donde pueden ver todas las opciones disponibles
- Si preguntan colores: solo beige disponible
- Si preguntan por agua/impermeabilidad: aclarar que es PERMEABLE, no impermeable
- Si preguntan tiempos: especificar 1-2 días CDMX, 3-5 días foráneos
- Si preguntan pago: mencionar que se paga al ordenar en Mercado Libre
- Si una medida pedida no está disponible, sugerir revisar el catálogo completo en Mercado Libre
- Si no sabes algo: discúlpate y ofrece contacto directo
- NUNCA inventes información o servicios que no ofrecemos

🚨 REGLAS APRENDIDAS (MUY IMPORTANTE):
- **NUNCA des respuestas genéricas como "Puedo ayudarte con precios, medidas o cotizaciones" en medio de una conversación** - esto hace que el bot parezca tonto
- **Si preguntaste la ciudad del cliente y responde con una ciudad (ej: "En Mérida", "Monterrey")**: Confirma que envías ahí y pregunta qué medida necesita
- **Si preguntaste qué medida necesita y responde con dimensiones**: Da el precio y el link de esa medida
- **Si el cliente dice "precios y medidas" o similar**: Muestra la lista de medidas disponibles con precios
- **Si el cliente ya está en medio de la conversación, NUNCA vuelvas a preguntar "¿en qué te puedo ayudar?"** - continúa la conversación naturalmente
- **Si el cliente responde algo corto después de tu pregunta**: Interpreta su respuesta en contexto de lo que preguntaste
- **Revisa el HISTORIAL antes de responder** - si ya preguntaste algo, la respuesta del cliente probablemente es la respuesta a eso
- **Si preguntan por "hule" o "plástico" SIN contexto claro**: Pregunta si se refieren a BORDE SEPARADOR o CINTA ROMPEVIENTOS (productos que sí vendemos)
- **Si preguntan por "hule calibre", "plástico calibre", "germinador", "invernadero"**: Esto es plástico agrícola que NO vendemos - ofrece contacto directo para orientarle
- **Si preguntan por lona impermeable**: Aclara que la malla sombra es PERMEABLE (deja pasar agua), no vendemos lonas impermeables, y ofrece contacto directo
- **Si preguntan "donde pago", "donde deposito", "onde te mando $$", "como pago", "pago al recibir", "hasta que llegue", "pago contra entrega"**: Explica que el pago es 100% POR ADELANTADO en Mercado Libre al momento de hacer el pedido. NO aceptamos pago contra entrega. Alternativa: pagar en persona en nuestras oficinas en Querétaro
- **Si mencionan una ciudad pensando que estamos ahí (ej: "pensé que estaban en Tijuana", "creí que eran de Monterrey")**: Aclara que estamos en Querétaro pero ENVIAMOS A TODO EL PAÍS desde nuestra Tienda Oficial en Mercado Libre. NO respondas con precios - primero confirma el envío.
- **Si dicen "gracias por el envío" + otra pregunta (ej: "gracias por el envío y qué colores tienes")**: Están AGRADECIENDO un envío anterior, NO preguntando sobre envíos. Responde la OTRA pregunta (colores, medidas, etc.) - NO repitas info de envíos.
- **Si preguntan "en cuántos días llega" o "cuántos días tarda"**: Da los tiempos de entrega: CDMX 1-2 días, Interior 3-5 días. NO repitas info genérica de envíos.
- **Si preguntan por colores**: Actualmente solo manejamos color BEIGE en malla confeccionada.

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

    // Send push notification to dashboard users
    sendHandoffNotification(psid, "Cliente solicita fabricación a medida - necesita especialista").catch(err => {
      console.error("❌ Failed to send push notification:", err);
    });

    return {
      type: "text",
      text:
        `Tienes toda la razón, somos fabricantes y SÍ podemos hacer mallas a la medida que necesites.\n\n` +
        `Voy a transferir tu caso con un especialista que te dará una cotización personalizada. ` +
        `Por favor comunícate con nuestro equipo:\n\n` +
        `📞 ${businessInfo.phones.join(" / ")}\n` +
        `🕓 ${businessInfo.hours}`
    };
  }

  // 📜 Get recent conversation history (last 4 messages for context)
  const conversationHistory = await getRecentConversationHistory(psid, 4);
  console.log(`📜 Retrieved ${conversationHistory.length} messages for conversation context`);

  // 🧠 Try to understand the message with full conversation context
  const adContext = convo.adContext || null;
  const contextualResponse = await tryUnderstandMessage(userMessage, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory, adContext);

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
    const stitchedResponse = await tryUnderstandMessage(stitchedMessage, convo, openai, BOT_PERSONA_NAME, businessInfo, conversationHistory, adContext);

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

    // Send push notification to dashboard users
    const notificationReason = `Bot no pudo ayudar después de ${newUnknownCount} mensaje(s) no entendido(s) ${inBusinessHours ? '(horario laboral)' : '(fuera de horario)'}`;
    sendHandoffNotification(psid, notificationReason).catch(err => {
      console.error("❌ Failed to send push notification:", err);
    });

    // WhatsApp link for direct contact
    const whatsappLink = "https://wa.me/524425957432";

    if (!info) {
      return { type: "text", text: `Déjame conectarte con un especialista que pueda ayudarte mejor 😊\n\n💬 WhatsApp: ${whatsappLink}` };
    }

    return {
      type: "text",
      text:
        `Déjame conectarte con un especialista que pueda ayudarte mejor 😊\n\n` +
        `💬 WhatsApp: ${whatsappLink}\n\n` +
        `📞 ${info.phones.join(" / ")}\n🕓 ${info.hours}`
    };
  }

  // Before reaching handoff threshold, use simple clarification message
  return { type: "text", text: "Lo siento, no entendí la pregunta. ¿Podrías repetirla?" };
}

module.exports = { handleFallback };
