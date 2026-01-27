// ai/global/intents.js
// ⚠️ MIGRATION IN PROGRESS: This file contains legacy regex-based intent handling.
// It is being replaced by ai/flows/* (product state machines) and ai/classifier/*
// (AI-based classification). This file remains as fallback during migration.
// See REFACTOR_PLAN.md for the migration plan.

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
  hasSuspiciousLargeDimension,
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
const { detectMexicanLocation, detectLocationEnhanced, isLikelyLocationName, detectZipCode } = require("../../mexicanLocations");
const { generateClickLink } = require("../../tracking");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { selectRelevantAsset, trackAssetMention, insertAssetIntoResponse } = require("../assetManager");
const { handleRollQuery } = require("../core/rollQuery");
const { getOfferHook, shouldMentionOffer, applyAdContext, getAngleMessaging } = require("../utils/adContextHelper");
const { isContextualMention, isExplicitProductRequest } = require("../utils/productMatcher");
const { getProductDisplayName, determineVerbosity, formatProductResponse } = require("../utils/productEnricher");

// Helper to add offer hook to responses when appropriate
function addOfferHookIfRelevant(responseText, convo) {
  if (!convo?.adContext || !shouldMentionOffer(convo.adContext, convo)) {
    return responseText;
  }

  const offerHook = getOfferHook(convo.adContext);
  if (!offerHook) return responseText;

  // Don't add if the offer is already mentioned in the response
  if (responseText.toLowerCase().includes(offerHook.toLowerCase())) {
    return responseText;
  }

  return `${responseText}\n\n🎁 ${offerHook}`;
}

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

  // ====== SKIP IF PENDING RECOMMENDATION ======
  // If we recommended a size and user is asking about it, let the flow system handle it
  // Patterns: "ese tamaño", "esa medida", "la que me dices", "cuánto cuesta", "qué precio"
  if (convo?.recommendedSize && convo?.lastIntent?.includes("awaiting_confirmation")) {
    const isReferringToRecommendation = /\b(es[ea]\s*(tamaño|medida)|la\s*que\s*(me\s*)?(dices|recomiendas)|cu[aá]nto\s*(cuesta|sale|es|vale)|qu[eé]\s*precio|ese|esa|la\s+de)\b/i.test(msg);
    if (isReferringToRecommendation) {
      console.log(`🔄 User referring to recommended size (${convo.recommendedSize}), deferring to flow system`);
      return null;
    }
  }
  // ====== END SKIP ======

  // Generate tracked store link once for reuse throughout this function
  const STORE_URL = "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
  const trackedStoreLink = await generateClickLink(psid, STORE_URL, {
    productName: "Tienda Hanlob",
    campaignId: convo.campaignId
  });

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
      text: "Disculpa la confusión. Te comunico con un especialista para ayudarte mejor.\n\n" +
            "En un momento te atienden."
    };
  }

  // 💰 PRICE CONFUSION - Customer confused about different prices shown
  // "y está de 650 es otra??", "por qué dice otro precio", "no es el mismo precio"
  const priceConfusionPatterns = /\b(es\s+otr[ao]|son\s+diferente|es\s+diferente|otro\s+precio|diferente\s+precio|por\s*qu[eé]\s+(dice|sale|aparece)\s+(otro|diferente)|no\s+(es\s+)?el\s+mismo\s+precio|cu[aá]l\s+es\s+el\s+(precio\s+)?correcto|me\s+(dijiste|dijeron)\s+(otro|diferente)|estaba\s+en\s+\d+|no\s+era\s+de\s+\d+)\b/i;

  if (priceConfusionPatterns.test(msg) ||
      (/\b(de\s+)?\d{3,4}\b/i.test(msg) && /\b(es\s+otr[ao]|otr[ao]\s*\??|es\s+diferente|diferente\s*\??)\b/i.test(msg))) {
    console.log("💰 Price confusion detected, escalating to human:", msg);
    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      priceConfusion: true
    });
    await sendHandoffNotification(psid, convo, "Cliente confundido por precios - verificar cotización");
    return {
      type: "text",
      text: "Disculpa la confusión con los precios. Te comunico con un especialista para verificar y darte el precio correcto.\n\n" +
            "En un momento te atienden."
    };
  }

  // 📦 OUT OF STOCK - Hand off to human when customer reports product is unavailable
  // This is critical: customer clicked a link and product shows as "agotado"
  const outOfStockPatterns = /\b(agotad[oa]s?|sin\s+stock|no\s+hay\s+(en\s+)?stock|no\s+tienen|no\s+est[aá]\s+disponible|producto\s+no\s+disponible|dice\s+(que\s+)?(no\s+hay|agotado)|sale\s+(que\s+)?(agotado|no\s+disponible)|aparece\s+(como\s+)?agotado|fuera\s+de\s+stock)\b/i;

  if (outOfStockPatterns.test(msg)) {
    console.log("📦 Out of stock reported by customer, escalating to human:", msg);
    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      outOfStockReported: true
    });
    await sendHandoffNotification(psid, convo, "Cliente reporta producto agotado - verificar inventario o link de ML");
    return {
      type: "text",
      text: "Gracias por avisarnos. Déjame verificar la disponibilidad con nuestro equipo.\n\n" +
            "En un momento te atienden para confirmar el stock."
    };
  }

  // 🔄 PRODUCT COMPARISON - "diferencia entre X y Y", "cual es mejor"
  // Handle questions comparing products (raschel vs monofilamento, etc.)
  const comparisonPatterns = /\b(diferencia|diferencias|distinto|distinta|comparar|comparaci[oó]n|vs|versus)\b.*\b(malla|raschel|monofilamento|beige|negro)/i;
  const whichIsBetterPattern = /\b(cu[aá]l|qu[eé])\s+(es\s+)?(mejor|conviene|recomienda|me\s+sirve)/i;

  if (comparisonPatterns.test(msg) ||
      (whichIsBetterPattern.test(msg) && /\b(malla|raschel|monofilamento|sombra)\b/i.test(msg))) {
    console.log("🔄 Product comparison question detected:", msg);

    // Load product descriptions from ProductSubfamily
    const ProductSubfamily = require("../../models/ProductSubfamily");
    const subfamilies = await ProductSubfamily.find({}).lean();

    const raschel = subfamilies.find(s => /malla\s*sombra|raschel|beige/i.test(s.name));
    const mono = subfamilies.find(s => /monofilamento/i.test(s.name));

    await updateConversation(psid, { lastIntent: "product_comparison" });

    // Build comparison response using available data
    let response = "**Raschel (Malla Sombra tradicional):**\n";
    response += raschel?.description || "Tejido raschel, permeable, varios colores disponibles.";
    response += "\n\n**Monofilamento:**\n";
    response += mono?.description || "Más resistente y duradera, ideal para uso intensivo.";
    response += "\n\n";

    // Add recommendation based on common use cases
    response += "**¿Cuál elegir?**\n";
    response += "• Raschel: Mejor relación precio-calidad, ideal para casas, patios y jardines.\n";
    response += "• Monofilamento: Mayor durabilidad, recomendada para uso comercial o agrícola intensivo.\n\n";
    response += "¿Para qué uso la necesitas?";

    return {
      type: "text",
      text: response
    };
  }

  // 🌿 BORDE SEPARADOR - Garden edging product (different from malla sombra!)
  // Detect: "borde", "separador", "borde separador", "orilla de jardín", "delimitar jardín"
  // Also detect borde-specific lengths: 6m, 9m, 18m, 54m (malla sombra uses 100m rolls)
  const bordeSeparadorPattern = /\b(borde|separador|bordes?|delineador|delimitar|orilla)\s*(de\s+)?(jard[ií]n|pasto|c[eé]sped)?/i;

  // Detect borde-specific lengths in rollo context (6, 9, 18, 54 meters are ONLY for borde separador)
  const bordeLengthPattern = /\b(rol+[oy]s?|metros?|mts?)\b.*\b(6|9|18|54)\s*(m|metros?|mts?)?\b|\b(6|9|18|54)\s*(m|metros?|mts?)\b.*\b(rol+[oy]s?)\b/i;
  const isBordeByLength = bordeLengthPattern.test(msg) && !/\b(100|4x100|5x100|6x100)\b/i.test(msg);

  if (bordeSeparadorPattern.test(msg) || convo.productInterest === 'borde_separador' || isBordeByLength) {
    console.log("🌿 Borde separador query detected:", msg);
    await updateConversation(psid, { lastIntent: "borde_separador", productInterest: "borde_separador" });

    // ML links for borde separador products
    const bordeLinks = {
      '6': 'https://articulo.mercadolibre.com.mx/MLM-923085679-borde-separador-grueso-para-jardin-rollo-de-6-metros-_JM',
      '9': 'https://articulo.mercadolibre.com.mx/MLM-923081079-borde-separador-grueso-para-jardin-rollo-de-9-metros-_JM',
      '18': 'https://articulo.mercadolibre.com.mx/MLM-801430874-borde-separador-grueso-para-jardin-rollo-de-18-metros-_JM',
      '54': 'https://articulo.mercadolibre.com.mx/MLM-1493170566-borde-separador-para-jardin-rollo-de-54-m-_JM'
    };

    // Check if user already specified a borde length (6, 9, 18, or 54m)
    const lengthMatch = msg.match(/\b(6|9|18|54)\s*(m|metros?|mts?)?\b/i);
    if (lengthMatch) {
      const length = lengthMatch[1];
      const link = bordeLinks[length];

      if (link) {
        // Extract quantity if mentioned (e.g., "6 rollos de 54m")
        const quantityMatch = msg.match(/(\d+)\s*(rol+[oy]s?|piezas?|unidades?)/i);
        const quantity = quantityMatch ? parseInt(quantityMatch[1]) : null;

        // Store city if mentioned (e.g., "en león")
        const cityMatch = msg.match(/\ben\s+([a-záéíóúñ]+)/i);
        if (cityMatch) {
          await updateConversation(psid, { city: cityMatch[1] });
        }

        const trackedLink = await generateClickLink(psid, link, {
          productName: `Borde Separador ${length}m`,
          city: convo.city || cityMatch?.[1],
          stateMx: convo.stateMx
        });

        await updateConversation(psid, { lastIntent: "borde_link_sent" });

        const quantityText = quantity ? `Para ${quantity} rollos, ` : '';
        return {
          type: "text",
          text: `¡Claro! ${quantityText}aquí está el borde separador de ${length} metros:\n\n${trackedLink}\n\n` +
                `Ahí puedes ver el precio y realizar tu compra. El envío está incluido 📦`
        };
      }
    }

    // Check for installation questions - "con qué se sujeta", "cómo se instala", etc.
    if (/\b(sujet|ancl|clav|instala|pone|fij|asegur|enterr)/i.test(msg) &&
        /\b(suelo|tierra|piso|c[oó]mo|con\s+qu[eé])\b/i.test(msg)) {
      return {
        type: "text",
        text: "El borde separador se sujeta al suelo con estacas de jardín, que se consiguen en cualquier ferretería o vivero 🌱\n\n" +
              "¿Te interesa algún largo? Tenemos 6m, 9m, 18m y 54m."
      };
    }

    // Check for price/availability questions without specific length
    if (/\b(precio|cu[aá]nto|cuesta|costo|vale|ocupo|necesito|quiero)\b/i.test(msg)) {
      return {
        type: "text",
        text: "¡Claro! Manejamos borde separador para jardín en diferentes presentaciones:\n\n" +
              "• Rollo de 6 metros\n" +
              "• Rollo de 9 metros\n" +
              "• Rollo de 18 metros\n" +
              "• Rollo de 54 metros\n\n" +
              "¿Qué largo necesitas? Te paso el link con precio."
      };
    }

    // General borde separador inquiry
    return {
      type: "text",
      text: "¡Hola! Sí manejamos borde separador para jardín 🌿\n\n" +
            "Sirve para delimitar áreas de pasto, crear caminos y separar zonas de tu jardín.\n\n" +
            "Tenemos rollos de 6m, 9m, 18m y 54m.\n\n" +
            "¿Qué largo te interesa?"
    };
  }

  // 🌿 BORDE SEPARADOR FOLLOW-UP - Handle questions when in borde context
  if (convo.lastIntent === "borde_separador" || convo.productInterest === "borde_separador" ||
      convo.lastIntent === "borde_link_sent") {

    // Installation question - "con qué se sujeta", "cómo se instala", etc.
    if (/\b(sujet|ancl|clav|instala|pone|fij|asegur|enterr)/i.test(msg) ||
        /\bc[oó]mo\s+(se\s+)?(pone|coloca|usa)/i.test(msg) ||
        /\bcon\s+qu[eé]\b/i.test(msg)) {
      return {
        type: "text",
        text: "El borde separador se sujeta al suelo con estacas de jardín, que se consiguen en cualquier ferretería o vivero 🌱\n\n" +
              "¿Te interesa algún largo? Tenemos 6m, 9m, 18m y 54m."
      };
    }

    // User specifies length
    const lengthMatch = msg.match(/\b(6|9|18|54)\s*(m|metros?|mts?)?\b/i);
    if (lengthMatch) {
      const length = lengthMatch[1];
      console.log(`🌿 Borde separador length selected: ${length}m`);

      // ML links for borde separador products
      const bordeLinks = {
        '6': 'https://articulo.mercadolibre.com.mx/MLM-923085679-borde-separador-grueso-para-jardin-rollo-de-6-metros-_JM',
        '9': 'https://articulo.mercadolibre.com.mx/MLM-923081079-borde-separador-grueso-para-jardin-rollo-de-9-metros-_JM',
        '18': 'https://articulo.mercadolibre.com.mx/MLM-801430874-borde-separador-grueso-para-jardin-rollo-de-18-metros-_JM',
        '54': 'https://articulo.mercadolibre.com.mx/MLM-1493170566-borde-separador-para-jardin-rollo-de-54-m-_JM'
      };

      const link = bordeLinks[length];
      if (link) {
        const trackedLink = await generateClickLink(psid, link, {
          productName: `Borde Separador ${length}m`,
          city: convo.city,
          stateMx: convo.stateMx
        });

        await updateConversation(psid, { lastIntent: "borde_link_sent" });

        return {
          type: "text",
          text: `¡Perfecto! Aquí está el borde separador de ${length} metros:\n\n${trackedLink}\n\n` +
                `Ahí puedes ver el precio, fotos y realizar tu compra con envío incluido 📦`
        };
      }
    }
  }

  // 📦 ROLL QUERIES - Handle roll questions directly before other handlers
  // "cuánto cuesta el rollo", "precio del rollo", "rollo de 50%", etc.
  // Also handles follow-up messages when user is already in a roll flow
  const isRollMention = /\b(rol+[oy]s?)\b/i.test(msg);
  const isInRollFlow = convo.productSpecs?.productType === 'rollo' && convo.lastIntent?.startsWith('roll_');

  if (isRollMention || isInRollFlow) {
    console.log(isInRollFlow
      ? "📦 In roll flow, routing to roll handler"
      : "📦 Roll query detected in global intents, calling roll handler");
    const rollResponse = await handleRollQuery(msg, psid, convo);
    if (rollResponse) return rollResponse;
    // If roll handler returns null, continue to other handlers
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

  // 🔄 FOLLOW-UP: Handle responses to dimension clarification (380 → 3.80?)
  if (convo.lastIntent === "dimension_clarification_pending" && convo.suspiciousDimension) {
    const suspicious = convo.suspiciousDimension;
    const pendingDims = convo.pendingDimensions;

    // Check if user confirmed the corrected dimension (3.80)
    const confirmsCorrection = /\b(s[ií]|correcto|exacto|eso|as[ií]|afirmativo)\b/i.test(msg) ||
                               new RegExp(`\\b${suspicious.corrected}\\b`).test(msg);

    // Check if user insists on the large number
    const confirmsLarge = /\b(no|metros?|realmente|grande|completo)\b/i.test(msg) &&
                          new RegExp(`\\b${suspicious.original}\\b`).test(msg);

    if (confirmsCorrection) {
      // User meant the decimal version (e.g., 3.80m not 380m)
      console.log(`✅ User confirmed corrected dimension: ${suspicious.corrected}m`);

      // Create corrected dimensions
      const correctedDims = suspicious.dimension === 'width'
        ? { width: suspicious.corrected, height: pendingDims.height, area: suspicious.corrected * pendingDims.height }
        : { width: pendingDims.width, height: suspicious.corrected, area: pendingDims.width * suspicious.corrected };

      const correctedSizeStr = `${correctedDims.width}x${correctedDims.height}`;

      // Clear pending state and process with corrected dimensions
      await updateConversation(psid, {
        lastIntent: "specific_measure",
        pendingDimensions: null,
        suspiciousDimension: null,
        requestedSize: correctedSizeStr,
        unknownCount: 0
      });

      // Now find closest sizes for the corrected dimensions
      const availableSizes = await getAvailableSizes(convo);
      const closest = findClosestSizes(correctedDims, availableSizes);
      const businessInfo = await getBusinessInfo();

      const sizeResponse = generateSizeResponse({
        smaller: closest.smaller,
        bigger: closest.bigger,
        exact: closest.exact,
        requestedDim: correctedDims,
        availableSizes,
        isRepeated: false,
        businessInfo
      });

      return { type: "text", text: sizeResponse.text };
    } else if (confirmsLarge) {
      // User really wants the large dimension - let them continue
      console.log(`✅ User confirmed large dimension: ${suspicious.original}m`);
      await updateConversation(psid, {
        lastIntent: "dimension_clarification_confirmed",
        pendingDimensions: null,
        suspiciousDimension: null,
        unknownCount: 0
      });
      // Continue to normal dimension handling below
    } else {
      // Unclear response - ask again
      const correctedSize = suspicious.dimension === 'width'
        ? `${suspicious.corrected}x${pendingDims.height}`
        : `${pendingDims.width}x${suspicious.corrected}`;

      return {
        type: "text",
        text: `Disculpa, no entendí. ¿Necesitas ${suspicious.corrected} metros (${correctedSize}m) o ${suspicious.original} metros?`
      };
    }
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
           .replace(/\broyo\b/gi, 'rollo')
           .replace(/\bm[we]rcado\s*libre\b/gi, 'mercado libre')
           .replace(/\bmercadolibre\b/gi, 'mercado libre');

  // 🏪 MERCADO LIBRE STORE LINK - Handle requests to see the online store
  // Also handles "tienes mercado libre?" type questions
  if (/\b(ver|visitar|ir a|mostrar|enviar|dar|darme|dame|quiero)\s+(la\s+)?(tienda|catalogo|cat[aá]logo)\b/i.test(msg) ||
      /\b(tienda\s+(en\s+l[ií]nea|online|virtual|mercado\s+libre))\b/i.test(msg) ||
      /\b(link|enlace)\s+(de\s+)?(la\s+)?(tienda|catalogo)\b/i.test(msg) ||
      /\b(tienes?|tienen?|venden?|est[aá]n?)\s+(en\s+|por\s+)?mercado\s*libre\b/i.test(msg)) {

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

    const baseResponse = "Ver tienda en línea\nIngresa al siguiente link:\n\n" +
          trackedLink + "\n\n" +
          "Estamos disponibles para ayudarte con cualquier duda sobre nuestros productos.";

    return {
      type: "text",
      text: addOfferHookIfRelevant(baseResponse, convo)
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
            text: `Para este producto, uno de nuestros especialistas se pondrá en contacto contigo para explicarte el proceso de compra personalizado y resolver todas tus dudas.\n\n` +
                  `Este tipo de producto requiere asesoría especializada para asegurarnos de ofrecerte la mejor solución. ¿Te conecto con un especialista?`
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
  // BUT only if it's an explicit request, not a contextual mention
  // e.g., "quiero malla antimaleza" = product request
  // e.g., "90% para que no salga maleza" = contextual, user wants malla sombra
  if (isWeedControlQuery(msg)) {
    // Check if "maleza" is just contextual (explaining why they want malla sombra)
    const isJustContext = isContextualMention(msg, "maleza");
    const isExplicitRequest = isExplicitProductRequest(msg, "antimaleza") ||
                              isExplicitProductRequest(msg, "ground cover") ||
                              /\b(quiero|necesito|busco|ocupo)\s+(malla\s+)?(antimaleza|ground\s*cover)/i.test(msg);

    // Skip if contextual and not explicit request
    if (isJustContext && !isExplicitRequest) {
      console.log("🌿 Skipping weed control - contextual mention, not product request");
      // Don't handle - let other handlers process (e.g., malla sombra 90%)
    } else {
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
      response += trackedStoreLink + "\n\n";
      response += "¿Qué medida necesitas para tu proyecto?";

      return {
        type: "text",
        text: response
      };
    }
  }

  // 🌧️ RAIN/WATERPROOF QUESTIONS - Clarify malla sombra is NOT waterproof
  // First check if "agua" appears in a location context (e.g., "Agua Prieta")
  const hasWaterKeyword = /\b(lluvia|lluvias|llueve|agua|mojarse|mojar|impermeable|impermeabiliza|protege\s+de(l)?\s+(agua|lluvia)|cubre\s+de(l)?\s+(agua|lluvia)|sirve\s+(para|contra)\s+(la\s+)?(lluvia|agua)|tapa\s+(la\s+)?(lluvia|agua)|repele|repelente)\b/i.test(msg);
  const isLocationContext = /\b(vivo\s+en|soy\s+de|estoy\s+en|est[aá]\s+en|ubicad[oa]\s+en|me\s+encuentro\s+en|mando\s+a|env[ií]o\s+a|entregar?\s+en)\b/i.test(msg);
  const detectedLocation = await detectLocationEnhanced(msg);

  if (hasWaterKeyword && !isLocationContext && !detectedLocation &&
      !/\b(antimaleza|ground\s*cover|gran\s*cover|maleza|hierba)\b/i.test(msg)) {

    // Check if we'd be repeating the same response - escalate to human instead
    if (convo.lastIntent === "rain_waterproof_question") {
      console.log("🔄 Would repeat waterproof response, escalating to human");
      await updateConversation(psid, { lastIntent: "human_handoff", state: "needs_human" });
      await sendHandoffNotification(psid, convo, "Cliente necesita atención - posible malentendido sobre impermeabilidad");
      return {
        type: "text",
        text: "Parece que hay algo que no estoy entendiendo bien. Déjame contactar a un especialista para que te ayude mejor.\n\n" +
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
    const locationUpdate = {
      lastIntent: "location_mentioned",
      city: detectedLocation.normalized,
      unknownCount: 0
    };
    if (detectedLocation.type === 'state') locationUpdate.stateMx = detectedLocation.normalized;
    await updateConversation(psid, locationUpdate);

    return {
      type: "text",
      text: `¡Sí! Enviamos a ${detectedLocation.normalized} a través de Mercado Libre 📦\n\n` +
            `¿Qué medida de malla sombra necesitas?`
    };
  }

  // 📍 LOCATION-ONLY MESSAGE - User just says a location name (possibly with "En" prefix)
  // Examples: "En Xalapa Veracruz", "Monterrey", "Jalisco", "En CDMX", or zipcode "76137"
  // Responds with nationwide shipping info
  const locationOnlyPattern = /^(en\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñ\s,0-9]+)$/i;
  const locationOnlyMatch = msg.trim().match(locationOnlyPattern);
  if (locationOnlyMatch && !isLocationContext) {
    const potentialLocation = locationOnlyMatch[2] || locationOnlyMatch[0];
    const locationDetected = await detectLocationEnhanced(potentialLocation);

    if (locationDetected && (isLikelyLocationName(msg) || locationDetected.type === 'zipcode')) {
      console.log("📍 Location detected:", locationDetected.normalized, locationDetected.type === 'zipcode' ? `(CP: ${locationDetected.code})` : '');

      const locationUpdate = {
        lastIntent: "location_only_mentioned",
        city: locationDetected.location || locationDetected.normalized,
        unknownCount: 0
      };
      if (locationDetected.state) locationUpdate.stateMx = locationDetected.state;
      if (locationDetected.code) locationUpdate.zipcode = locationDetected.code;
      await updateConversation(psid, locationUpdate);

      return {
        type: "text",
        text: `¡Sí! Enviamos a ${locationDetected.normalized} y a todo el país a través de Mercado Libre 📦\n\n` +
              `¿Qué medida necesitas?`
      };
    }
  }

  // ☀️ SHADE PERCENTAGE QUESTIONS - Explain available shade percentages
  if (/\b(qu[eé]\s+)?porcenta?je[s]?\s+(de\s+)?(sombra|tiene[ns]?|manejan?|hay)?\b/i.test(msg) ||
      /\b(qu[eé]\s+)?(sombra|porcentaje)[s]?\s+(tiene[ns]?|manejan?|hay|ofrece[ns]?)\b/i.test(msg) ||
      /\b(cu[aá]nta?\s+sombra|nivel\s+de\s+sombra|grado\s+de\s+sombra)\b/i.test(msg) ||
      /\b(diferencia|diferencias)\s+(entre|de)\s+(los\s+)?porcentajes?\b/i.test(msg)) {

    await updateConversation(psid, { lastIntent: "shade_percentage_question" });

    return {
      type: "text",
      text: "Manejamos malla sombra desde 35% (sombra ligera) hasta 90% (máxima protección).\n\n" +
            "El más popular es el 80%, ofrece buena sombra sin oscurecer demasiado.\n\n" +
            "¿Qué porcentaje te interesa?"
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
              "Para cotizar rollos, comunícate directamente con uno de nuestros especialistas:\n\n" +
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

  // 💰 SIMPLE PRICE QUERY - "Precio!", "Precio?", "Precio", "Costo"
  // This is a standalone intent - user is asking for pricing without specifying product
  // Route based on their existing product interest, or ask what they need
  const isSimplePriceQuery = /^precio[s]?[!?]*$/i.test(msg.trim()) || /^costo[s]?[!?]*$/i.test(msg.trim());

  if (isSimplePriceQuery) {
    console.log("💰 Simple price intent detected:", msg);

    // Route based on existing product interest
    if (convo.productInterest === 'borde_separador') {
      console.log("💰 → Routing to borde separador (existing interest)");
      await updateConversation(psid, { lastIntent: "price_query_borde" });
      return {
        type: "text",
        text: "¡Claro! Manejamos borde separador para jardín en diferentes presentaciones:\n\n" +
              "• Rollo de 6 metros\n" +
              "• Rollo de 9 metros\n" +
              "• Rollo de 18 metros\n" +
              "• Rollo de 54 metros\n\n" +
              "¿Qué largo necesitas? Te paso el link con precio."
      };
    }

    if (convo.productInterest === 'rollo' || convo.productSpecs?.productType === 'rollo') {
      console.log("💰 → Routing to roll handler (existing interest)");
      await updateConversation(psid, { lastIntent: "price_query_rollo" });
      return await handleRollQuery(msg, psid, convo);
    }

    // Default: malla sombra confeccionada
    console.log("💰 → Default to malla sombra (no specific interest)");
    await updateConversation(psid, { lastIntent: "price_query_general" });
    return {
      type: "text",
      text: "Tenemos mallas sombra beige en varias medidas, desde 2x2m hasta 6x10m, y también rollos de 100m.\n\n" +
            "Para darte el precio exacto, ¿qué medida necesitas para tu proyecto? 📐"
    };
  }

  // 📋 CATALOG REQUEST - Handle requests for general pricing, sizes, and colors listing
  // Instead of dumping a huge list, ask for specific dimensions
  // NOTE: "precios y medidas" is handled by EXPLICIT LIST REQUEST below to show the full list
  if (/\b(pongan?|den|muestren?|env[ií]en?|pasame?|pasen?|listado?)\s+(de\s+)?(precios?|medidas?|opciones?|tama[ñn]os?|colores?)\b/i.test(msg) ||
      /\b(hacer\s+presupuesto|cotizaci[oó]n|cotizar)\b/i.test(msg) ||
      /\b(opciones?\s+disponibles?)\b/i.test(msg) ||
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
  // Also catches: "qué medidas tienen", "que tamaños manejan", "cuánto cuesta y que medidas tienen", "precios y medidas"
  if (/\b(d[ií]game|mu[eé]str[ea]me|ens[eé][ñn]ame|ver|quiero\s+ver|dame)\s+(l[oa]s\s+)?(medidas|opciones|lista|precios|tama[ñn]os)/i.test(msg) ||
      /\b(todas?\s+las?\s+medidas?|todas?\s+las?\s+opciones?|lista\s+completa|ver\s+(la\s+)?lista)\b/i.test(msg) ||
      /\b(usted\s+d[ií]game|dime\s+t[uú]|d[ií]ganme)\b/i.test(msg) ||
      /\b(s[ií].*mu[eé]str[ea]me|s[ií].*ver\s+la\s+lista|s[ií].*las\s+opciones)\b/i.test(msg) ||
      /\bqu[eé]\s+(medidas|tama[ñn]os|opciones)\s+(tienen|manejan|hay|venden|ofrecen)\b/i.test(msg) ||
      /\b(cu[aá]nto|precio).*\by\s+qu[eé]?\s+(medidas|tama[ñn]os)\b/i.test(msg) ||
      /\b(precios?\s+y\s+medidas?|medidas?\s+y\s+precios?)\b/i.test(msg) ||
      /\b(qu[eé]\s+tienen|todo\s+lo\s+que\s+tienen)\b/i.test(msg)) {

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

      return { type: "text", text: addOfferHookIfRelevant(response, convo) };
    }

    // Fallback if no sizes loaded
    return {
      type: "text",
      text: "Puedes ver todas nuestras medidas y precios en la Tienda Oficial:\n" +
            trackedStoreLink + "\n\n" +
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
        text: "Como te comenté, para cotizaciones de volumen necesitas comunicarte con nuestros especialistas:\n\n" +
              `💬 WhatsApp: ${whatsappLink}\n` +
              `📞 ${info?.phones?.join(" / ") || "Teléfono no disponible"}\n\n` +
              "Ellos podrán darte el precio exacto para la cantidad que necesitas."
      };
    }

    await updateConversation(psid, { lastIntent: "bulk_discount_inquiry", state: "needs_human" });

    return {
      type: "text",
      text: "Los descuentos por volumen aplican para pedidos desde $20,000 MXN en adelante.\n\n" +
            "Para cotizar tu pedido y conocer los descuentos disponibles, te comunico con uno de nuestros especialistas:\n\n" +
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
    // BUT skip if message contains specific product keywords like "rollo" - let those handlers process it
    const hasSpecificProduct = /\b(rol+[oy]s?|borde|separador|\d+\.?\d*\s*[xX×]\s*\d+)\b/i.test(msg);

    if (isInterested && !convo.lastIntent && !hasSpecificProduct) {
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
      response += trackedStoreLink + "\n\n";
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

        const baseResponse = `Te dejo el link a esa medida específica:\n\n` +
              `${trackedLink}\n\n` +
              `Estamos disponibles para cualquier información adicional.`;

        return {
          type: "text",
          text: addOfferHookIfRelevant(baseResponse, convo)
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

  // 📍 Ubicación - respond with simple location info
  // Note: "ciudad" removed - too broad, matches "Ciudad de México" when user answers where they're from
  if (/d[oó]nde\s+(est[aá]n|se\s+ubican|quedan)|h?ubicaci[oó]n|direcci[oó]n|qued[ao]n?|encuentran/i.test(msg)) {
    console.log("📍 Location question detected");
    await updateConversation(psid, { lastIntent: "location_info" });
    return {
      type: "text",
      text: "Estamos en Querétaro, pero enviamos a todo el país por Mercado Libre 📦"
    };
  }

  // 🛒 WHERE TO BUY + MEASUREMENTS - "a donde puedo ir para comprar y darle las medidas"
  // User wants to know where to buy AND wants to provide measurements
  if (/\b(donde|d[oó]nde|a\s+donde)\s+(puedo|puede)\s+(ir\s+)?(para\s+)?(comprar|pedir)/i.test(msg) &&
      /\b(medidas?|tama[ñn]os?|darle|decirle)\b/i.test(msg)) {
    console.log("🛒 Where to buy + measurements question detected");
    await updateConversation(psid, { lastIntent: "where_to_buy_with_measures" });

    return {
      type: "text",
      text: "Puedes comprar en nuestra tienda digital en Mercado Libre 🛒\n\n" +
            trackedStoreLink + "\n\n" +
            "¿Qué medida necesitas? 📐"
    };
  }

  // 🏪 RETAIL SALES / STORE VISIT - "venta al público", "si voy a Querétaro", "puedo ir/pasar"
  if (/\b(venta\s+al\s+p[uú]blico|venden\s+al\s+p[uú]blico|atienden\s+al\s+p[uú]blico)\b/i.test(msg) ||
      /\b(si\s+voy|puedo\s+ir|puedo\s+pasar|paso\s+a|pasar\s+a\s+comprar|comprar\s+en\s+persona|comprar\s+directo|recoger\s+en)\b/i.test(msg) ||
      /\b(tienen\s+tienda|hay\s+tienda|tienda\s+f[ií]sica|local\s+f[ií]sico|showroom)\b/i.test(msg)) {
    const businessInfo = await getBusinessInfo();
    console.log("🏪 Store visit / retail sales question detected");
    await updateConversation(psid, { lastIntent: "store_visit" });

    return {
      type: "text",
      text: `¡Sí! Tenemos venta al público en nuestra bodega en Querétaro 🏪\n\n` +
            `📍 ${businessInfo.address}\n` +
            `📞 ${businessInfo.phones.join(" / ")}\n` +
            `🕓 ${businessInfo.hours}\n\n` +
            `Puedes venir a ver el producto y pagar en efectivo o con tarjeta. ¿Qué medida te interesa?`
    };
  }

  // 🏗️ STRUCTURE FABRICATION - We only make the mesh, not the structure
  // "ustedes realizan la estructura", "hacen la estructura", "venden estructura"
  if (/\b(realizan|hacen|fabrican|venden|tienen|ofrecen|instalan)\s+(la\s+)?estructura/i.test(msg) ||
      /\b(estructura\s+(met[aá]lica|de\s+metal|de\s+fierro|de\s+tubo))\b/i.test(msg) ||
      /\b(incluye|viene\s+con|trae)\s+(la\s+)?estructura\b/i.test(msg)) {
    console.log("🏗️ Structure fabrication question detected");
    await updateConversation(psid, { lastIntent: "structure_question" });
    return {
      type: "text",
      text: "No, mil disculpas, nosotros solo realizamos la fabricación de la malla 🌿\n\n" +
            "No vendemos ni instalamos estructuras.\n\n" +
            "¿Te puedo ayudar con alguna medida de malla?"
    };
  }

  // 🔧 Measurement/Installation services - We don't offer these
  // Patterns: poner postes, instalar, colocar, medir, etc.
  const installationPattern =
    /\b(venir\s+a\s+medir|pasan\s+a\s+medir|van\s+a\s+medir|pueden\s+medir|podr[ií]an\s+(venir|pasar)\s+(a\s+)?medir)\b/i.test(msg) ||
    /\b(mandan\s+a\s+alguien|env[ií]an\s+a\s+alguien)\b/i.test(msg) ||
    /\b(hacen\s+instalaci[oó]n|instalan|colocan|ponen\s+la\s+malla)\b/i.test(msg) ||
    /\b(servicio\s+de\s+(instalaci[oó]n|medici[oó]n|colocaci[oó]n))\b/i.test(msg) ||
    /\b(instalador|quien\s+(la\s+)?instale|quien\s+(la\s+)?coloque)\b/i.test(msg) ||
    // NEW: posts/structure installation
    /\b(poner|instalar|colocar)\s+(los\s+)?(postes?|tubos?|estructura)\b/i.test(msg) ||
    /\bquien\s+(pueda\s+)?(poner|instalar|colocar|armar)\b/i.test(msg) ||
    /\b(tienen|hay)\s+quien\s+(ponga|instale|coloque|arme)\b/i.test(msg);

  if (installationPattern) {
    console.log("🔧 Measurement/installation service request detected");
    await updateConversation(psid, { lastIntent: "service_request" });
    return {
      type: "text",
      text: "No, mil disculpas, en Hanlob no proveemos servicios de instalación 🔧\n\n" +
            "Solo vendemos la malla sombra y la enviamos a tu domicilio.\n\n" +
            "¿Ya tienes la medida que necesitas?"
    };
  }

  // 💰 Where to pay/deposit - Direct ML payment answer
  // Patterns: donde deposito, donde pago, onde te mando $$, pago al entregar, hasta que llegue
  const payOnDeliveryPattern = /\b(pago|deposito)\s+(al\s+entregar|contra\s+entrega)\b/i.test(msg) ||
                               /\b(hasta\s+que\s+llegue|cuando\s+llegue\s+pago|pago\s+cuando\s+llegue)\b/i.test(msg);
  const whereToPayPattern = /\b(d[oó]nde|donde|onde|a\s+d[oó]nde)\s+(deposito|pago|se\s+paga|se\s+deposita|hago\s+el\s+pago|realizo\s+el\s+pago|te\s+mando|mando)\b/i.test(msg) ||
                            /\b(donde|onde)\s+(te\s+)?(mando|envio|transfiero)\s*(\$|\$\$|dinero|lana|pago)\b/i.test(msg);

  if (whereToPayPattern || payOnDeliveryPattern) {
    await updateConversation(psid, { lastIntent: "payment_location" });

    // Different response if asking about pay-on-delivery
    if (payOnDeliveryPattern) {
      return {
        type: "text",
        text: "El pago es 100% POR ADELANTADO en Mercado Libre al momento de hacer tu pedido.\n\n" +
              "❌ No manejamos pago contra entrega.\n\n" +
              "Aceptan tarjeta, efectivo en OXXO, o meses sin intereses. ¿Te paso el link para que puedas hacer tu pedido?"
      };
    }

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
  if (/cu[aá]ntos?\s+d[ií]as|cu[aá]nto\s+tiempo|cuando\s+llega|en\s+cu[aá]nto\s+llega|tiempo\s+de\s+entrega|tarda|demora|anticipo|pago\s+contra\s+entrega|forma\s+de\s+pago|c[oó]mo\s+pag/i.test(msg)) {
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

  // 💰 PRICE INCLUDES SHIPPING? - Quick answer for "ya incluye envío/entrega?" follow-ups
  // This catches: "el precio incluye envío", "ya con entrega incluida?", "incluye el flete?", etc.
  const priceIncludesShippingPattern = /\b(precio|costo)\s+(es\s+)?(ya\s+)?(incluye|con|tiene)\s+(el\s+|la\s+)?(env[ií]o|entrega|flete)|ya\s+(incluye|con)\s+(el\s+|la\s+)?(env[ií]o|entrega|flete)|incluye\s+(el\s+|la\s+)?(env[ií]o|entrega|flete)|con\s+(el\s+|la\s+)?(entrega|env[ií]o)\s+(ya\s+)?incluid[ao]|es\s+con\s+entrega|(env[ií]o|entrega|flete)\s+(ya\s+)?incluid[ao]/i;

  if (priceIncludesShippingPattern.test(msg)) {
    console.log("💰 Price includes shipping question detected:", msg);
    await updateConversation(psid, { lastIntent: "shipping_included_confirmation" });
    return {
      type: "text",
      text: "¡Sí! El envío está incluido en el precio o se calcula automáticamente en Mercado Libre dependiendo de tu ubicación.\n\nEn la mayoría de los casos el envío es gratis. 🚚"
    };
  }

  // 🚚 Envíos / entregas
  // Skip if it's a THANK YOU for shipping (not a question about shipping)
  const isThankingForShipping = /\b(gracias|grax|thx|thanks)\s+(por\s+)?(el\s+|la\s+)?(env[ií]o|entrega|paquete)/i.test(msg);
  // Also catch "mandar a mi lugar/estado", "pueden mandar", etc.
  const isAskingAboutShipping = /env[ií]o|entregan|domicilio|reparto|llega|envias?|envian|paquete/i.test(msg) ||
                                /\b(mand[ae]n?|pueden?\s+mandar)\s*(a\s+)?(mi\s+)?(lugar|estado|ciudad|domicilio)/i.test(msg) ||
                                /\bmandar\s+(lugar|estado)\b/i.test(msg);

  if (isAskingAboutShipping && !isThankingForShipping) {
    // Check if message also contains dimensions - if so, skip shipping handler and let dimension handler process it
    const dimensions = parseDimensions(msg);
    if (dimensions) {
      // Let the dimension handler below deal with this - it will include shipping info
      // Don't return here, continue to dimension handler
    } else {
      // Detect and store city if mentioned (e.g., "Envían a Hermosillo?" or "Envían a 76137?")
      const shippingLocation = await detectLocationEnhanced(msg);
      if (shippingLocation) {
        const cityUpdate = {};

        // Store city vs state appropriately based on location type
        if (shippingLocation.type === 'state') {
          // User mentioned a state (e.g., "Jalisco") - store as state, not city
          cityUpdate.stateMx = shippingLocation.normalized || shippingLocation.location;
        } else if (shippingLocation.type === 'city' || shippingLocation.type === 'zipcode') {
          // User mentioned a city or zipcode - we have actual city data
          cityUpdate.city = shippingLocation.location || shippingLocation.normalized;
          if (shippingLocation.state) cityUpdate.stateMx = shippingLocation.state;
        } else {
          // Fallback - store as city
          cityUpdate.city = shippingLocation.normalized;
          if (shippingLocation.state) cityUpdate.stateMx = shippingLocation.state;
        }

        if (shippingLocation.code) cityUpdate.zipcode = shippingLocation.code;
        await updateConversation(psid, cityUpdate);
        console.log(`📍 Location detected (${shippingLocation.type}): ${JSON.stringify(cityUpdate)}`);
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
          text: addOfferHookIfRelevant(responseText, convo)
        };
      }
    }

      // Shipping rules response
      let responseText;
      // Check if user is interested in rolls/wholesale (human sale products)
      const isRollInterest = convo.productInterest === 'rollo' || convo.lastIntent?.includes('roll') || /\b(rol+[oy]|mayoreo|monofilamento)\b/i.test(msg);

      if (isRollInterest) {
        // Rolls and wholesale need zip code for custom shipping quote
        responseText = `Enviamos a todo el país 📦\n\nPara rollos de malla sombra, monofilamento y pedidos de mayoreo, necesitamos tu código postal para calcular el envío.\n\n¿Me lo compartes?`;
        await updateConversation(psid, { lastIntent: "awaiting_zipcode" });
      } else if (!convo.city && !convo.stateMx && !convo.zipcode) {
        // General shipping info
        responseText = `Enviamos a todo el país 📦\n\nEn rollos de malla sombra, monofilamento y pedidos de mayoreo, necesitamos tu código postal para calcular el envío.\n\nEn todos nuestros demás productos, enviamos a través de Mercado Libre con envío incluido.\n\n¿Qué producto te interesa?`;
        await updateConversation(psid, { lastIntent: "shipping_info" });
      } else {
        // We already have their location
        const locationStr = convo.city || convo.stateMx || '';
        responseText = `¡Sí! Enviamos a ${locationStr} y toda la república 📦\n\nLa mayoría de productos se envían por Mercado Libre con envío incluido.\n\n¿Qué medida necesitas?`;
        await updateConversation(psid, { lastIntent: "shipping_info" });
      }

      // Add asset mention if selected
      if (asset) {
        responseText = insertAssetIntoResponse(responseText, asset.text);
        const mentionedAssets = trackAssetMention(asset.key, convo);
        await updateConversation(psid, { mentionedAssets });
      }

      return {
        type: "text",
        text: responseText
      };
    }
  }

  // 🏢 ASKING IF WE'RE PHYSICALLY LOCATED IN THEIR CITY
  // "Trabajan aquí en Reynosa?" / "Están en Monterrey?" / "Tienen tienda en Guadalajara?"
  // "Pensé que estaban en Tijuana" / "Creí que estaban en Monterrey"
  if (/\b(trabajan?|est[aá]n?|tienen?|hay)\s+(aqu[ií]|all[aá]|alguna?|tienda|local|sucursal)?\s*(en|aqui en|alla en)\s+(\w+)/i.test(msg) ||
      /\b(son|eres|est[aá]s?|estaban?)\s+(de|en)\s+(\w+)/i.test(msg) ||
      /\b(pens[eé]|cre[ií]|pensaba|cre[ií]a)\s+que\s+(estaban?|eran?|son)\s+(de|en)\s+/i.test(msg)) {

    const location = await detectLocationEnhanced(msg);
    const cityName = location ? (location.normalized.charAt(0).toUpperCase() + location.normalized.slice(1)) : "esa ciudad";

    // Store city in conversation for sales attribution
    const updateData = { lastIntent: "asking_if_local", unknownCount: 0 };
    if (location) {
      updateData.city = location.location || location.normalized;
      if (location.state) updateData.stateMx = location.state;
      if (location.code) updateData.zipcode = location.code;
      console.log(`📍 Location detected and stored: ${location.normalized}`);
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

  // 🏙️ City/Location response - catches standalone city names like "En Mérida", "Monterrey", "76137", etc.
  // Works regardless of lastIntent - if message is short and is a valid Mexican location, handle it
  // Use actual Mexican location lookup including zipcode detection
  const acceptCityAfterMeasure = convo.lastIntent === "specific_measure" && convo.requestedSize;
  const hasZipCode = detectZipCode(msg);
  const standaloneLocation = isLikelyLocationName(msg) || hasZipCode ? await detectLocationEnhanced(msg) : null;

  if (convo.lastIntent === "shipping_info" || convo.lastIntent === "location_info" || convo.lastIntent === "city_provided" || convo.lastIntent === "awaiting_zipcode" || acceptCityAfterMeasure || standaloneLocation) {
    // Check if message is likely a location name (short, not a question) or contains a zipcode
    if (isLikelyLocationName(msg) || hasZipCode) {
      // Try to detect actual Mexican location (already done above if standalone)
      const location = standaloneLocation || await detectLocationEnhanced(msg);

      if (location) {
        // Confirmed Mexican city, state, or zipcode
        const cityName = location.normalized;

        // Store city in conversation for sales attribution
        const updateData = {
          lastIntent: "city_provided",
          unknownCount: 0
        };

        // Store location properly based on type
        if (location.type === 'state') {
          updateData.stateMx = location.normalized || location.location;
        } else {
          updateData.city = location.location || location.normalized;
          if (location.state) updateData.stateMx = location.state;
        }
        if (location.code) updateData.zipcode = location.code;

        console.log(`📍 Location detected and stored: ${location.normalized}${location.code ? ` (CP: ${location.code})` : ''}`);
        await updateConversation(psid, updateData);

        // Build response - confirm coverage
        const capitalizedCity = cityName.charAt(0).toUpperCase() + cityName.slice(1);
        const response = `¡Perfecto! Sí tenemos cobertura en ${capitalizedCity} 📦\n\n¿Qué medida te interesa?`;

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

        const baseResponse = `Te dejo el link a esa medida específica:\n\n` +
              `${trackedLink}\n\n` +
              `Estamos disponibles para cualquier información adicional.`;

        return {
          type: "text",
          text: addOfferHookIfRelevant(baseResponse, convo)
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

  // 🎯 Detect roll dimensions (e.g., 4x100, 2.10x100) - skip confeccionada handler
  // Roll dimensions have one side = 100 (standard roll length)
  const isRollDimension = dimensions && (dimensions.width === 100 || dimensions.height === 100);
  if (isRollDimension) {
    console.log(`📦 Roll dimension detected (${dimensions.width}x${dimensions.height}) - skipping confeccionada handler`);
    return null; // Let handleRollQuery process this
  }

  // 🔍 Check for suspicious large dimensions that might be missing decimal point
  // e.g., "2x380" might mean "2x3.80" not "2x380 meters"
  if (dimensions) {
    const suspicious = hasSuspiciousLargeDimension(dimensions);
    if (suspicious) {
      // Check if we're in clarification flow (user already confirmed)
      if (convo.lastIntent === "dimension_clarification_pending") {
        // User confirmed they really mean the large number - continue with original
        console.log(`✅ User confirmed large dimension: ${suspicious.original}m`);
      } else {
        // Ask for clarification
        const correctedSize = suspicious.dimension === 'width'
          ? `${suspicious.corrected}x${dimensions.height}`
          : `${dimensions.width}x${suspicious.corrected}`;

        await updateConversation(psid, {
          lastIntent: "dimension_clarification_pending",
          pendingDimensions: dimensions,
          suspiciousDimension: suspicious,
          unknownCount: 0
        });

        return {
          type: "text",
          text: `¿Te refieres a ${suspicious.corrected} metros (${correctedSize}m)?\n\n` +
                `O realmente necesitas ${suspicious.original} metros?`
        };
      }
    }
  }

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
      // User is asking about colors - just inform we only have beige (don't ask about prices if we already gave them)
      await updateConversation(psid, { lastIntent: "color_query", unknownCount: 0 });
      const colorResponses = [
        `Por ahora solo manejamos malla sombra beige en versión confeccionada 🌿`,
        `Actualmente solo tenemos disponible el color beige en malla confeccionada.`,
        `De momento contamos únicamente con beige, que es nuestro color más popular 😊`
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

      return { type: "text", text: addOfferHookIfRelevant(responseText, convo) };
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
  // EXCLUDES: rollo queries should go to roll handler, not confeccionada sizes
  const isGenericMeasureQuery = /\b(precio|cuestan?|cu[aá]nto|medidas?|tamaños?|dimensiones|disponibles?)\b/i.test(msg) &&
                                  !/\b(instalaci[oó]n|color|material|env[ií]o|ubicaci[oó]n|donde|rol+[oy]s?)\b/i.test(msg) &&
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
          text: addOfferHookIfRelevant(responseText, convo)
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

          // Build sales-style response with product details
          let responseText = await formatProductResponse(product, { price: product.price });

          // Add color info if color was mentioned
          if (hasColorMention) {
            responseText += `\n\nActualmente solo manejamos color beige en malla confeccionada.`;
          }

          responseText += `\n\n${trackedLink}`;

          // Append location if also asked
          if (isAlsoAskingLocation(msg)) {
            responseText += getLocationAppendix();
          }

          return { type: "text", text: addOfferHookIfRelevant(responseText, convo) };
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

          const selectedResponse = warmResponses[Math.floor(Math.random() * warmResponses.length)];
          return {
            type: "text",
            text: addOfferHookIfRelevant(selectedResponse, convo)
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
        responseText += `\n\nEnviamos a todo México. El envío está incluido en la mayoría de los casos o se calcula automáticamente:\n\n${trackedStoreLink}`;
      }

      return {
        type: "text",
        text: addOfferHookIfRelevant(responseText, convo)
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
