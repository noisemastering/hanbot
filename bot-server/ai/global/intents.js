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

  // Normalize common misspellings
  msg = msg.replace(/\bmaya\b/gi, 'malla')
           .replace(/\bmaia\b/gi, 'malla');

  // ✅ AFFIRMATIVE RESPONSE - Handle "sí", "si", "yes", "dale" after showing size/price
  if (/^(s[ií]|yes|dale|ok|claro|perfecto|adelante|por\s+favor)$/i.test(msg.trim())) {
    // Check if user was just shown a specific size/price
    if (convo.lastIntent === "specific_measure" && convo.requestedSize) {
      const sizeVariants = [convo.requestedSize, convo.requestedSize + 'm'];

      // Add swapped dimensions
      const match = convo.requestedSize.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (match) {
        const swapped = `${match[2]}x${match[1]}`;
        sizeVariants.push(swapped, swapped + 'm');
      }

      const product = await Product.findOne({
        size: { $in: sizeVariants },
        type: "confeccionada"
      });

      if (product?.mLink) {
        await updateConversation(psid, { lastIntent: "affirmative_link_provided", unknownCount: 0 });

        return {
          type: "text",
          text: `Aquí está el enlace de nuestra Tienda Oficial en Mercado Libre para la malla sombra de ${convo.requestedSize}:\n\n` +
                `${product.mLink}\n\n` +
                `Estamos disponibles para cualquier información adicional.`
        };
      }
    }
  }

  // 📍 Ubicación
  if (/donde|ubicad[oa]|direccion|qued[ao]|mapa|local/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "location_info" });

    return {
      type: "text",
      text: `Estamos en Querétaro:

**Hanlob - Microparque Industrial Navex Park**
Calle Loma de San Gremal No. 108, **bodega 73**,
Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.

Google Maps: https://www.google.com/maps/place/Hanlob/

¿Te gustaría pasar a la bodega o prefieres que te enviemos el producto?`
    };
  }

  // 🚚 Envíos / entregas
  if (/env[ií]o|entregan|domicilio|reparto|llega|envias|paquete/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "shipping_info" });

    // If user already asked about a specific size, give them the link directly
    if (convo.requestedSize) {
      const sizeVariants = [convo.requestedSize, convo.requestedSize + 'm'];

      // Add swapped dimensions
      const match = convo.requestedSize.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (match) {
        const swapped = `${match[2]}x${match[1]}`;
        sizeVariants.push(swapped, swapped + 'm');
      }

      const product = await Product.findOne({
        size: { $in: sizeVariants },
        type: "confeccionada"
      });

      if (product?.mLink) {
        return {
          type: "text",
          text: `Sí, enviamos a todo el país. Aquí está el enlace de la malla sombra de ${convo.requestedSize}:\n\n${product.mLink}`
        };
      }
    }

    return {
      type: "text",
      text: `Sí realizamos entregas.\n\n• En Querétaro zona urbana, el envío normalmente va incluido\n• A todo el país enviamos con entrega garantizada desde nuestra Tienda Oficial en Mercado Libre\n\n¿En qué ciudad te encuentras?`
    };
  }

  // 🏙️ City response after shipping question (context-aware)
  // If user was just asked about shipping and responds with a city name
  // BUT NOT if they're asking another question (precio, medida, etc.)
  if (convo.lastIntent === "shipping_info" &&
      !/\b(precio|cuanto|cuesta|medida|tamaño|dimension|tiene|hay|vende|fabrica|color)\b/i.test(msg)) {
    // Short text response is likely a city name
    const cityName = msg.trim();

    await updateConversation(psid, {
      lastIntent: "city_provided",
      unknownCount: 0
    });

    // Build context-aware response
    let response = "";

    if (convo.requestedSize) {
      // User mentioned a size earlier
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. Para la malla sombra de ${convo.requestedSize} que te interesa, el **envío va incluido** en zona urbana.\n\n¿Te gustaría comprarlo o prefieres más información? 😊`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nPara la malla sombra de ${convo.requestedSize}, el envío es garantizado.\n\n¿Te gustaría comprarlo o necesitas más información? 😊`;
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

  // 📋 DETAILS REQUEST - User asks for more information/details or wants to see a product
  if (/\b(detalles?|m[aá]s\s+informaci[oó]n|m[aá]s\s+info|ver\s+m[aá]s|cu[eé]ntame\s+m[aá]s|especificaciones|ficha\s+t[eé]cnica|d[eé]jame\s+ver|mu[eé]strame|ens[eé][nñ]ame|quiero\s+ver|ver\s+la|ver\s+el)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "details_request", unknownCount: 0 });

    // Check if message contains a specific size (e.g., "dejame ver la de 4x6")
    const dimensionsInMsg = parseDimensions(msg);
    let sizeToShow = convo.requestedSize;

    if (dimensionsInMsg) {
      // User mentioned a specific size in the "ver" request
      sizeToShow = `${dimensionsInMsg.width}x${dimensionsInMsg.height}`;
      await updateConversation(psid, { requestedSize: sizeToShow });
    }

    // Check if we have a size to show details for
    if (sizeToShow) {
      // Try to fetch the ML link for this size (with dimension swapping)
      const sizeVariants = [sizeToShow, sizeToShow + 'm'];

      // Add swapped dimensions
      const match = sizeToShow.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (match) {
        const swapped = `${match[2]}x${match[1]}`;
        sizeVariants.push(swapped, swapped + 'm');
      }

      const product = await Product.findOne({
        size: { $in: sizeVariants },
        type: "confeccionada"
      });

      if (product?.mLink) {
        return {
          type: "text",
          text: `Aquí está el enlace seguro de nuestra Tienda Oficial en Mercado Libre para la malla sombra de ${sizeToShow}:\n\n` +
                `${product.mLink}\n\n` +
                `Estamos disponibles para cualquier información adicional.`
        };
      }
    }

    // Generic details request without specific size context
    return {
      type: "text",
      text: `Con gusto te doy más información. ¿Sobre qué medida te gustaría saber más?\n\n` +
            `Tenemos disponibles:\n` +
            `• *3x4m* - $450\n` +
            `• *4x6m* - $650`
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
        // Try with and without "m" suffix, and also swapped dimensions
        // (e.g., user asks "4x6" but DB has "6x4m")
        const sizeVariants = [convo.requestedSize, convo.requestedSize + 'm'];

        // Add swapped dimensions
        const match = convo.requestedSize.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
        if (match) {
          const swapped = `${match[2]}x${match[1]}`;
          sizeVariants.push(swapped, swapped + 'm');
        }

        const product = await Product.findOne({
          size: { $in: sizeVariants },
          type: "confeccionada"
        });
        mlLink = product?.mLink;
      }

      if (mlLink) {
        return {
          type: "text",
          text: `Perfecto. Aquí está el enlace seguro de nuestra Tienda Oficial en Mercado Libre para la malla sombra de ${size}:\n\n` +
                `${mlLink}\n\n` +
                `Estamos disponibles para cualquier información adicional.`
        };
      } else {
        return {
          type: "text",
          text: `Perfecto. Para comprar la malla sombra de ${size}, puedes:\n\n` +
                `• Buscarla en nuestra Tienda Oficial de Mercado Libre\n` +
                `• Visitarnos en nuestra bodega en Querétaro\n` +
                `• Llamarnos: 442 123 4567 / 442 765 4321\n\n` +
                `¿Cuál opción prefieres?`
        };
      }
    }

    // No specific size mentioned yet
    return {
      type: "text",
      text: `Perfecto. ¿Qué medida te interesa?\n\n` +
            `Tenemos disponibles:\n` +
            `• 3x4m - $450\n` +
            `• 4x6m - $650\n\n` +
            `Dime cuál prefieres.`
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

  // Handle custom size questions BEFORE generic measures
  if (/\b(medidas?\s+(personalizad[ao]s?|especiales?|a\s+medida|custom)|pueden?\s+(hacer|fabricar|crear).*medida|venden?\s+(por|x)\s+medidas?)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "custom_sizes_question", unknownCount: 0 });

    return {
      type: "text",
      text: `Sí, manejamos medidas estándar pero también fabricamos a la medida que necesites.\n\n` +
            `Algunas de nuestras medidas estándar son:\n` +
            `• 3x4m - $450\n` +
            `• 4x6m - $650\n` +
            `• 5x4m - $575\n\n` +
            `¿Qué medida necesitas?`
    };
  }

  // Generic measure/price inquiry (no specific dimensions mentioned)
  // Simplified: just asking about price, sizes, or cost
  const isGenericMeasureQuery = /\b(precio|cuestan?|cu[aá]nto|medidas?|tamaños?|dimensiones|disponibles?)\b/i.test(msg) &&
                                  !/\b(instalaci[oó]n|color|material|env[ií]o|ubicaci[oó]n|donde)\b/i.test(msg) &&
                                  !dimensions;

  if (dimensions || isGenericMeasureQuery) {
    const availableSizes = await getAvailableSizes();

    if (dimensions) {
      // User specified exact dimensions
      const closest = findClosestSizes(dimensions, availableSizes);
      const requestedSizeStr = `${dimensions.width}x${dimensions.height}`;

      // Check if user is insisting on the same unavailable size
      const isRepeated = !closest.exact &&
                        convo.lastUnavailableSize === requestedSizeStr &&
                        convo.lastIntent === "specific_measure";

      // Update conversation state
      const updateData = {
        lastIntent: "specific_measure",
        unknownCount: 0,
        requestedSize: requestedSizeStr
      };

      // If size is not available, track it for insistence detection
      if (!closest.exact) {
        updateData.lastUnavailableSize = requestedSizeStr;
      } else {
        // Clear lastUnavailableSize if we found exact match
        updateData.lastUnavailableSize = null;
      }

      await updateConversation(psid, updateData);

      // If exact match, provide ML link immediately
      if (closest.exact) {
        const sizeVariants = [requestedSizeStr, requestedSizeStr + 'm'];

        // Add swapped dimensions
        const match = requestedSizeStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
        if (match) {
          const swapped = `${match[2]}x${match[1]}`;
          sizeVariants.push(swapped, swapped + 'm');
        }

        const product = await Product.findOne({
          size: { $in: sizeVariants },
          type: "confeccionada"
        });

        if (product?.mLink) {
          return {
            type: "text",
            text: `Sí, contamos con **${closest.exact.sizeStr}** por $${closest.exact.price}.\n\n` +
                  `Aquí está el enlace de nuestra Tienda Oficial en Mercado Libre:\n\n` +
                  `${product.mLink}`
          };
        }
      }

      return {
        type: "text",
        text: generateSizeResponse({
          smaller: closest.smaller,
          bigger: closest.bigger,
          exact: closest.exact,
          requestedDim: dimensions,
          availableSizes,
          isRepeated
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

  // Handle vague dimension requests ("tipo casa", "tipo A", "más o menos", etc.)
  if (/\b(tipo\s+[a-z]|m[aá]s\s+o\s+menos|aproximad[ao]|grande|peque[nñ]o|mediano|chico)\b/i.test(msg) &&
      /\b(necesito|ocupo|quiero|requiero)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "vague_dimensions", unknownCount: 0 });

    return {
      type: "text",
      text: `Para ayudarte mejor, necesito las medidas específicas del área que quieres cubrir.\n\n` +
            `¿Podrías decirme el largo y el ancho en metros? Por ejemplo: 4x6, 3x5, etc.`
    };
  }

  // Si no coincide ninguna intención global:
  return null;
}

module.exports = { handleGlobalIntents };
