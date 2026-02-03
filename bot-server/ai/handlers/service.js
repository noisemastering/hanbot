// ai/handlers/service.js
// Handlers for service-related intents: installation, structure, warranty, custom size

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { generateBotResponse } = require("../responseGenerator");

/**
 * Handle installation query - "Ustedes instalan?", "Pasan a medir?"
 */
async function handleInstallation({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "installation_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("installation_query", {
    offersInstallation: false,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle structure query - "Hacen la estructura?", "Incluye postes?"
 */
async function handleStructure({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "structure_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("structure_query", {
    offersStructure: false,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle warranty query - "Tiene garantía?", "Cuánto de garantía?"
 */
async function handleWarranty({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "warranty_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("warranty_query", {
    warrantyYears: 1,
    lifespan: '8-10 años',
    hasMercadoLibreProtection: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle custom size query - "Hacen a medida exacta?", "Medidas personalizadas?"
 */
async function handleCustomSize({ psid, convo }) {
  const info = await getBusinessInfo();

  await updateConversation(psid, {
    lastIntent: "custom_size_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("custom_size_query", {
    offersCustomSize: true,
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle accessory query - "Incluye cuerda?", "Viene con arnés?"
 */
async function handleAccessory({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "accessory_query",
    unknownCount: 0
  });

  const response = await generateBotResponse("accessory_query", {
    includesRope: false,
    hasEyelets: true,
    availableAccessories: ['Lazo con protección UV (rollo de 47m)', 'Kit de Instalación para Malla Sombra'],
    convo
  });

  return { type: "text", text: response };
}

module.exports = {
  handleInstallation,
  handleStructure,
  handleWarranty,
  handleCustomSize,
  handleAccessory
};
