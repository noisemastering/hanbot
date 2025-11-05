// ai/global/intents.js
const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
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
const { detectMexicanLocation, isLikelyLocationName } = require("../../mexicanLocations");

async function handleGlobalIntents(msg, psid, convo = {}) {

  console.log("🌍 INTENTOS GLOBALES CHECANDO →", msg);

  // Normalize common misspellings
  msg = msg.replace(/\bmaya\b/gi, 'malla')
           .replace(/\bmaia\b/gi, 'malla');

  // 🏪 MERCADO LIBRE STORE LINK - Handle requests to see the online store
  if (/\b(ver|visitar|ir a|mostrar|enviar|dar|darme|dame|quiero)\s+(la\s+)?(tienda|catalogo|cat[aá]logo)\b/i.test(msg) ||
      /\b(tienda\s+(en\s+l[ií]nea|online|virtual|mercado\s+libre))\b/i.test(msg) ||
      /\b(link|enlace)\s+(de\s+)?(la\s+)?(tienda|catalogo)\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "store_link_requested" });

    return {
      type: "text",
      text: "Aquí está el enlace de nuestra Tienda Oficial en Mercado Libre:\n\n" +
            "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n" +
            "Estamos disponibles para ayudarte con cualquier duda sobre nuestros productos."
    };
  }

  // 📋 CATALOG REQUEST - Handle requests for general pricing, sizes, and colors listing
  if (/\b(pongan?|den|muestren?|env[ií]en?|pasame?|pasen?|listado?)\s+(de\s+)?(precios?|medidas?|opciones?|tama[ñn]os?|colores?)\b/i.test(msg) ||
      /\b(precios?\s+y\s+medidas?)\b/i.test(msg) ||
      /\b(medidas?\s+y\s+precios?)\b/i.test(msg) ||
      /\b(hacer\s+presupuesto|cotizaci[oó]n)\b/i.test(msg) ||
      /\b(opciones?\s+disponibles?|qu[eé]\s+tienen|todo\s+lo\s+que\s+tienen)\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "catalog_request" });

    // Fetch beige products from database
    const products = await Product.find({
      isActive: true,
      color: /beige/i
    }).sort({ size: 1 });

    if (!products || products.length === 0) {
      return {
        type: "text",
        text: "En este momento tenemos disponibles mallas sombra beige desde 2x2m hasta 10x5m.\n\n" +
              "¿Qué medida necesitas para tu proyecto?"
      };
    }

    let response = "📐 MALLAS SOMBRA DISPONIBLES:\n\n";
    response += "🟤 BEIGE (90% sombra):\n";

    products.forEach(p => {
      response += `• ${p.size} → $${p.price}\n`;
    });

    response += "\n✨ También fabricamos medidas personalizadas\n\n";
    response += "¿Qué medida necesitas?";

    return {
      type: "text",
      text: response
    };
  }

  // 💰 BULK/VOLUME DISCOUNT INQUIRY - Handle requests for bulk discounts
  // Detect: multiple units, wholesale, volume discounts, special prices
  const { getBusinessInfo } = require("../../businessInfoManager");

  if (/\b(descuento|rebaja|precio especial|precio mayoreo|mayoreo|volumen)\b/i.test(msg) ||
      /\b(\d+)\s+(piezas?|unidades?|mallas?|de la misma)\b/i.test(msg) ||
      /\b(si\s+encargar[aá]|si\s+compro|si\s+pido)\s+(\d+|vari[oa]s|much[oa]s)\b/i.test(msg)) {

    const info = await getBusinessInfo();
    await updateConversation(psid, { lastIntent: "bulk_discount_inquiry", state: "needs_human" });

    return {
      type: "text",
      text: "Los descuentos por volumen aplican para pedidos desde $20,000 MXN en adelante.\n\n" +
            "Para cotizar tu pedido y conocer los descuentos disponibles, te comunico con uno de nuestros asesores:\n\n" +
            `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n` +
            `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}\n\n` +
            "También puedes escribirnos aquí por Messenger y te atenderemos con gusto."
    };
  }

  // ✅ AFFIRMATIVE RESPONSE - Handle "sí", "si", "yes", "dale" after showing size/price
  // Using word boundaries (\b) instead of anchors (^$) to catch affirmatives even with additional text
  // e.g., "si de esa medida" or "si con argollas" will now be detected

  // Skip if message contains thanks/closing words (avoid redundant messages after user is done)
  const hasThanksClosure = /\b(gracias|muchas gracias|perfecto.*gracias|ok.*gracias|excelente.*gracias|muy amable|adiós|bye|nos vemos|ago\s+mi\s+pedido|hago\s+mi\s+pedido)\b/i.test(msg);

  if (!hasThanksClosure && /\b(s[ií]|yes|dale|ok|claro|perfecto|adelante|exact[oa]|correct[oa]|as[ií]|esa|ese)\b/i.test(msg)) {
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
      } else {
        // If no exact product found, provide alternatives
        const availableSizes = await getAvailableSizes();
        const dimensions = {
          width: match ? parseFloat(match[1]) : null,
          height: match ? parseFloat(match[2]) : null,
          area: match ? parseFloat(match[1]) * parseFloat(match[2]) : null
        };

        if (dimensions.width && dimensions.height) {
          const closest = findClosestSizes(dimensions, availableSizes);

          const sizeResponse = generateSizeResponse({
            smaller: closest.smaller,
            bigger: closest.bigger,
            exact: closest.exact,
            requestedDim: dimensions,
            availableSizes,
            isRepeated: false
          });

          return {
            type: "text",
            text: sizeResponse.text
          };
        }
      }
    }
  }

  // 📍 Ubicación
  if (/donde|ubicad[oa]|direccion|qued[ao]|mapa|local/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "location_info" });

    return {
      type: "text",
      text: `Estamos en Querétaro:

Hanlob - Microparque Industrial Navex Park
Calle Loma de San Gremal No. 108, bodega 73,
Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.

Google Maps: https://www.google.com/maps/place/Hanlob/

¿Te gustaría pasar a la bodega o prefieres que te enviemos el producto?`
    };
  }

  // ⏰ Delivery time and payment questions (BEFORE shipping handler to catch "cuando llega")
  if (/cu[aá]nto\s+tiempo|cuando\s+llega|tiempo\s+de\s+entrega|tarda|demora|anticipo|pago\s+contra\s+entrega|forma\s+de\s+pago|c[oó]mo\s+pag/i.test(msg)) {
    // 🔴 SKIP if message contains MULTIPLE questions (let fallback handle comprehensive answer)
    const multiQuestionIndicators = [
      /precio|costo|cu[aá]nto.*(?:cuesta|vale)/i, // Price questions
      /\b(si|funciona|repele|impermeable|agua)\b.*\b(agua|repele|impermeable|funciona)/i, // Water/function questions
      /\by\s+(si|funciona|repele|tiempo|entrega|pago|forma|cuanto|donde)/i, // Multiple questions with "y"
      /\btambién|además|ademas/i, // Also/additionally
      /\?.*\?/, // Multiple question marks
      /,.*\b(y|si|tiempo|entrega|pago|forma|costo|precio)/i // Commas followed by other questions
    ];

    const isMultiQuestion = multiQuestionIndicators.some(regex => regex.test(msg));
    if (isMultiQuestion) {
      console.log("⏩ Multi-question detected in delivery_time_payment handler, skipping to fallback");
      return null; // Let fallback handle it with complete answer
    }

    await updateConversation(psid, { lastIntent: "delivery_time_payment" });

    return {
      type: "text",
      text: "El pago se realiza 100% en Mercado Libre al hacer el pedido. Aceptamos tarjetas, efectivo y meses sin intereses.\n\n" +
            "Tiempos de entrega:\n" +
            "• CDMX y zona metropolitana: 1-2 días hábiles\n" +
            "• Interior de la República: 3-5 días hábiles"
    };
  }

  // 🚚 Envíos / entregas
  if (/env[ií]o|entregan|domicilio|reparto|llega|envias?|envian|paquete/i.test(msg)) {
    // Check if message also contains dimensions - if so, skip shipping handler and let dimension handler process it
    const dimensions = parseDimensions(msg);
    if (dimensions) {
      // Let the dimension handler below deal with this - it will include shipping info
      // Don't return here, continue to dimension handler
    } else {
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
          text: `Sí, enviamos a todo el país. El envío está incluido en la mayoría de los casos o se calcula automáticamente en Mercado Libre.\n\nAquí está el enlace de la malla sombra de ${convo.requestedSize}:\n\n${product.mLink}`
        };
      }
    }

      return {
        type: "text",
        text: `Sí realizamos entregas a todo México.\n\n• En Querétaro zona urbana, el envío normalmente va incluido\n• Para el resto del país, el envío está incluido en la mayoría de los casos o se calcula automáticamente en tu compra\n\nPuedes ver todos nuestros productos con envío aquí:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿En qué ciudad te encuentras?`
      };
    }
  }

  // 🏢 ASKING IF WE'RE PHYSICALLY LOCATED IN THEIR CITY
  // "Trabajan aquí en Reynosa?" / "Están en Monterrey?" / "Tienen tienda en Guadalajara?"
  if (/\b(trabajan?|est[aá]n?|tienen?|hay)\s+(aqu[ií]|all[aá]|alguna?|tienda|local|sucursal)?\s*(en|aqui en|alla en)\s+(\w+)/i.test(msg) ||
      /\b(son|eres|est[aá]s?)\s+(de|en)\s+(\w+)/i.test(msg)) {

    const location = detectMexicanLocation(msg);
    const cityName = location ? (location.normalized.charAt(0).toUpperCase() + location.normalized.slice(1)) : "esa ciudad";

    await updateConversation(psid, { lastIntent: "asking_if_local", unknownCount: 0 });

    // Check if they're asking about Querétaro specifically
    if (/quer[ée]taro/i.test(msg)) {
      return {
        type: "text",
        text: `Sí, estamos en Querétaro 🏡. Nuestra bodega está en el Microparque Industrial Navex Park.\n\nAdemás, enviamos a todo México a través de Mercado Libre.\n\n¿Qué medida te interesa?`
      };
    }

    // They're asking about a different city
    return {
      type: "text",
      text: `Estamos ubicados en Querétaro, pero enviamos a ${cityName} y todo México sin problema a través de Mercado Libre 📦🚚.\n\n¿Qué medida necesitas?`
    };
  }

  // 🏙️ City/Location response after shipping question (context-aware)
  // If user was just asked about shipping and responds with a city name
  // Use actual Mexican location lookup instead of pattern matching
  const acceptCityAfterMeasure = convo.lastIntent === "specific_measure" && convo.requestedSize;

  if (convo.lastIntent === "shipping_info" || convo.lastIntent === "city_provided" || acceptCityAfterMeasure) {
    // Check if message is likely a location name (short, not a question)
    if (isLikelyLocationName(msg)) {
      // Try to detect actual Mexican location
      const location = detectMexicanLocation(msg);

      if (location) {
        // Confirmed Mexican city or state
        const cityName = location.normalized;

    await updateConversation(psid, {
      lastIntent: "city_provided",
      unknownCount: 0
    });

    // Build context-aware response
    let response = "";

    if (convo.requestedSize) {
      // User mentioned a size earlier
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. Para la malla sombra de ${convo.requestedSize} que te interesa, el envío va incluido en zona urbana.\n\n¿Te gustaría comprarlo o prefieres más información? 😊`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nPara la malla sombra de ${convo.requestedSize}, el envío es garantizado.\n\n¿Te gustaría comprarlo o necesitas más información? 😊`;
      }
    } else {
      // No size mentioned yet
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. El envío va incluido en zona urbana.\n\nCuéntame, ¿qué medida te interesa? Tenemos:\n• 3x4m - $450\n• 4x6m - $650`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nCuéntame, ¿qué medida te interesa? Tenemos:\n• 3x4m - $450\n• 4x6m - $650`;
      }
    }

        return {
          type: "text",
          text: response
        };
      }
    }
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

  // 📏 MEASURES INTENT - Handle size/dimension inquiries (MOVED BEFORE BUYING INTENT)
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

  // Parse specific dimensions from message EARLY (before color/other checks)
  // This allows us to handle multi-intent messages like "quiero una 6x4 azul"
  const dimensions = parseDimensions(msg);

  // Check for approximate measurement / need to measure properly
  if (isApproximateMeasure(msg)) {
    await updateConversation(psid, { lastIntent: "measurement_guidance", unknownCount: 0 });
    const guidanceResponses = [
      `¡Perfecto! 📏 Te recomiendo medir el área total y luego elegir una malla aproximadamente 1 metro cuadrado más pequeña que el espacio. Esto deja espacio para los tensores y asegura una instalación adecuada.\n\nCuando tengas la medida exacta, con gusto te ayudo a elegir el tamaño ideal 🌿`,
      `Muy bien pensado medir con precisión 👍. Un consejo: la malla debe ser cerca de 1m² más pequeña que el área total para dejar espacio a los tensores.\n\n¿Ya tienes una idea aproximada de las dimensiones?`,
      `Excelente idea medir bien 📐. Recuerda que la malla debe ser un poco más pequeña que el área (aproximadamente 1m² menos) para los tensores.\n\nCuando tengas las medidas, cuéntame y te sugiero la opción perfecta 🌿`
    ];
    return {
      type: "text",
      text: guidanceResponses[Math.floor(Math.random() * guidanceResponses.length)]
    };
  }

  // Check for color query ONLY if no dimensions are present
  // If dimensions are present, let the dimension handler deal with it
  if (isColorQuery(msg) && !dimensions) {
    await updateConversation(psid, { lastIntent: "color_query", unknownCount: 0 });
    const colorResponses = [
      `Por ahora solo manejamos malla sombra beige en versión confeccionada 🌿. ¿Te gustaría ver las medidas disponibles?`,
      `Actualmente tenemos disponible solo el color beige en malla confeccionada. ¿Quieres que te muestre los tamaños?`,
      `De momento contamos únicamente con beige, que es nuestro color más popular 😊. ¿Te interesa ver precios y medidas?`
    ];
    return {
      type: "text",
      text: colorResponses[Math.floor(Math.random() * colorResponses.length)]
    };
  }

  // Handle references to previously mentioned size ("esa medida", "la medida que envié/dije")
  if (/\b(esa|es[ae]|la|de\s+esa)\s+(medida|talla|dimension|tamaño)|la\s+que\s+(env[ií][eé]|dije|mencion[eé]|ped[ií]|puse)\b/i.test(msg) && convo.requestedSize) {
    // User is referencing the size they previously mentioned
    const requestedSizeStr = convo.requestedSize;
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
      await updateConversation(psid, { lastIntent: "size_reference_confirmed", unknownCount: 0 });

      return {
        type: "text",
        text: `Perfecto, para la medida de ${requestedSizeStr} que mencionaste:\n\n` +
              `Aquí está el enlace de nuestra Tienda Oficial:\n\n` +
              `${product.mLink}`
      };
    } else {
      // No exact match - provide alternatives
      const availableSizes = await getAvailableSizes();
      const dimensions = {
        width: parseFloat(match[1]),
        height: parseFloat(match[2]),
        area: parseFloat(match[1]) * parseFloat(match[2])
      };
      const closest = findClosestSizes(dimensions, availableSizes);

      const sizeResponse = generateSizeResponse({
        smaller: closest.smaller,
        bigger: closest.bigger,
        exact: closest.exact,
        requestedDim: dimensions,
        availableSizes,
        isRepeated: true
      });

      await updateConversation(psid, {
        lastIntent: "size_reference_alternatives",
        unknownCount: 0,
        suggestedSizes: sizeResponse.suggestedSizes
      });

      return {
        type: "text",
        text: sizeResponse.text
      };
    }
  }

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
      let closest = findClosestSizes(dimensions, availableSizes);
      const requestedSizeStr = `${dimensions.width}x${dimensions.height}`;

      // 🔄 CHECK SWAPPED DIMENSIONS if no exact match found
      // For "3 ancho x 5 largo" (3x5), also check if 5x3 exists
      let swappedSizeStr = null;
      if (!closest.exact) {
        swappedSizeStr = `${dimensions.height}x${dimensions.width}`;
        const swappedDimensions = { width: dimensions.height, height: dimensions.width, area: dimensions.area };
        const swappedClosest = findClosestSizes(swappedDimensions, availableSizes);

        // If swapped dimension has exact match, use it instead
        if (swappedClosest.exact) {
          closest = swappedClosest;
        }
      }

      // 🌍 Detect location mention (shipping intent)
      const hasLocationMention = /\b(vivo\s+en|soy\s+de|estoy\s+en|me\s+encuentro\s+en)\b/i.test(msg);
      const hasBuyingIntent = /\b(quiero|comprar|compro|pedir|ordenar|llevar|adquirir)\b/i.test(msg);

      // Check if user is insisting on the same unavailable size
      const isRepeated = !closest.exact &&
                        convo.lastUnavailableSize === requestedSizeStr &&
                        convo.lastIntent === "specific_measure";

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
          // Update conversation state with exact match
          await updateConversation(psid, {
            lastIntent: "specific_measure",
            unknownCount: 0,
            requestedSize: closest.exact.sizeStr,
            lastUnavailableSize: null
          });

          // 🎨 Check if user mentioned a color
          const hasColorMention = isColorQuery(msg);

          // Build response text
          let responseText = `Por supuesto, de ${closest.exact.sizeStr} la tenemos en $${closest.exact.price}`;

          // Add color info if color was mentioned
          if (hasColorMention) {
            responseText += `\n\nActualmente solo manejamos color beige en malla confeccionada.`;
          }

          // Add shipping info if location mentioned or buying intent
          if (hasLocationMention || hasBuyingIntent) {
            responseText += `\n\nEnviamos a todo el país a través de Mercado Libre.`;
          }

          responseText += `\n\nAquí está el enlace de nuestra Tienda Oficial:\n\n${product.mLink}`;

          return {
            type: "text",
            text: responseText
          };
        }
      }

      // No exact match - generate response with alternatives
      const sizeResponse = generateSizeResponse({
        smaller: closest.smaller,
        bigger: closest.bigger,
        exact: closest.exact,
        requestedDim: dimensions,
        availableSizes,
        isRepeated
      });

      // Update conversation state with suggested sizes for context
      await updateConversation(psid, {
        lastIntent: "specific_measure",
        unknownCount: 0,
        requestedSize: requestedSizeStr,
        lastUnavailableSize: closest.exact ? null : requestedSizeStr,
        suggestedSizes: sizeResponse.suggestedSizes // Save for follow-up questions
      });

      return {
        type: "text",
        text: sizeResponse.text
      };
    } else {
      // Generic inquiry - check context from previous conversation

      // FIRST: Check if we suggested alternatives and user is asking for prices
      if (convo.suggestedSizes && convo.suggestedSizes.length > 0 && convo.lastIntent === "specific_measure") {
        // User was shown alternatives (e.g., "3x4m o 4x6m"), now asking "En cuanto sale?"
        // Fetch prices for the suggested sizes
        const sizePrices = [];

        for (const sizeStr of convo.suggestedSizes) {
          const sizeVariants = [sizeStr, sizeStr + 'm'];

          // Add swapped dimensions
          const match = sizeStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
          if (match) {
            const swapped = `${match[2]}x${match[1]}`;
            sizeVariants.push(swapped, swapped + 'm');
          }

          const product = await Product.findOne({
            size: { $in: sizeVariants },
            type: "confeccionada"
          });

          if (product) {
            sizePrices.push({
              size: sizeStr,
              price: product.price,
              mLink: product.mLink
            });
          }
        }

        if (sizePrices.length > 0) {
          await updateConversation(psid, { lastIntent: "suggested_sizes_pricing", unknownCount: 0 });

          // Build response with prices for suggested sizes
          let responseText = "Las medidas que te sugerí tienen estos precios:\n\n";
          sizePrices.forEach(sp => {
            responseText += `• ${sp.size} por $${sp.price}\n`;
          });
          responseText += "\n¿Cuál te interesa?";

          return {
            type: "text",
            text: responseText
          };
        }
      }

      // SECOND: Check if user mentioned specific size before
      if (convo.requestedSize && (convo.lastIntent === "specific_measure" || convo.lastIntent === "generic_measures")) {
        // User asked for a size before, now asking for price - provide that size's info
        const requestedSizeStr = convo.requestedSize;
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
          await updateConversation(psid, { lastIntent: "specific_measure_context", unknownCount: 0 });

          return {
            type: "text",
            text: `Por supuesto, de ${requestedSizeStr} la tenemos en $${product.price}\n\n` +
                  `Aquí está el enlace de nuestra Tienda Oficial:\n\n` +
                  `${product.mLink}`
          };
        }
      }

      // Generic inquiry - show all available sizes
      await updateConversation(psid, { lastIntent: "generic_measures", unknownCount: 0 });

      // Check if location was mentioned in the message
      const hasLocationInGeneric = /\b(vivo\s+en|soy\s+de|estoy\s+en|me\s+encuentro\s+en)\s+(\w+)/i.test(msg);

      let responseText = generateGenericSizeResponse(availableSizes);

      // Add shipping info if location was mentioned
      if (hasLocationInGeneric) {
        responseText += `\n\nEnviamos a todo México. El envío está incluido en la mayoría de los casos o se calcula automáticamente:\n\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob`;
      }

      return {
        type: "text",
        text: responseText
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
