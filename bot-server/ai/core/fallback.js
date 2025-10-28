// ai/core/fallback.js
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");

async function handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME) {
  const businessInfo = await getBusinessInfo();

  const response = await openai.chat.completions.create({
    model: process.env.AI_MODEL || "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `Eres ${BOT_PERSONA_NAME}, asesora de ventas de Hanlob, empresa mexicana de mallas sombra en Querétaro.

PRODUCTOS QUE VENDEMOS:
- Malla sombra beige 90% confeccionada (medidas: 3x4m - $450, 4x6m - $650)
- Rollos de malla sombra beige y monofilamento
- Solo color: BEIGE

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

INSTRUCCIONES:
- Responde con tono humano, empático y breve (máx 2-3 líneas)
- Si preguntan por instalación: di que NO la ofrecemos pero podemos ayudar con especificaciones
- Si preguntan medidas/precios: menciona las disponibles (3x4m, 4x6m)
- Si preguntan colores: solo beige disponible
- Si no sabes algo: discúlpate y ofrece contacto directo
- NUNCA inventes información o servicios que no ofrecemos`
      },
      { role: "user", content: userMessage }
    ],
    temperature: 0.7
  });

  const aiReply = response.choices?.[0]?.message?.content || `Lo siento 😔 no tengo información sobre eso.`;
  const newUnknownCount = (convo.unknownCount || 0) + 1;
  await updateConversation(psid, { lastIntent: "fallback", unknownCount: newUnknownCount });

  if (newUnknownCount >= 2) {
    const info = await getBusinessInfo();
    await updateConversation(psid, { unknownCount: 0 });
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
