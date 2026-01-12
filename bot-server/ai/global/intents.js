// ai/global/intents.js
const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const {
  parseDimensions,
  getAvailableSizes,
  findClosestSizes,
  isInstallationQuery,
  isColorQuery,
  isWeedControlQuery,
  isApproximateMeasure,
  hasFractionalMeters,
  generateSizeResponse,
  generateGenericSizeResponse
} = require("../../measureHandler");
const ProductFamily = require("../../models/ProductFamily");

// Helper to get preferred link from ProductFamily
function getProductLink(product) {
  if (!product) return null;
  return product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
         product.onlineStoreLinks?.[0]?.url || null;
}
const { detectMexicanLocation, isLikelyLocationName } = require("../../mexicanLocations");
const { generateClickLink } = require("../../tracking");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { selectRelevantAsset, trackAssetMention, insertAssetIntoResponse } = require("../assetManager");
const { handleRollQuery } = require("../core/rollQuery");

// Helper to check if location is also being asked in a multi-question message
function isAlsoAskingLocation(msg) {
  return /\b(d[oó]nde\s+est[aá]n|d[oó]nde\s+quedan|ubicaci[oó]n|direcci[oó]n|d[oó]nde\s+se\s+encuentran)\b/i.test(msg);
}

// Helper to get location text for combined responses
function getLocationAppendix() {
  return "\n\n📍 Estamos en Querétaro:\n" +
         "Calle Loma de San Gremal 108, bodega 73, Navex Park\n" +
         "C.P. 76137, Santiago de Querétaro\n\n" +
         "Enviamos a todo el país por Mercado Libre.";
}

