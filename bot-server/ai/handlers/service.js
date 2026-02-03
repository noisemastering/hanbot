// ai/handlers/service.js
// Handlers for service-related intents: installation, structure, warranty, custom size

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");

/**
 * Handle installation query - "Ustedes instalan?", "Pasan a medir?"
 */
async function handleInstallation({ psid }) {
  await updateConversation(psid, {
    lastIntent: "installation_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "No, mil disculpas, en Hanlob no proveemos servicios de instalación.\n\n" +
          "Solo vendemos la malla sombra y la enviamos a tu domicilio.\n\n" +
          "¿Ya tienes la medida que necesitas?"
  };
}

/**
 * Handle structure query - "Hacen la estructura?", "Incluye postes?"
 */
async function handleStructure({ psid }) {
  await updateConversation(psid, {
    lastIntent: "structure_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "No, mil disculpas, nosotros solo realizamos la fabricación de la malla.\n\n" +
          "No vendemos ni instalamos estructuras.\n\n" +
          "¿Te puedo ayudar con alguna medida de malla?"
  };
}

/**
 * Handle warranty query - "Tiene garantía?", "Cuánto de garantía?"
 */
async function handleWarranty({ psid }) {
  await updateConversation(psid, {
    lastIntent: "warranty_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Nuestras mallas tienen garantía de 1 año por defectos de fabricación.\n\n" +
          "Además, la compra por Mercado Libre te da protección adicional del comprador.\n\n" +
          "La vida útil del producto es de 8-10 años con el cuidado adecuado.\n\n" +
          "¿Qué medida te interesa?"
  };
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

  return {
    type: "text",
    text: "Sí, podemos fabricar malla a medida exacta para proyectos especiales.\n\n" +
          "Para cotizar una medida personalizada, necesitamos:\n" +
          "• Las dimensiones exactas (ancho x largo)\n" +
          "• El porcentaje de sombra deseado\n" +
          "• Tu código postal para calcular el envío\n\n" +
          "¿Qué medida necesitas?"
  };
}

/**
 * Handle accessory query - "Incluye cuerda?", "Viene con arnés?"
 */
async function handleAccessory({ psid }) {
  await updateConversation(psid, {
    lastIntent: "accessory_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "La malla sombra confeccionada viene lista para instalar con argollas en todo el perímetro, pero no incluye cuerda ni arnés.\n\n" +
          "Te ofrecemos estos accesorios por separado:\n\n" +
          "• Lazo con protección UV (rollo de 47m)\n" +
          "• Kit de Instalación para Malla Sombra\n\n" +
          "¿Te interesa agregar alguno de estos accesorios?"
  };
}

module.exports = {
  handleInstallation,
  handleStructure,
  handleWarranty,
  handleCustomSize,
  handleAccessory
};
