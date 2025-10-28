// ai/campaigns/mallaBeigeFlow.js
const { updateConversation } = require("../../conversationManager");

async function handleMallaBeigeFlow(msg, psid, convo, campaign) {
  if (convo.lastIntent === "campaign_entry") {
    await updateConversation(psid, { lastIntent: "malla_beige_intro" });
    return { type: "text", text: campaign.initialMessage };
  }

  if (/precio|cuánto|vale|costo/.test(msg)) {
    await updateConversation(psid, { lastIntent: "malla_beige_price" });
    return {
      type: "text",
      text: "La *malla sombra beige confeccionada* tiene un precio desde $450 según la medida 🌿.\n¿Quieres que te envíe las medidas disponibles?"
    };
  }

  if (/medidas|dimensiones|tamaño/.test(msg)) {
    await updateConversation(psid, { lastIntent: "malla_beige_sizes" });
    return {
      type: "text",
      text: "Estas son nuestras medidas estándar:\n• 3x4m\n• 4x6m\n• 4.2x25m (rollo completo)\n\n¿Te gustaría que te ayude a elegir la adecuada para tu proyecto?"
    };
  }

  if (/invernadero|jard[ií]n|estacionamiento|sombra/.test(msg)) {
    await updateConversation(psid, { lastIntent: "malla_beige_usage" });
    return {
      type: "text",
      text: "Perfecto 🌞 la *malla sombra beige 90%* es ideal para invernaderos, jardines y estacionamientos.\n¿Deseas una cotización personalizada o ver medidas?"
    };
  }

  await updateConversation(psid, { lastIntent: "malla_beige_fallback" });
  return {
    type: "text",
    text: "¿Quieres que te muestre precios o medidas de nuestra malla sombra beige confeccionada?"
  };
}

module.exports = { handleMallaBeigeFlow };