async function handleGlobalIntents(msg, psid, convo = {}) {

  console.log("🌍 INTENTOS GLOBALES CHECANDO →", msg);

  // 😤 FRUSTRATION DETECTION - Escalate to human when user is frustrated
  // Patterns: "estoy diciendo", "no leen", "no entienden", "ya les dije", etc.
  const frustrationPatterns = /\b(estoy\s+diciendo|no\s+leen|no\s+entienden|ya\s+(te|les?)\s+dije|les?\s+repito|no\s+me\s+escuchan?|no\s+ponen\s+atenci[oó]n|acabo\s+de\s+decir|como\s+te\s+dije|como\s+ya\s+dije|ya\s+lo\s+dije|no\s+est[aá]n?\s+entendiendo|no\s+entendieron|no\s+entendi[oó]|pero\s+ya\s+dije|pero\s+estoy\s+diciendo|dios\s+me\s+los\s+bendiga)\b/i;

  if (frustrationPatterns.test(msg)) {
    console.log("😤 User frustration detected, escalating to human:", msg);
    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      frustrationDetected: true
    });
    await sendHandoffNotification(psid, convo, "Cliente frustrado - necesita atención humana urgente");
    return {
      type: "text",
      text: "Disculpa la confusión. Te comunico con un asesor para ayudarte mejor.\n\n" +
            "En un momento te atienden."
    };
  }

  // 🔄 FOLLOW-UP: Handle responses to "price_by_meter" question
  if (convo.lastIntent === "price_by_meter") {
    // User was asked: "¿Qué te interesa: una medida específica confeccionada o un rollo completo?"

    if (/\b(rollo|rollos?)\b/i.test(msg)) {
      // User wants rolls - call the roll query handler
      console.log("✅ User chose rolls after price_by_meter question");
      return await handleRollQuery(msg, psid, convo);
    } else if (/\b(confeccionad[ao]|medida|medidas?|espec[ií]fic[ao])\b/i.test(msg)) {
      // User wants confeccionadas - show available sizes
      console.log("✅ User chose confeccionadas after price_by_meter question");
      const availableSizes = await getAvailableSizes(convo);
      const response = generateGenericSizeResponse(availableSizes);
      await updateConversation(psid, { lastIntent: "sizes_shown" });
      return { type: "text", text: response };
    }
    // If unclear response, let it continue to normal flow
  }

  // 📏 SKIP if message contains MULTIPLE size requests (let fallback handle comprehensive answer)
  const multipleSizeIndicators = [
    /\d+(?:\.\d+)?[xX×*]\d+(?:\.\d+)?.*\b(y|,|de)\b.*\d+(?:\.\d+)?[xX×*]\d+(?:\.\d+)?/i, // Multiple dimensions with "y" or comma (e.g., "4x3 y 4x4")
    /\bprecios\b/i, // Plural "precios" suggests multiple items
    /\bcostos?\s+de\s+.*\by\b/i, // "costos de X y Y" - costs of multiple items
    /\bmall?as?\b.*\bmall?as?\b/i, // Multiple mentions of "malla/mallas"
  ];

  const isMultiSize = multipleSizeIndicators.some(regex => regex.test(msg));
  if (isMultiSize) {
    console.log("📏 Multiple size request detected in handleGlobalIntents, delegating to fallback");
    return null;
  }

  // Normalize common misspellings
  msg = msg.replace(/\bmaya\b/gi, 'malla')
           .replace(/\bmaia\b/gi, 'malla')
           .replace(/\broyo\b/gi, 'rollo');

  // 🏪 MERCADO LIBRE STORE LINK - Handle requests to see the online store
  if (/\b(ver|visitar|ir a|mostrar|enviar|dar|darme|dame|quiero)\s+(la\s+)?(tienda|catalogo|cat[aá]logo)\b/i.test(msg) ||
      /\b(tienda\s+(en\s+l[ií]nea|online|virtual|mercado\s+libre))\b/i.test(msg) ||
      /\b(link|enlace)\s+(de\s+)?(la\s+)?(tienda|catalogo)\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "store_link_requested" });

    const storeUrl = "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
    const trackedLink = await generateClickLink(psid, storeUrl, {
      productName: "Tienda Oficial",
      campaignId: convo.campaignId,
      adSetId: convo.adSetId,
      adId: convo.adId,
      userName: convo.userName,
      city: convo.city,
      stateMx: convo.stateMx
    });

    return {
      type: "text",
      text: "Ver tienda en línea\nIngresa al siguiente link:\n\n" +
            trackedLink + "\n\n" +
            "Estamos disponibles para ayudarte con cualquier duda sobre nuestros productos."
    };
  }

  // 🛒 HOW TO PURCHASE - Handle questions about the purchase process
  if (/\bc[oó]mo\s+(realiz[oa]|hago|hacer|efectu[oa]r?|concret[oa]r?)\s+(una?\s+)?(compra|pedido|orden)/i.test(msg) ||
      /\b(proceso|pasos?)\s+(de\s+|para\s+)?(compra|comprar|pedir|ordenar)/i.test(msg) ||
      /\b(d[oó]nde|c[oó]mo)\s+(compro|pido|ordeno|puedo\s+comprar)/i.test(msg)) {

    // Check if user is asking about a specific product that requires human advisor
    if (convo.requestedProduct) {
      const ProductFamily = require("../../models/ProductFamily");

      try {
        const product = await ProductFamily.findById(convo.requestedProduct);

        // If product requires human advisor, explain they'll be contacted with process
        if (product && product.requiresHumanAdvisor) {
          await updateConversation(psid, { lastIntent: "purchase_process_human_advisor" });

          return {
            type: "text",
            text: `Para este producto, uno de nuestros asesores se pondrá en contacto contigo para explicarte el proceso de compra personalizado y resolver todas tus dudas.\n\n` +
                  `Este tipo de producto requiere asesoría especializada para asegurarnos de ofrecerte la mejor solución. ¿Te conecto con un asesor?`
          };
        }
      } catch (error) {
        console.error("Error fetching product for purchase process:", error);
        // Continue with standard ML process if error
      }
    }

    // Standard ML purchase process for regular products
    await updateConversation(psid, { lastIntent: "purchase_process" });

    const storeUrl = "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
    const trackedLink = await generateClickLink(psid, storeUrl, {
      productName: "Tienda Oficial",
      campaignId: convo.campaignId,
      adSetId: convo.adSetId,
      adId: convo.adId,
      userName: convo.userName,
      city: convo.city,
      stateMx: convo.stateMx
    });

    return {
      type: "text",
      text: "Para realizar tu compra, visita nuestra Tienda Oficial en Mercado Libre:\n\n" +
            trackedLink + "\n\n" +
            "Ahí puedes:\n" +
            "1. Seleccionar la medida que necesitas\n" +
            "2. Agregar al carrito\n" +
            "3. Pagar con tarjeta, efectivo o meses sin intereses\n" +
            "4. Proporcionar tu dirección de envío\n" +
            "5. Esperar la entrega en tu domicilio\n\n" +
            "El envío está incluido en la mayoría de los casos. ¿Te puedo ayudar con algo más?"
    };
  }

  // 🌿 WEED CONTROL / MALLA ANTIMALEZA - Handle questions about weed control
  if (isWeedControlQuery(msg)) {
    await updateConversation(psid, { lastIntent: "weed_control_query" });

    // Check if they're also asking about water permeability
    const asksAboutWater = /\b(agua|permeable|impermeable|lluvia|filtra|pasa|transmina|repele)\b/i.test(msg);

    let response = "";

    if (asksAboutWater) {
      // They're asking if malla sombra blocks weeds AND about water
      response = "La malla sombra es PERMEABLE, permite que el agua pase a través de ella. No repele el agua.\n\n";
      response += "Sin embargo, tenemos un producto específico para control de maleza: la MALLA ANTIMALEZA (Ground Cover), ";
      response += "que también es permeable y está diseñada especialmente para bloquear el crecimiento de maleza.\n\n";
    } else {
      // General weed control question
      response = "¡Tenemos justo lo que necesitas! Contamos con MALLA ANTIMALEZA (Ground Cover), ";
      response += "un producto especializado para bloquear el crecimiento de maleza.\n\n";
    }

    response += "Puedes ver todas las medidas disponibles en nuestra Tienda Oficial de Mercado Libre:\n\n";
    response += "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n";
    response += "¿Qué medida necesitas para tu proyecto?";

    return {
      type: "text",
      text: response
    };
  }

  // 🌧️ RAIN/WATERPROOF QUESTIONS - Clarify malla sombra is NOT waterproof
  // First check if "agua" appears in a location context (e.g., "Agua Prieta")
  const hasWaterKeyword = /\b(lluvia|lluvias|llueve|agua|mojarse|mojar|impermeable|impermeabiliza|protege\s+de(l)?\s+(agua|lluvia)|cubre\s+de(l)?\s+(agua|lluvia)|sirve\s+(para|contra)\s+(la\s+)?(lluvia|agua)|tapa\s+(la\s+)?(lluvia|agua)|repele|repelente)\b/i.test(msg);
  const isLocationContext = /\b(vivo\s+en|soy\s+de|estoy\s+en|est[aá]\s+en|ubicad[oa]\s+en|me\s+encuentro\s+en|mando\s+a|env[ií]o\s+a|entregar?\s+en)\b/i.test(msg);
  const detectedLocation = detectMexicanLocation(msg);

  if (hasWaterKeyword && !isLocationContext && !detectedLocation &&
      !/\b(antimaleza|ground\s*cover|maleza|hierba)\b/i.test(msg)) {

    // Check if we'd be repeating the same response - escalate to human instead
    if (convo.lastIntent === "rain_waterproof_question") {
      console.log("🔄 Would repeat waterproof response, escalating to human");
      await updateConversation(psid, { lastIntent: "human_handoff", state: "needs_human" });
      await sendHandoffNotification(psid, convo, "Cliente necesita atención - posible malentendido sobre impermeabilidad");
      return {
        type: "text",
        text: "Parece que hay algo que no estoy entendiendo bien. Déjame contactar a un asesor para que te ayude mejor.\n\n" +
              "En un momento te atienden."
      };
    }

    await updateConversation(psid, { lastIntent: "rain_waterproof_question" });

    return {
      type: "text",
      text: "No, la malla sombra no tiene propiedades impermeables. Es un tejido permeable que permite el paso del agua y el aire.\n\n" +
            "Su función principal es reducir la intensidad del sol ☀️ y proporcionar sombra, no proteger de la lluvia.\n\n" +
            "Si necesitas protección contra lluvia, te recomendaría buscar una lona impermeable o un toldo. ¿Te puedo ayudar con algo más sobre la malla sombra?"
    };
  }

  // 📍 LOCATION MENTION - User is saying where they are from/live
  // Handle "vivo en X", "soy de X", "estoy en X" to acknowledge and continue
  if (isLocationContext && detectedLocation) {
    console.log("📍 User mentioned their location:", detectedLocation.normalized);
    await updateConversation(psid, {
      lastIntent: "location_mentioned",
      userLocation: detectedLocation.normalized,
      unknownCount: 0
    });
    return {
      type: "text",
      text: `¡Claro! Hacemos envíos a ${detectedLocation.normalized} por paquetería 📦\n\n` +
            `¿Qué medida de malla sombra necesitas?`
    };
  }

  // ☀️ SHADE PERCENTAGE QUESTIONS - Explain available shade percentages
  if (/\b(qu[eé]\s+)?porcenta?je[s]?\s+(de\s+)?(sombra|tiene[ns]?|manejan?|hay)?\b/i.test(msg) ||
      /\b(qu[eé]\s+)?(sombra|porcentaje)[s]?\s+(tiene[ns]?|manejan?|hay|ofrece[ns]?)\b/i.test(msg) ||
      /\b(cu[aá]nta?\s+sombra|nivel\s+de\s+sombra|grado\s+de\s+sombra)\b/i.test(msg) ||
      /\b(diferencia|diferencias)\s+(entre|de)\s+(los\s+)?porcentajes?\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "shade_percentage_question" });

    return {
      type: "text",
      text: "Manejamos mallas sombra en diferentes porcentajes:\n\n" +
            "☀️ 35% - Sombra ligera, ideal para viveros y plantas que necesitan mucha luz\n" +
            "🌤️ 50% - Sombra media, buena para hortalizas y estacionamientos\n" +
            "⛅ 70% - Sombra media-alta, popular para terrazas y patios\n" +
            "🌥️ 80% - Sombra alta, la más vendida para casas y jardines\n" +
            "☁️ 90% - Sombra muy alta, máxima protección solar\n\n" +
            "El más popular es el 80%, ofrece buena sombra sin oscurecer demasiado. ¿Cuál te interesa?"
    };
  }

  // 📏 PRICING BY METER/ROLL - Handle "cuánto vale el metro" questions
  // NOTE: Removed general "rollo" pattern - that's handled by handleRollQuery in ai/index.js
  if (/\b(cu[aá]nto|precio|vale|cuesta)\s+(?:el\s+)?metro\b/i.test(msg) ||
      /\b(vend[eé]is|vendes|manejan)\s+(?:por\s+)?metros?\b/i.test(msg) ||
      /\b(comprar|vender)\s+(?:por\s+)?metros?\b/i.test(msg)) {

    // 🔴 EXPLICIT ROLL REQUEST: If customer explicitly asks for a roll with dimensions,
    // hand off to human immediately without asking clarifying questions
    const explicitRollRequest = /\b(rollo\s+(?:de|completo)\s+(?:\d+(?:\.\d+)?)\s*[xX×*]\s*(?:\d+(?:\.\d+)?)|\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?\s+rollo)\b/i.test(msg);

    if (explicitRollRequest) {
      const info = await getBusinessInfo();
      await updateConversation(psid, { lastIntent: "roll_explicit_request", state: "needs_human" });

      const whatsappLink = "https://wa.me/524425957432";

      return {
        type: "text",
        text: "Perfecto, con gusto te ayudamos con el rollo que necesitas.\n\n" +
              "Para cotizar rollos, comunícate directamente con uno de nuestros asesores:\n\n" +
              `💬 WhatsApp: ${whatsappLink}\n` +
              `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n` +
              `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`
      };
    }

    // General meter/roll inquiry - show options and ask
    await updateConversation(psid, { lastIntent: "price_by_meter" });

    return {
      type: "text",
      text: "No vendemos por metro 📏, sino por medidas específicas ya confeccionadas (2x2m, 3x4m, 4x6m, etc.).\n\n" +
            "Si necesitas comprar malla en rollo completo (por metro), vendemos rollos de:\n" +
            "• 4.20m x 100m\n" +
            "• 2.10m x 100m\n\n" +
            "¿Qué te interesa: una medida específica confeccionada o un rollo completo?"
    };
  }

  // 💬 DIRECT QUOTE REQUEST - "cotízame", "me la puedes cotizar", etc.
  // These require human attention, direct to WhatsApp
  if (/\b(cot[ií]za(me|la|lo)?|me\s+(la\s+)?puedes?\s+cotizar|puedes?\s+cotizar(me|la|lo)?|dame\s+cotizaci[oó]n|hazme\s+cotizaci[oó]n|necesito\s+cotizaci[oó]n)\b/i.test(msg)) {
    const info = await getBusinessInfo();
    const whatsappLink = "https://wa.me/524425957432";

    await updateConversation(psid, { lastIntent: "direct_quote_request", state: "needs_human" });

    return {
      type: "text",
      text: "Con gusto te cotizamos. Para atención personalizada, contáctanos:\n\n" +
            `💬 WhatsApp: ${whatsappLink}\n` +
            `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n` +
            `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`
    };
  }

  // 📋 CATALOG REQUEST - Handle requests for general pricing, sizes, and colors listing
  // Instead of dumping a huge list, ask for specific dimensions
  if (/\b(pongan?|den|muestren?|env[ií]en?|pasame?|pasen?|listado?)\s+(de\s+)?(precios?|medidas?|opciones?|tama[ñn]os?|colores?)\b/i.test(msg) ||
      /\b(precios?\s+y\s+medidas?)\b/i.test(msg) ||
      /\b(medidas?\s+y\s+precios?)\b/i.test(msg) ||
      /\b(hacer\s+presupuesto|cotizaci[oó]n)\b/i.test(msg) ||
      /\b(opciones?\s+disponibles?|qu[eé]\s+tienen|todo\s+lo\s+que\s+tienen)\b/i.test(msg) ||
      /\b(medidas?\s+est[aá]ndares?)\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "catalog_request" });

    // Don't dump entire product list - ask for dimensions instead
    return {
      type: "text",
      text: "Tenemos mallas sombra beige en varias medidas, desde 2x2m hasta 6x10m, y también rollos de 100m.\n\n" +
            "Para darte el precio exacto, ¿qué medida necesitas para tu proyecto? 📐"
    };
  }

  // 📋 EXPLICIT LIST REQUEST - "dígame las medidas", "muéstreme las opciones", "ver la lista"
  // User is explicitly asking to see all sizes with prices
  if (/\b(d[ií]game|mu[eé]str[ea]me|ens[eé][ñn]ame|ver|quiero\s+ver|dame)\s+(l[oa]s\s+)?(medidas|opciones|lista|precios|tama[ñn]os)/i.test(msg) ||
      /\b(todas?\s+las?\s+medidas?|todas?\s+las?\s+opciones?|lista\s+completa|ver\s+(la\s+)?lista)\b/i.test(msg) ||
      /\b(usted\s+d[ií]game|dime\s+t[uú]|d[ií]ganme)\b/i.test(msg) ||
      /\b(s[ií].*mu[eé]str[ea]me|s[ií].*ver\s+la\s+lista|s[ií].*las\s+opciones)\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "show_all_sizes_requested", unknownCount: 0 });

    // Fetch all available sizes
    const availableSizes = await getAvailableSizes(convo);

    if (availableSizes.length > 0) {
      let response = "📐 Estas son nuestras medidas confeccionadas con precio:\n\n";

      // Show all sizes up to 20
      const sizesFormatted = availableSizes.slice(0, 20).map(s => `• ${s.sizeStr} - $${s.price}`);
      response += sizesFormatted.join('\n');

      if (availableSizes.length > 20) {
        response += `\n\n... y ${availableSizes.length - 20} medidas más en nuestra tienda.`;
      }

      response += "\n\nTambién manejamos rollos de 4.20x100m y 2.10x100m.\n\n";
      response += "¿Cuál te interesa?";

      return { type: "text", text: response };
    }

    // Fallback if no sizes loaded
    return {
      type: "text",
      text: "Puedes ver todas nuestras medidas y precios en la Tienda Oficial:\n" +
            "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n" +
            "¿Qué medida necesitas?"
    };
  }

  // 💰 BULK/VOLUME DISCOUNT INQUIRY - Handle requests for bulk discounts
  // Detect: multiple units, wholesale, volume discounts, special prices
  if (/\b(descuento|rebaja|precio especial|precio mayoreo|mayoreo|volumen)\b/i.test(msg) ||
      /\b(\d+)\s+(piezas?|unidades?|mallas?|de la misma)\b/i.test(msg) ||
      /\b(si\s+encargar[aá]|si\s+compro|si\s+pido)\s+(\d+|vari[oa]s|much[oa]s)\b/i.test(msg)) {

    const info = await getBusinessInfo();

    const whatsappLink = "https://wa.me/524425957432";

    // Check if we already gave the bulk discount response recently
    if (convo.lastIntent === "bulk_discount_inquiry") {
      // Give a shorter follow-up response
      return {
        type: "text",
        text: "Como te comenté, para cotizaciones de volumen necesitas comunicarte con nuestros asesores:\n\n" +
              `💬 WhatsApp: ${whatsappLink}\n` +
              `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n\n` +
              "Ellos podrán darte el precio exacto para la cantidad que necesitas."
      };
    }

    await updateConversation(psid, { lastIntent: "bulk_discount_inquiry", state: "needs_human" });

    return {
      type: "text",
      text: "Los descuentos por volumen aplican para pedidos desde $20,000 MXN en adelante.\n\n" +
            "Para cotizar tu pedido y conocer los descuentos disponibles, te comunico con uno de nuestros asesores:\n\n" +
            `💬 WhatsApp: ${whatsappLink}\n` +
            `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n` +
            `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`
    };
  }

  // ✅ AFFIRMATIVE RESPONSE - Handle "sí", "si", "yes", "dale", "me interesa" after showing size/price
  // Using word boundaries (\b) instead of anchors (^$) to catch affirmatives even with additional text
  // e.g., "si de esa medida" or "si con argollas" will now be detected

  // Skip if message contains thanks/closing words (avoid redundant messages after user is done)
  const hasThanksClosure = /\b(gracias|muchas gracias|perfecto.*gracias|ok.*gracias|excelente.*gracias|muy amable|adiós|bye|nos vemos|ago\s+mi\s+pedido|hago\s+mi\s+pedido)\b/i.test(msg);

  // Check for "me interesa" - generic interest expression
  const isInterested = /\b(me\s+interesa|estoy\s+interesad[oa]|interesad[oa])\b/i.test(msg);

  if (!hasThanksClosure && (isInterested || /\b(s[ií]|yes|dale|ok|claro|perfecto|adelante|exact[oa]|correct[oa]|as[ií]|esa|ese)\b/i.test(msg))) {

    // If just "me interesa" without specific context, show basic product info
    if (isInterested && !convo.lastIntent) {
      await updateConversation(psid, { lastIntent: "interest_expressed", unknownCount: 0 });

      return {
        type: "text",
        text: "¡Perfecto! Vendemos malla sombra beige confeccionada lista para instalar.\n\n" +
              "Tenemos medidas desde 2x2m hasta 6x10m, y también rollos de 100m.\n\n" +
              "¿Qué medida necesitas? 📐"
      };
    }

    // FIRST: Check if bot offered to show all standard sizes
    if (convo.offeredToShowAllSizes) {
      await updateConversation(psid, {
        lastIntent: "show_all_sizes_confirmed",
        unknownCount: 0,
        offeredToShowAllSizes: false // Clear the flag
      });

      // Fetch all available sizes (pass conversation for product context)
      const availableSizes = await getAvailableSizes(convo);

      // Build condensed list
      let response = "📐 Aquí están todas nuestras medidas disponibles:\n\n";

      // Group by area for better presentation
      const sizesFormatted = availableSizes.slice(0, 15).map(s => `• ${s.sizeStr} - $${s.price}`);
      response += sizesFormatted.join('\n');

      if (availableSizes.length > 15) {
        response += `\n\n... y ${availableSizes.length - 15} medidas más.`;
      }

      response += "\n\nPuedes ver todas en nuestra Tienda Oficial:\n";
      response += "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n";
      response += "¿Qué medida te interesa?";

      return {
        type: "text",
        text: response
      };
    }

    // Check if user was just shown a specific size/price
    if (convo.lastIntent === "specific_measure" && convo.requestedSize) {
      const sizeVariants = [convo.requestedSize, convo.requestedSize + 'm'];

      // Add swapped dimensions
      const match = convo.requestedSize.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (match) {
        const swapped = `${match[2]}x${match[1]}`;
        sizeVariants.push(swapped, swapped + 'm');
      }

      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: true
      });

      const productLink = getProductLink(product);
      if (productLink) {
        await updateConversation(psid, { lastIntent: "affirmative_link_provided", unknownCount: 0 });

        const trackedLink = await generateClickLink(psid, productLink, {
          productName: product.name,
          productId: product._id,
          campaignId: convo.campaignId,
          adSetId: convo.adSetId,
          adId: convo.adId,
          city: convo.city,
          stateMx: convo.stateMx
        });

        return {
          type: "text",
          text: `Te dejo el link a esa medida específica:\n\n` +
                `${trackedLink}\n\n` +
                `Estamos disponibles para cualquier información adicional.`
        };
      } else {
        // If no exact product found, provide alternatives
        const availableSizes = await getAvailableSizes(convo);
        const businessInfo = await getBusinessInfo();
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
            isRepeated: false,
            businessInfo
          });

          // Update conversation with the flag if we offered to show all sizes
          if (sizeResponse.offeredToShowAllSizes) {
            await updateConversation(psid, { offeredToShowAllSizes: true });
          }

          // Handle custom order handoff (both sides >= 8m)
          if (sizeResponse.isCustomOrder && sizeResponse.requiresHandoff) {
            console.log(`🏭 Custom order detected (${dimensions.width}x${dimensions.height}m), triggering handoff`);

            await updateConversation(psid, {
              lastIntent: "custom_order_request",
              handoffRequested: true,
              handoffReason: `Custom order request: ${dimensions.width}x${dimensions.height}m - both sides >= 8m`,
              handoffTimestamp: new Date(),
              state: "needs_human",
              unknownCount: 0
            });

            // Send push notification
            sendHandoffNotification(psid, `Pedido especial: ${dimensions.width}x${dimensions.height}m - requiere cotización personalizada`).catch(err => {
              console.error("❌ Failed to send push notification:", err);
            });
          }

          return {
            type: "text",
            text: sizeResponse.text
          };
        }
      }
    }
  }

  // 📍 Ubicación - return null to let Facebook automated responses handle it
  // Note: "ciudad" removed - too broad, matches "Ciudad de México" when user answers where they're from
  if (/d[oó]nde|h?ubicaci[oó]n|ubicad[oa]|direcci[oó]n|qued[ao]|mapa|local|encuentran/i.test(msg)) {
    console.log("📍 Location question detected, deferring to Facebook automated response");
    await updateConversation(psid, { lastIntent: "location_info" });
    return null;
  }

  // 💰 Where to pay/deposit - Direct ML payment answer
  if (/\b(d[oó]nde|donde|a\s+d[oó]nde)\s+(deposito|pago|se\s+paga|se\s+deposita|hago\s+el\s+pago|realizo\s+el\s+pago)\b/i.test(msg) ||
      /\b(pago|deposito)\s+(al\s+entregar|contra\s+entrega)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "payment_location" });

    return {
      type: "text",
      text: "El pago se realiza a través de Mercado Libre al momento de hacer tu pedido.\n\n" +
            "Aceptan tarjeta, efectivo en OXXO, o meses sin intereses.\n\n" +
            "¿Te paso el link del producto?"
    };
  }

  // 📷 User claims they sent photos but we can't see them - direct to WhatsApp
  if (/\b(s[ií]\s+)?mand[eé]|envi[eé]|ya\s+(te\s+)?(mand[eé]|envi[eé])|te\s+(mand[eé]|envi[eé])|las?\s+mand[eé]|las?\s+envi[eé]/i.test(msg) &&
      /\b(foto|fotos|fotho|fothos|imagen|imagenes|imágenes|picture|pictures)\b/i.test(msg)) {
    const whatsappLink = "https://wa.me/524425957432";
    await updateConversation(psid, { lastIntent: "photo_claim" });

    return {
      type: "text",
      text: "No me llegó la foto por este medio. Por favor envíala a nuestro WhatsApp para poder verla:\n\n" +
            `💬 ${whatsappLink}`
    };
  }

  // 🔘 EYELETS/HOLES QUESTION - "ojitos", "argollas", "orificios"
  // Confeccionada comes with reinforced eyelets every 50cm
  if (/\b(ojito|ojitos|ojillo|ojillos|argolla|argollas|orificio|orificios|agujero|agujeros|hoyito|hoyitos|para\s+colgar|para\s+amarrar|donde\s+amarro|c[oó]mo\s+se\s+instala)\b/i.test(msg)) {
    await updateConversation(psid, { lastIntent: "eyelets_question", unknownCount: 0 });

    return {
      type: "text",
      text: "Sí, nuestra malla confeccionada viene con ojillos reforzados cada 50cm en todo el perímetro para facilitar la instalación.\n\n" +
            "Solo necesitas amarrarla o usar ganchos. ¿Qué medida te interesa?"
    };
  }

  // 💳 Alternative payment method (in-person at store)
  if (/otra\s+forma|otro\s+(m[eé]todo|modo)|alternativa.*pago|pago.*persona|pago.*local|pago.*tienda|pagar.*efectivo|efectivo.*directo/i.test(msg)) {
    const businessInfo = await getBusinessInfo();
    await updateConversation(psid, { lastIntent: "alternative_payment" });

    return {
      type: "text",
      text: `La única alternativa al pago por Mercado Libre es venir directamente a nuestras oficinas en Querétaro y pagar en efectivo o con tarjeta.\n\n` +
            `📍 ${businessInfo.address}\n` +
            `📞 ${businessInfo.phones.join(" / ")}\n` +
            `🕓 ${businessInfo.hours}\n\n` +
            `¿Te encuentras en Querétaro?`
    };
  }

  // ⏳ PRODUCT LIFESPAN / DURABILITY - Handle questions about how long the product lasts
  if (/\b(tiempo\s+de\s+vida|vida\s+[uú]til|cu[aá]nto\s+(tiempo\s+)?dura|duraci[oó]n|garant[ií]a|cuantos\s+a[ñn]os|por\s+cu[aá]nto\s+tiempo|resistencia)\b/i.test(msg) &&
      !/\b(entrega|env[ií]o|llega|demora|tarda)\b/i.test(msg)) {

    // Select relevant asset (UV protection and reinforced quality are highly relevant here)
    const asset = selectRelevantAsset(msg, convo, {
      intent: "product_lifespan",
      excludeAssets: ["uvProtection"] // Already mentioned in main response
    });

    let responseText = "La malla sombra reforzada tiene una vida útil de 8 a 10 años aproximadamente, dependiendo de:\n\n" +
          "• Exposición al sol y clima\n" +
          "• Tensión de la instalación\n" +
          "• Mantenimiento (limpieza ocasional)\n\n" +
          "Nuestras mallas son de alta calidad con protección UV, por lo que son muy resistentes a la intemperie 🌞🌧️\n\n" +
          "¿Qué medida te interesa?";

    // Add asset mention if selected
    if (asset) {
      responseText = insertAssetIntoResponse(responseText, asset.text);
      const mentionedAssets = trackAssetMention(asset.key, convo);
      await updateConversation(psid, { lastIntent: "product_lifespan", mentionedAssets });
    } else {
      await updateConversation(psid, { lastIntent: "product_lifespan" });
    }

    return {
      type: "text",
      text: responseText
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

    // Select relevant asset (payment options and immediate stock are relevant here)
    const asset = selectRelevantAsset(msg, convo, {
      intent: "delivery_time_payment",
      excludeAssets: ["paymentOptions"] // Already mentioned in main response
    });

    let responseText = "💳 El pago se realiza 100% POR ADELANTADO en Mercado Libre al momento de hacer tu pedido (no se paga al recibir).\n\n" +
          "Aceptamos todas las formas de pago de Mercado Libre: tarjetas, efectivo, meses sin intereses.\n\n" +
          "⏰ Tiempos de entrega:\n" +
          "• CDMX y zona metropolitana: 1-2 días hábiles\n" +
          "• Interior de la República: 3-5 días hábiles";

    // Add asset mention if selected
    if (asset) {
      responseText = insertAssetIntoResponse(responseText, asset.text);
      const mentionedAssets = trackAssetMention(asset.key, convo);
      await updateConversation(psid, { lastIntent: "delivery_time_payment", mentionedAssets });
    } else {
      await updateConversation(psid, { lastIntent: "delivery_time_payment" });
    }

    return {
      type: "text",
      text: responseText
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
      // Detect and store city if mentioned (e.g., "Envían a Hermosillo?")
      const shippingLocation = detectMexicanLocation(msg);
      if (shippingLocation) {
        const cityUpdate = { city: shippingLocation.normalized };
        if (shippingLocation.type === 'state') cityUpdate.stateMx = shippingLocation.normalized;
        await updateConversation(psid, cityUpdate);
        console.log(`📍 City detected in shipping question: ${shippingLocation.normalized}`);
      }

      // Select relevant asset to mention (shipping is already the main topic)
      const asset = selectRelevantAsset(msg, convo, {
        intent: "shipping_info",
        excludeAssets: ["nationalShipping"] // Already covered in main response
      });

      // If user already asked about a specific size, give them the link directly
      if (convo.requestedSize) {
      const sizeVariants = [convo.requestedSize, convo.requestedSize + 'm'];

      // Add swapped dimensions
      const match = convo.requestedSize.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (match) {
        const swapped = `${match[2]}x${match[1]}`;
        sizeVariants.push(swapped, swapped + 'm');
      }

      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: true
      });

      const productLink = getProductLink(product);
      if (productLink) {
        const trackedLink = await generateClickLink(psid, productLink, {
          productName: product.name,
          productId: product._id,
          campaignId: convo.campaignId,
          adSetId: convo.adSetId,
          adId: convo.adId,
          city: convo.city,
          stateMx: convo.stateMx
        });

        let responseText = `Sí, enviamos a todo el país. El envío está incluido en la mayoría de los casos o se calcula automáticamente en Mercado Libre.\n\nTe dejo el link a esa medida específica:\n\n${trackedLink}`;

        // Add asset mention if selected
        if (asset) {
          responseText = insertAssetIntoResponse(responseText, asset.text);
          const mentionedAssets = trackAssetMention(asset.key, convo);
          await updateConversation(psid, { lastIntent: "shipping_info", mentionedAssets });
        } else {
          await updateConversation(psid, { lastIntent: "shipping_info" });
        }

        return {
          type: "text",
          text: responseText
        };
      }
    }

      let responseText = `¡Sí! Enviamos a toda la república 📦\n\n¿Qué medida necesitas?`;

      // Add asset mention if selected
      if (asset) {
        responseText = insertAssetIntoResponse(responseText, asset.text);
        const mentionedAssets = trackAssetMention(asset.key, convo);
        await updateConversation(psid, { lastIntent: "shipping_info", mentionedAssets });
      } else {
        await updateConversation(psid, { lastIntent: "shipping_info" });
      }

      return {
        type: "text",
        text: responseText
      };
    }
  }

  // 🏢 ASKING IF WE'RE PHYSICALLY LOCATED IN THEIR CITY
  // "Trabajan aquí en Reynosa?" / "Están en Monterrey?" / "Tienen tienda en Guadalajara?"
  if (/\b(trabajan?|est[aá]n?|tienen?|hay)\s+(aqu[ií]|all[aá]|alguna?|tienda|local|sucursal)?\s*(en|aqui en|alla en)\s+(\w+)/i.test(msg) ||
      /\b(son|eres|est[aá]s?)\s+(de|en)\s+(\w+)/i.test(msg)) {

    const location = detectMexicanLocation(msg);
    const cityName = location ? (location.normalized.charAt(0).toUpperCase() + location.normalized.slice(1)) : "esa ciudad";

    // Store city in conversation for sales attribution
    const updateData = { lastIntent: "asking_if_local", unknownCount: 0 };
    if (location) {
      updateData.city = location.normalized;
      if (location.type === 'state') updateData.stateMx = location.normalized;
      console.log(`📍 City detected and stored: ${location.normalized}`);
    }
    await updateConversation(psid, updateData);

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

  if (convo.lastIntent === "shipping_info" || convo.lastIntent === "location_info" || convo.lastIntent === "city_provided" || acceptCityAfterMeasure) {
    // Check if message is likely a location name (short, not a question)
    if (isLikelyLocationName(msg)) {
      // Try to detect actual Mexican location
      const location = detectMexicanLocation(msg);

      if (location) {
        // Confirmed Mexican city or state
        const cityName = location.normalized;

    // Store city in conversation for sales attribution
    const updateData = {
      lastIntent: "city_provided",
      unknownCount: 0,
      city: location.normalized
    };
    if (location.type === 'state') updateData.stateMx = location.normalized;
    console.log(`📍 City detected and stored: ${location.normalized}`);
    await updateConversation(psid, updateData);

    // Build context-aware response
    let response = "";

    if (convo.requestedSize) {
      // User mentioned a size earlier
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. Para la malla sombra de ${convo.requestedSize} que te interesa, el envío va incluido en zona urbana.\n\nPuedes verlo en nuestra Tienda Oficial de ML:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Te gustaría más información? 😊`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nPara la malla sombra de ${convo.requestedSize}, el envío es garantizado a través de Mercado Libre:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Te gustaría más información? 😊`;
      }
    } else {
      // No size mentioned yet
      if (/quer[ée]taro/i.test(cityName)) {
        response = `Perfecto, estás en Querétaro 🏡. El envío va incluido en zona urbana.\n\nPuedes ver nuestras medidas en la Tienda Oficial:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Qué medida te interesa?`;
      } else {
        response = `Perfecto, enviamos a ${cityName.charAt(0).toUpperCase() + cityName.slice(1)} sin problema 🚚.\n\nPuedes ver todas las medidas en nuestra Tienda Oficial:\nhttps://www.mercadolibre.com.mx/tienda/distribuidora-hanlob\n\n¿Qué medida necesitas?`;
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

      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: true
      });

      const productLink = getProductLink(product);
      if (productLink) {
        const trackedLink = await generateClickLink(psid, productLink, {
          productName: product.name,
          productId: product._id,
          campaignId: convo.campaignId,
          adSetId: convo.adSetId,
          adId: convo.adId,
          city: convo.city,
          stateMx: convo.stateMx
        });

        return {
          type: "text",
          text: `Te dejo el link a esa medida específica:\n\n` +
                `${trackedLink}\n\n` +
                `Estamos disponibles para cualquier información adicional.`
        };
      }
    }

    // Generic details request without specific size context
    // Check if user has a campaign reference - show campaign description
    if (convo.campaignRef) {
      const Campaign = require("../../models/Campaign");
      const campaign = await Campaign.findOne({ ref: convo.campaignRef });

      if (campaign?.description) {
        return {
          type: "text",
          text: `📋 *Ficha Técnica - ${campaign.name}*\n\n` +
                `${campaign.description}\n\n` +
                `¿Te gustaría conocer las medidas y precios disponibles?`
        };
      }
    }

    // No campaign or no description - ask which size they want info about
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
  // BUT only if no dimensions were parsed (including from reference objects)
  if (isApproximateMeasure(msg) && !dimensions) {
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
    // Detect if this is a color CONFIRMATION (user confirming they want beige)
    // vs a color INQUIRY (user asking what colors are available)
    const isConfirmation = /\b(esta\s+bien|está\s+bien|ok|perfecto|si|sí|dale|claro|ese|esa|me\s+gusta)\b/i.test(msg);

    if (isConfirmation) {
      // User is confirming they want beige - show products directly
      await updateConversation(psid, { lastIntent: "color_confirmed", unknownCount: 0 });

      // Don't dump entire product list - ask for dimensions instead
      return {
        type: "text",
        text: "¡Perfecto! Tenemos varias medidas disponibles en beige, desde 2x2m hasta rollos de 100m.\n\n" +
              "¿Qué medida necesitas para tu proyecto?"
      };
    } else {
      // User is asking about colors - ask if they want to see sizes
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

    const product = await ProductFamily.findOne({
      size: { $in: sizeVariants },
      sellable: true,
      active: true
    });

    const productLink = getProductLink(product);
    if (productLink) {
      await updateConversation(psid, { lastIntent: "size_reference_confirmed", unknownCount: 0 });

      const trackedLink = await generateClickLink(psid, productLink, {
        productName: product.name,
        productId: product._id,
        campaignId: convo.campaignId,
        adSetId: convo.adSetId,
        adId: convo.adId,
        city: convo.city,
        stateMx: convo.stateMx
      });

      let responseText = `Perfecto, para la medida de ${requestedSizeStr} que mencionaste:\n\n` +
              `Te dejo el link a esa medida específica:\n\n` +
              `${trackedLink}`;

      // Append location if also asked
      if (isAlsoAskingLocation(msg)) {
        responseText += getLocationAppendix();
      }

      return { type: "text", text: responseText };
    } else {
      // No exact match - provide alternatives
      const availableSizes = await getAvailableSizes(convo);
      const businessInfo = await getBusinessInfo();
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
        isRepeated: true,
        businessInfo
      });

      // Handle custom order handoff (both sides >= 8m)
      if (sizeResponse.isCustomOrder && sizeResponse.requiresHandoff) {
        console.log(`🏭 Custom order detected (${dimensions.width}x${dimensions.height}m), triggering handoff`);

        await updateConversation(psid, {
          lastIntent: "custom_order_request",
          handoffRequested: true,
          handoffReason: `Custom order request: ${dimensions.width}x${dimensions.height}m - both sides >= 8m`,
          handoffTimestamp: new Date(),
          state: "needs_human",
          unknownCount: 0
        });

        // Send push notification
        sendHandoffNotification(psid, `Pedido especial: ${dimensions.width}x${dimensions.height}m - requiere cotización personalizada`).catch(err => {
          console.error("❌ Failed to send push notification:", err);
        });
      } else {
        await updateConversation(psid, {
          lastIntent: "size_reference_alternatives",
          unknownCount: 0,
          suggestedSizes: sizeResponse.suggestedSizes,
          offeredToShowAllSizes: sizeResponse.offeredToShowAllSizes || false
        });
      }

      let responseText = sizeResponse.text;
      // Append location if also asked
      if (isAlsoAskingLocation(msg)) {
        responseText += getLocationAppendix();
      }
      return { type: "text", text: responseText };
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
    const availableSizes = await getAvailableSizes(convo);

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

      // 📏 Check if dimensions contain fractional meters
      const hasFractions = hasFractionalMeters(dimensions);

      // 📏 Handle fractional meters FIRST - even if there's an "exact" match within tolerance
      // This ensures we warn users that only whole meters are available
      if (hasFractions) {
        // Calculate rounded dimensions to nearest full meter
        const roundedWidth = Math.round(dimensions.width);
        const roundedHeight = Math.round(dimensions.height);

        // Build fractional meter warning response
        let responseText = `📏 Nota: Solo vendemos medidas en metros completos (sin decimales).\n\n`;
        responseText += `Para la medida que solicitaste (${dimensions.width}m x ${dimensions.height}m), las opciones más cercanas son:\n\n`;

        // Show closest smaller and bigger options
        const optionsToShow = [];
        if (closest.smaller) optionsToShow.push(closest.smaller);
        if (closest.bigger) optionsToShow.push(closest.bigger);
        if (closest.exact) optionsToShow.push(closest.exact);

        // If we have options, show them with ML links
        if (optionsToShow.length > 0) {
          for (const option of optionsToShow) {
            // Fetch the product to get ML link
            const sizeVariants = [option.sizeStr, option.sizeStr + 'm'];
            const match = option.sizeStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
            if (match) {
              const swapped = `${match[2]}x${match[1]}`;
              sizeVariants.push(swapped, swapped + 'm');
            }

            const product = await ProductFamily.findOne({
              size: { $in: sizeVariants },
              sellable: true,
              active: true
            });

            const productLink = getProductLink(product);
            if (productLink) {
              const trackedLink = await generateClickLink(psid, productLink, {
                productName: product.name,
                productId: product._id,
                campaignId: convo.campaignId,
                adSetId: convo.adSetId,
                adId: convo.adId,
                city: convo.city,
                stateMx: convo.stateMx
              });
              responseText += `• ${option.sizeStr} por $${option.price}:\n${trackedLink}\n\n`;
            } else {
              responseText += `• ${option.sizeStr} por $${option.price}\n\n`;
            }
          }
        } else {
          // No standard sizes available - suggest custom fabrication
          responseText += `No tenemos medidas estándar que se ajusten exactamente.\n\n`;
        }

        // Always offer custom fabrication option
        const info = await getBusinessInfo();
        responseText += `\n📐 También fabricamos a la medida exacta (${dimensions.width}m x ${dimensions.height}m).\n`;
        responseText += `Para cotizar, contáctanos:\n📞 ${info?.phones?.[0] || '442-790-2000'}\n`;

        responseText += `\n💡 ¿Te sirve la medida estándar o prefieres cotizar fabricación a medida?`;

        // Update conversation state
        await updateConversation(psid, {
          lastIntent: "fractional_meters",
          unknownCount: 0,
          requestedSize: requestedSizeStr,
          lastUnavailableSize: requestedSizeStr,
          suggestedSizes: optionsToShow.map(o => o.sizeStr)
        });

        return {
          type: "text",
          text: responseText
        };
      }

      // If exact match, provide ML link immediately
      if (closest.exact) {
        const sizeVariants = [requestedSizeStr, requestedSizeStr + 'm'];

        // Add swapped dimensions
        const match = requestedSizeStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
        if (match) {
          const swapped = `${match[2]}x${match[1]}`;
          sizeVariants.push(swapped, swapped + 'm');
        }

        const product = await ProductFamily.findOne({
          size: { $in: sizeVariants },
          sellable: true,
          active: true
        });

        const productLink = getProductLink(product);
        if (productLink) {
          // Update conversation state with exact match
          await updateConversation(psid, {
            lastIntent: "specific_measure",
            unknownCount: 0,
            requestedSize: closest.exact.sizeStr,
            lastUnavailableSize: null
          });

          const trackedLink = await generateClickLink(psid, productLink, {
            productName: product.name,
            productId: product._id,
            campaignId: convo.campaignId,
            adSetId: convo.adSetId,
            adId: convo.adId,
            city: convo.city,
            stateMx: convo.stateMx
          });

          // 🎨 Check if user mentioned a color
          const hasColorMention = isColorQuery(msg);

          // Build warm response text
          const warmOpeners = [
            `¡Claro! 😊 De ${closest.exact.sizeStr} la tenemos en $${closest.exact.price}`,
            `¡Perfecto! La ${closest.exact.sizeStr} está disponible por $${closest.exact.price} 🌿`,
            `Con gusto 😊 La malla de ${closest.exact.sizeStr} la manejamos en $${closest.exact.price}`
          ];

          let responseText = warmOpeners[Math.floor(Math.random() * warmOpeners.length)];

          // Add color info if color was mentioned
          if (hasColorMention) {
            responseText += `\n\nActualmente solo manejamos color beige en malla confeccionada.`;
          }

          // Add shipping info if location mentioned or buying intent
          if (hasLocationMention || hasBuyingIntent) {
            responseText += `\n\nEnviamos a todo el país a través de Mercado Libre.`;
          }

          responseText += `\n\nTe paso el link para que la veas:\n\n${trackedLink}`;

          // Append location if also asked
          if (isAlsoAskingLocation(msg)) {
            responseText += getLocationAppendix();
          }

          return { type: "text", text: responseText };
        }
      }

      // 🔁 Check if user is repeating the same unavailable size request
      const currentRepeatCount = convo.oversizedRepeatCount || 0;

      if (isRepeated && currentRepeatCount >= 2) {
        // User has asked for this same oversized dimension 3+ times - hand off to human
        const info = await getBusinessInfo();

        await updateConversation(psid, {
          lastIntent: "human_handoff",
          state: "needs_human",
          handoffReason: "repeated_oversized_request",
          handoffTimestamp: new Date(),
          oversizedRepeatCount: 0  // Reset counter
        });

        return {
          type: "text",
          text: `Entiendo que necesitas específicamente una malla de ${requestedSizeStr}. 🤔\n\nPara poder ayudarte mejor con esta medida personalizada, te paso con nuestro equipo de ventas:\n\n📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n🕓 ${info?.hours || "Lun-Vie 9am-6pm"}\n\nEllos podrán cotizar la fabricación exacta de ${requestedSizeStr} y darte un presupuesto personalizado. 👍`
        };
      }

      // No exact match - generate response with alternatives
      const businessInfo = await getBusinessInfo();
      const sizeResponse = generateSizeResponse({
        smaller: closest.smaller,
        bigger: closest.bigger,
        exact: closest.exact,
        requestedDim: dimensions,
        availableSizes,
        isRepeated,
        businessInfo
      });

      // Handle custom order handoff (both sides >= 8m)
      if (sizeResponse.isCustomOrder && sizeResponse.requiresHandoff) {
        console.log(`🏭 Custom order detected (${dimensions.width}x${dimensions.height}m), triggering handoff`);

        await updateConversation(psid, {
          lastIntent: "custom_order_request",
          handoffRequested: true,
          handoffReason: `Custom order request: ${dimensions.width}x${dimensions.height}m - both sides >= 8m`,
          handoffTimestamp: new Date(),
          state: "needs_human",
          unknownCount: 0
        });

        // Send push notification
        sendHandoffNotification(psid, `Pedido especial: ${dimensions.width}x${dimensions.height}m - requiere cotización personalizada`).catch(err => {
          console.error("❌ Failed to send push notification:", err);
        });
      } else {
        // Update conversation state with suggested sizes for context
        await updateConversation(psid, {
          lastIntent: "specific_measure",
          unknownCount: 0,
          requestedSize: requestedSizeStr,
          lastUnavailableSize: closest.exact ? null : requestedSizeStr,
          oversizedRepeatCount: isRepeated ? currentRepeatCount + 1 : 0,  // Increment if repeated, reset if different size
          suggestedSizes: sizeResponse.suggestedSizes, // Save for follow-up questions
          offeredToShowAllSizes: sizeResponse.offeredToShowAllSizes || false
        });
      }

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

          const product = await ProductFamily.findOne({
            size: { $in: sizeVariants },
            sellable: true,
            active: true
          });

          if (product) {
            sizePrices.push({
              size: sizeStr,
              price: product.price,
              mLink: getProductLink(product)
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

        const product = await ProductFamily.findOne({
          size: { $in: sizeVariants },
          sellable: true,
          active: true
        });

        const productLink = getProductLink(product);
        if (productLink) {
          await updateConversation(psid, { lastIntent: "specific_measure_context", unknownCount: 0 });

          const trackedLink = await generateClickLink(psid, productLink, {
            productName: product.name,
            productId: product._id,
            campaignId: convo.campaignId,
            adSetId: convo.adSetId,
            adId: convo.adId,
            city: convo.city,
            stateMx: convo.stateMx
          });

          // Warm, friendly responses
          const warmResponses = [
            `¡Claro! 😊 La malla de ${requestedSizeStr} la tenemos disponible en $${product.price}\n\n` +
            `Te paso el link para que la veas:\n\n${trackedLink}`,

            `¡Perfecto! La tenemos en ${requestedSizeStr} por $${product.price} 🌿\n\n` +
            `Aquí está el enlace:\n\n${trackedLink}`,

            `Con gusto 😊 De ${requestedSizeStr} la manejamos en $${product.price}\n\n` +
            `Te dejo el link directo:\n\n${trackedLink}`
          ];

          return {
            type: "text",
            text: warmResponses[Math.floor(Math.random() * warmResponses.length)]
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
