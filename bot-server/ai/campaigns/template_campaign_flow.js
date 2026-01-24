// ai/campaigns/template_campaign_flow.js
const { updateConversation } = require("../../conversationManager");

/**
 * 🌿 PLANTILLA BASE DE CAMPAÑA
 * Usa esta estructura para crear nuevos flujos conversacionales.
 * El nombre del archivo DEBE coincidir con el campo `ref` de la campaña en MongoDB.
 * Ejemplo: ref="hanlob_rollo_monofilamento_nov25" → archivo: hanlob_rollo_monofilamento_nov25.js
 */

async function handleTemplateCampaignFlow(msg, psid, convo, campaign) {
  const lowerMsg = msg.toLowerCase().trim();

  // 🟢 1. Entrada inicial de la campaña
  if (convo.lastIntent === "campaign_entry") {
    await updateConversation(psid, { lastIntent: "intro" });
    return {
      type: "text",
      text: campaign.initialMessage || `👋 ¡Hola! Soy tu asesora virtual. ¿Qué te gustaría saber sobre ${campaign.name}?`,
    };
  }

  // 💬 2. Preguntas sobre precios
  if (/precio|cuánto|vale|costo|cuesta/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "price_info" });
    return {
      type: "text",
      text:
        `Los precios de ${campaign.productFocus?.family || "nuestro producto"} comienzan desde $XXX dependiendo de la medida.\n` +
        `¿Quieres que te muestre las medidas disponibles o una cotización personalizada?`,
    };
  }

  // 📏 3. Preguntas sobre medidas o tamaños
  if (/medidas|tamañ|dimensiones|rollo/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "size_info" });
    return {
      type: "text",
      text:
        `Estas son las medidas estándar para ${campaign.productFocus?.variant || "este producto"}:\n` +
        `• 3x4m\n• 4x6m\n• 4.2x25m (rollo completo)\n\n` +
        `¿Quieres que te ayude a elegir la adecuada para tu espacio?`,
    };
  }

  // ☀️ 4. Preguntas sobre uso o aplicación
  if (/invernadero|jard[ií]n|cochera|estacionamiento|terraza|patio/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "usage_info" });
    return {
      type: "text",
      text:
        `Perfecto 🌞 este producto es ideal para invernaderos, jardines, terrazas o cocheras.\n` +
        `¿Quieres ver precios o medidas disponibles?`,
    };
  }

  // 🧵 5. Preguntas sobre materiales o características
  if (/impermeable|material|resiste|uv|durable|plástico|tejido/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "features_info" });
    return {
      type: "text",
      text:
        `Está fabricado en material de alta resistencia con protección UV ☀️.\n` +
        `Es transpirable y resistente, ideal para exteriores.\n` +
        `¿Deseas que te muestre algunas fotos o detalles técnicos?`,
    };
  }

  // 💌 6. Cotizaciones o presupuestos
  if (/cotiz|presup|env[ií]ame.*precio/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "quote_request" });
    return {
      type: "text",
      text:
        `Con gusto puedo prepararte una cotización 🌿.\n` +
        `Solo necesito saber:\n` +
        `1️⃣ Las medidas aproximadas\n` +
        `2️⃣ Tu ubicación (para calcular envío)\n\n` +
        `¿Podrías compartir esos datos?`,
    };
  }

  // 🚚 7. Preguntas sobre envío
  if (/env[ií]o|entrega|reparto|llega|tardan|tiempo/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "delivery_info" });
    return {
      type: "text",
      text:
        `Realizamos envíos a todo México 🇲🇽 con entrega de 2 a 5 días hábiles.\n` +
        `¿Te gustaría saber el costo de envío para tu zona?`,
    };
  }

  // ☎️ 8. Contacto directo
  if (/tel[eé]fono|hablar|asesor|especialista|contactar|whatsapp|número/.test(lowerMsg)) {
    await updateConversation(psid, { lastIntent: "contact_request" });
    return {
      type: "text",
      text:
        `Puedes comunicarte con nuestro equipo por WhatsApp 📞 al +52 33 1234 5678 o continuar por aquí si prefieres 🌿.`,
    };
  }

  // 🧠 9. Fallback general dentro del flujo - show price range instead of generic question
  await updateConversation(psid, { lastIntent: "campaign_fallback" });
  return {
    type: "text",
    text: `Los precios de ${campaign.name} van desde $320 hasta $1,800 dependiendo de la medida 📐\n\n` +
          `¿Qué medida necesitas? Te doy el precio exacto 😊`,
  };
}

module.exports = { handleTemplateCampaignFlow };
