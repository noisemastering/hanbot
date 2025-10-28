// ai/global/intents.js
const { updateConversation } = require("../../conversationManager");
const {
  parseDimensions,
  getAvailableSizes,
  findClosestSizes,
  isInstallationQuery,
  isColorQuery,
  isApproximateMeasure,
  generateSizeResponse,
  generateGenericSizeResponse
} = require("../../measureHandler");
const Product = require("../../models/Product");

async function handleGlobalIntents(msg, psid, convo = {}) {

  console.log("🌍 INTENTOS GLOBALES CHECANDO →", msg);

  // 📍 Ubicación
  if (/donde|ubicad[oa]|direccion|qued[ao]|mapa|local/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "location_info" });

    return {
      type: "text",
      text: `📍 Estamos en Querétaro:

**Hanlob - Microparque Industrial Navex Park**  
Calle Loma de San Gremal No. 108, **bodega 73**,  
Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.

Google Maps 👉 https://www.google.com/maps/place/Hanlob/

¿Te gustaría pasar o prefieres envío? 🚚😊`
    };
  }

  // 🚚 Envíos / entregas
  if (/env[ií]o|entregan|domicilio|reparto|llega|envias|paquete/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "shipping_info" });

    return {
      type: "text",
      text: `🚚 **Sí realizamos entregas.**

• En *Querétaro zona urbana*, el envío normalmente **va incluido** 🏡
• A todo el país enviamos con **entrega garantizada** desde nuestra *Tienda Oficial en Mercado Libre*.

¿En qué ciudad te encuentras? 😊`
    };
  }

  // 🏙️ City response after shipping question (context-aware)
  // If user was just asked about shipping and responds with a city name
  if (convo.lastIntent === "shipping_info") {
    // Any short text response is likely a city name
    const cityName = msg.trim();

    await updateConversation(psid, {
      lastIntent: "city_provided",
      unknownCount: 0
    });

    // Build context-aware response
    let response = "";

    if (convo.requestedSize) {
      // Try to fetch ML link for the requested size
      // Try with and without "m" suffix (size might be "4x6" or "4x6m")
      const product = await Product.findOne({
        $or: [
          { size: convo.requestedSize },
          { size: convo.requestedSize + 'm' }
        ],
        type: "confeccionada"
      });
      const mlLink = product?.mLink;

      // User mentioned a size earlier
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. Para la malla sombra de ${convo.requestedSize} que te interesa, el **envío va incluido** en zona urbana.\n\n¿Te gustaría pasar a la bodega o prefieres que te la llevemos? 😊`;
      } else {
        const mlLinkText = mlLink
          ? `\n\n📱 Puedes comprarla en nuestra *Tienda Oficial de Mercado Libre* con envío garantizado:\n👉 ${mlLink}`
          : `\n\n📱 Puedes comprarla en nuestra *Tienda Oficial de Mercado Libre* con envío garantizado`;

        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nPara la malla sombra de ${convo.requestedSize}:${mlLinkText}\n\n📞 O llámanos: 442 123 4567 / 442 765 4321\n\n¿Con cuál opción te gustaría proceder? 😊`;
      }
    } else {
      // No size mentioned yet
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. El **envío va incluido** en zona urbana.\n\nCuéntame, ¿qué medida te interesa? Tenemos:\n• *3x4m* - $450\n• *4x6m* - $650`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nCuéntame, ¿qué medida te interesa? Tenemos:\n• *3x4m* - $450\n• *4x6m* - $650`;
      }
    }

    return {
      type: "text",
      text: response
    };
  }

  // 💰 BUYING INTENT - Handle purchase requests (HIGH PRIORITY!)
  if (/\b(quiero|comprar|compro|pedir|ordenar|llevar|adquirir|cómo\s+lo\s+compro)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "buying_intent", unknownCount: 0 });

    // Check if user recently asked about a specific size
    if (convo.requestedSize || convo.lastIntent === "specific_measure") {
      const size = convo.requestedSize || "la medida que mencionaste";

      // Try to fetch the ML link for this size
      let mlLink = null;
      if (convo.requestedSize) {
        // Try with and without "m" suffix (size might be "4x6" or "4x6m")
        const product = await Product.findOne({
          $or: [
            { size: convo.requestedSize },
            { size: convo.requestedSize + 'm' }
          ],
          type: "confeccionada"
        });
        mlLink = product?.mLink;
      }

      const mlLinkText = mlLink
        ? `📱 *Opción 1*: Puedes adquirirla en nuestra *Tienda Oficial de Mercado Libre* con envío a toda la República:\n👉 ${mlLink}\n\n`
        : `📱 *Opción 1*: Búscala en nuestra *Tienda Oficial de Mercado Libre* (envío a toda la República)\n\n`;

      return {
        type: "text",
        text: `¡Perfecto! 🎉 Para comprar la malla sombra ${size}:\n\n` +
              mlLinkText +
              `🏪 *Opción 2*: Visítanos en nuestra bodega en Querétaro (envío incluido en zona urbana)\n\n` +
              `📞 *Opción 3*: Llámanos para hacer tu pedido:\n` +
              `442 123 4567 / 442 765 4321\n\n` +
              `¿Con cuál opción te gustaría proceder? 😊`
      };
    }

    // No specific size mentioned yet
    return {
      type: "text",
      text: `¡Excelente! 🎉 ¿Qué medida te interesa?\n\n` +
            `Tenemos disponibles:\n` +
            `• *3x4m* - $450\n` +
            `• *4x6m* - $650\n\n` +
            `Dime cuál prefieres y te ayudo con el proceso de compra 😊`
    };
  }

  // 📏 MEASURES INTENT - Handle size/dimension inquiries
  // Check for installation query first
  if (isInstallationQuery(msg)) {
    await updateConversation(psid, { lastIntent: "installation_query", unknownCount: 0 });

    // Context-aware responses based on previous conversation
    let response = "";

    if (convo.lastIntent === "specific_measure" && convo.requestedSize) {
      // They were asking about a specific size
      response = `No ofrecemos instalación 😊, pero para la medida de ${convo.requestedSize} que mencionaste, puedo ayudarte con las especificaciones técnicas para que la instales tú o contrates a alguien. ¿Te gustaría saber más sobre alguna de las opciones que te sugerí?`;
    } else if (convo.lastIntent === "specific_measure") {
      // They were asking about sizes in general
      response = `No ofrecemos instalación, pero puedo ayudarte a elegir la medida correcta y darte las especificaciones para que la instalación sea fácil 🌿. ¿Te interesa alguna de las opciones que te mencioné?`;
    } else {
      // Generic installation question
      const genericResponses = [
        `No ofrecemos servicio de instalación 😊, pero puedo ayudarte con las especificaciones para que la instales tú o contrates a alguien de confianza.`,
        `No contamos con instalación, pero te puedo asesorar con las medidas exactas que necesitas 🌿.`,
        `Nosotros no instalamos, pero si me dices el área a cubrir, te ayudo a elegir la medida perfecta 😊.`
      ];
      response = genericResponses[Math.floor(Math.random() * genericResponses.length)];
    }

    return {
      type: "text",
      text: response
    };
  }

  // Check for color query
  if (isColorQuery(msg)) {
    await updateConversation(psid, { lastIntent: "color_query", unknownCount: 0 });
    const colorResponses = [
      `Por ahora solo manejamos **malla sombra beige** en versión confeccionada 🌿. ¿Te gustaría ver las medidas disponibles?`,
      `Actualmente tenemos disponible solo el color **beige** en malla confeccionada. ¿Quieres que te muestre los tamaños?`,
      `De momento contamos únicamente con **beige**, que es nuestro color más popular 😊. ¿Te interesa ver precios y medidas?`
    ];
    return {
      type: "text",
      text: colorResponses[Math.floor(Math.random() * colorResponses.length)]
    };
  }

  // Check for approximate measurement / need to measure properly
  if (isApproximateMeasure(msg)) {
    await updateConversation(psid, { lastIntent: "measurement_guidance", unknownCount: 0 });
    const guidanceResponses = [
      `¡Perfecto! 📏 Te recomiendo medir el área total y luego elegir una malla aproximadamente **1 metro cuadrado más pequeña** que el espacio. Esto deja espacio para los tensores y asegura una instalación adecuada.\n\nCuando tengas la medida exacta, con gusto te ayudo a elegir el tamaño ideal 🌿`,
      `Muy bien pensado medir con precisión 👍. Un consejo: la malla debe ser cerca de **1m² más pequeña** que el área total para dejar espacio a los tensores.\n\n¿Ya tienes una idea aproximada de las dimensiones?`,
      `Excelente idea medir bien 📐. Recuerda que la malla debe ser un poco más pequeña que el área (aproximadamente 1m² menos) para los tensores.\n\nCuando tengas las medidas, cuéntame y te sugiero la opción perfecta 🌿`
    ];
    return {
      type: "text",
      text: guidanceResponses[Math.floor(Math.random() * guidanceResponses.length)]
    };
  }

  // Parse specific dimensions from message
  const dimensions = parseDimensions(msg);

  // Generic measure/price inquiry (no specific dimensions mentioned)
  const isGenericMeasureQuery = /\b(medidas|tamaños?|dimensiones|cu[aá]nto|precio|cuestan)\b.*\b(medidas|disponibles|tienen|hay|manejan)\b/i.test(msg) && !dimensions;

  if (dimensions || isGenericMeasureQuery) {
    const availableSizes = await getAvailableSizes();

    if (dimensions) {
      // User specified exact dimensions
      const closest = findClosestSizes(dimensions, availableSizes);

      await updateConversation(psid, {
        lastIntent: "specific_measure",
        unknownCount: 0,
        requestedSize: `${dimensions.width}x${dimensions.height}`
      });

      return {
        type: "text",
        text: generateSizeResponse({
          smaller: closest.smaller,
          bigger: closest.bigger,
          exact: closest.exact,
          requestedDim: dimensions,
          availableSizes
        })
      };
    } else {
      // Generic inquiry - show all available sizes
      await updateConversation(psid, { lastIntent: "generic_measures", unknownCount: 0 });

      return {
        type: "text",
        text: generateGenericSizeResponse(availableSizes)
      };
    }
  }

  // Si no coincide ninguna intención global:
  return null;
}

module.exports = { handleGlobalIntents };
