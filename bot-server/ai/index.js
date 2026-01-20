// ai/index.js
require("dotenv").config();
const { OpenAI } = require("openai");
const { getConversation, updateConversation, isHumanActive } = require("../conversationManager");
const { getBusinessInfo } = require("../businessInfoManager");
const { getProduct } = require("../hybridSearch");
const Campaign = require("../models/Campaign");
const { extractReference } = require("../referenceEstimator");
const { getProductsForConversation, getAdContextForConversation } = require("../utils/productLookup");
const { generateClickLink } = require("../tracking");

// AI-powered intent classification
const { classifyIntent } = require("./intentClassifier");
const { routeByIntent } = require("./intentRouter");

// Customer type classification
const { identifyCustomerType, getCustomerTypeDetails, hasCustomerTypeIndicators } = require("./customerClassifier");

const { handleGlobalIntents } = require("./global/intents");
const { handleGreeting, handleThanks, handleOptOut, handleAcknowledgment, handlePurchaseDeferral } = require("./core/greetings");
const { handleCatalogOverview } = require("./core/catalog");
const { handleFamilyFlow } = require("./core/family");
const { autoResponder } = require("./core/autoResponder");
const { handleFallback } = require("./core/fallback");
const { detectEdgeCase, handleUnintelligible, handleComplexQuestion } = require("./core/edgeCaseHandler");
const { isHumanHandoffRequest, handleHumanHandoff, detectFrustration, shouldAutoEscalate } = require("./core/humanHandoff");
const { handleMultipleSizes } = require("./core/multipleSizes");
const { handleProductCrossSell, shouldProvideFullCatalog } = require("./core/crossSell");
const { handleRollQuery } = require("./core/rollQuery");
const { handleHumanSalesFlow } = require("./core/humanSalesHandler");
const { correctTypos, logTypoCorrection } = require("./utils/typoCorrection");
const { getProductDisplayName, determineVerbosity } = require("./utils/productEnricher");



const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const botNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];
console.log(`🤖 Asistente asignada para esta sesión: ${BOT_PERSONA_NAME}`);

// Import for push notifications (for repetition escalation)
const { sendHandoffNotification } = require("../services/pushNotifications");

/**
 * Check if response is a repetition and escalate to human if so
 * Returns modified response if repetition detected, otherwise returns original
 */
async function checkForRepetition(response, psid, convo) {
  if (!response || !response.text) return response;

  // Normalize for comparison (remove emojis, extra spaces, lowercase)
  const normalizeText = (text) => {
    if (!text) return '';
    return text
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .substring(0, 200); // Compare first 200 chars
  };

  const currentNormalized = normalizeText(response.text);
  const lastNormalized = normalizeText(convo.lastBotResponse);

  // Check if this is a repetition (same response as last time)
  if (lastNormalized && currentNormalized === lastNormalized) {
    console.log("🔄 REPETITION DETECTED - escalating to human instead of repeating");

    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      handoffReason: "Bot attempted to repeat same response"
    });

    await sendHandoffNotification(psid, convo, "Bot detectó repetición - necesita atención humana");

    return {
      type: "text",
      text: "Déjame comunicarte con un asesor que pueda ayudarte mejor.\n\nEn un momento te atienden."
    };
  }

  // Save this response for future comparison
  await updateConversation(psid, { lastBotResponse: response.text });

  return response;
}

const productKeywordRegex = /\b(malla|sombra|borde|rollo|beige|monofilamento|invernadero|negra|verde|blanca|azul|90%|70%)\b/i;

/**
 * Normalizes dimension formats in a message
 * Converts "2 00" → "2.00", "2:00" → "2.00", etc.
 */
function normalizeDimensionFormats(message) {
  // Convert "2 00" or "2  00" to "2.00" (space as decimal separator)
  let normalized = message.replace(/(\d+)\s+(\d{2})(?=\s*[xX×*]|\s+por\s|\s*$)/g, '$1.$2');
  // Convert "2:00" to "2.00" (colon as decimal separator, common typo)
  normalized = normalized.replace(/(\d+):(\d{2})(?=\s*[xX×*]|\s+por\s|\s*$)/g, '$1.$2');
  // Also handle after the x: "x 10 00" → "x 10.00"
  normalized = normalized.replace(/([xX×*]\s*)(\d+)\s+(\d{2})(?=\s|$)/g, '$1$2.$3');
  normalized = normalized.replace(/([xX×*]\s*)(\d+):(\d{2})(?=\s|$)/g, '$1$2.$3');
  return normalized;
}

async function generateReplyInternal(userMessage, psid, convo, referral = null) {
  try {
    // Apply typo correction first
    const correctedMessage = correctTypos(userMessage);
    logTypoCorrection(userMessage, correctedMessage);

    const cleanMsg = correctedMessage.toLowerCase().trim();
    console.log("🧩 Conversación actual:", convo);

    // 👨‍💼 CRITICAL: If human agent is active, bot should NOT respond at all
    if (await isHumanActive(psid)) {
      console.log("👨‍💼 Human agent is handling this conversation, bot will not respond");
      return null;
    }

    // 🚨 CRITICAL: If conversation needs human (handoff requested), bot should NOT respond
    // This happens for custom orders, frustrated users, explicit handoff requests, etc.
    if (convo.state === "needs_human") {
      console.log("🚨 Conversation is waiting for human (needs_human state), bot will not respond");
      return null;
    }

    // 🎯 CUSTOMER TYPE CLASSIFICATION
    // Identify customer type based on keywords and conversation history
    if (hasCustomerTypeIndicators(correctedMessage)) {
      const customerType = identifyCustomerType(correctedMessage, convo);

      // Only update if type changed or wasn't set
      if (customerType && customerType !== convo.customerType) {
        const typeDetails = getCustomerTypeDetails(customerType);
        console.log(`🎯 Cliente clasificado como: ${typeDetails.label} (${typeDetails.description})`);

        await updateConversation(psid, {
          customerType,
          customerTypeLabel: typeDetails.label
        });

        // Store updated type in current convo object
        convo.customerType = customerType;
        convo.customerTypeLabel = typeDetails.label;
      }
    }

    // Log current customer type if set
    if (convo.customerType) {
      console.log(`👤 Tipo de cliente: ${convo.customerTypeLabel || convo.customerType}`);
    }

    // 🎯 Detectar campaña activa (MOVED UP - no AI calls needed)
    let campaign = null;
    if (!convo.campaignRef && referral?.ref) {
      campaign = await Campaign.findOne({ ref: referral.ref, active: true });
      if (campaign) {
        console.log(`🎯 Campaña detectada: ${campaign.name}`);
        await updateConversation(psid, { campaignRef: campaign.ref, lastIntent: "campaign_entry" });
      }
    } else if (convo.campaignRef) {
      campaign = await Campaign.findOne({ ref: convo.campaignRef });
    }

    // 🛍️ Get products for this conversation (from ad/adset/campaign)
    const availableProducts = await getProductsForConversation(convo);
    console.log(`🛍️ Available products for this conversation: ${availableProducts.length}`);

    // Store products in conversation context for AI to use
    convo.availableProducts = availableProducts;

    // 🎯 Get ad context (adIntent, adAngle) for tailoring responses
    const adContext = await getAdContextForConversation(convo);
    if (adContext) {
      convo.adContext = adContext;
      console.log(`🎯 Ad context: angle=${adContext.adAngle}, audience=${adContext.adIntent?.audienceType}, use=${adContext.adIntent?.primaryUse}`);
    }

    // 🚫 Check for opt-out (when conversation is closed and user confirms with "no")
    const optOutResponse = await handleOptOut(cleanMsg, convo);
    if (optOutResponse && optOutResponse.type === "no_response") {
      // Don't send any response - user has opted out
      return null;
    }

    // 🤝 HUMAN HANDOFF: Check if user explicitly wants to talk to a human
    if (isHumanHandoffRequest(cleanMsg)) {
      return await handleHumanHandoff(userMessage, psid, convo, "explicit");
    }

    // 🤝 HUMAN HANDOFF: Check for frustration
    if (detectFrustration(cleanMsg)) {
      console.log("⚠️ Frustration detected, offering human handoff");
      return await handleHumanHandoff(userMessage, psid, convo, "frustrated");
    }

    // 🤝 HUMAN HANDOFF: Auto-escalate if needed (after multiple failures)
    if (shouldAutoEscalate(convo)) {
      console.log("⚠️ Auto-escalating to human after multiple failures");
      return await handleHumanHandoff(userMessage, psid, convo, "auto_escalation");
    }

    // 👍 ACKNOWLEDGMENT: Handle simple acknowledgments and emojis (before AI calls)
    const acknowledgmentResponse = await handleAcknowledgment(cleanMsg, psid, convo);
    if (acknowledgmentResponse) return acknowledgmentResponse;

    // 📅 PURCHASE DEFERRAL: Handle when user wants to think about it, take measurements, etc.
    const deferralResponse = await handlePurchaseDeferral(cleanMsg, psid, convo, BOT_PERSONA_NAME);
    if (deferralResponse) return deferralResponse;

    // 👋 GREETING: Handle simple greetings BEFORE campaign flow
    // This ensures "hola" gets a friendly greeting, not product info
    const greetingResponse = await handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME);
    if (greetingResponse) return greetingResponse;

    // 💬 THANKS/GOODBYE: Handle thank you messages BEFORE campaign/global intents
    // This ensures "Gracias por la cotización" closes the conversation properly
    const earlyThanksResponse = await handleThanks(cleanMsg, psid, convo, BOT_PERSONA_NAME);
    if (earlyThanksResponse) return earlyThanksResponse;

    // 🧠 Si hay campaña activa, intentar intención global primero
    if (campaign) {
      const globalResponse = await handleGlobalIntents(cleanMsg, psid, convo);
      if (globalResponse) return globalResponse;

      // luego flujo dinámico de campaña
      try {
        const flowModule = require(`./campaigns/${campaign.ref}`);
        const handlerName = Object.keys(flowModule)[0];
        const flowHandler = flowModule[handlerName];

        if (typeof flowHandler === "function") {
          return await flowHandler(cleanMsg, psid, convo, campaign);
        }
      } catch (err) {
        console.warn(`⚠️ No se encontró flujo dinámico para la campaña:`, err.message);
      }
    }

    // 🚨 OPTIMIZED: Run edge case detection and intent classification IN PARALLEL
    const isLikelyCityResponse =
      (convo.lastIntent === "shipping_info" ||
       convo.lastIntent === "specific_measure" ||
       convo.lastIntent === "city_provided") &&
      cleanMsg.length > 2 &&
      cleanMsg.length < 40 &&
      cleanMsg.split(/\s+/).length <= 4 &&
      !/\b(precio|cuanto|cuesta|medida|tamaño|dimension|tiene|hay|vende|fabrica|color|hola|buenos|buenas|que tal)\b/i.test(cleanMsg);

    // Normalize dimension formats (e.g., "2 00 x 10 00" → "2.00 x 10.00", "2:00x10:00" → "2.00x10.00")
    const normalizedMsg = normalizeDimensionFormats(cleanMsg);
    if (normalizedMsg !== cleanMsg) {
      console.log(`📏 Normalized dimensions: "${cleanMsg}" → "${normalizedMsg}"`);
    }

    // Check if message contains dimension patterns (e.g., "7x5", "7 x 5", "7*5", "3 por 4")
    const hasDimensionPattern = /\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?/.test(normalizedMsg) ||
                                /\d+(?:\.\d+)?\s+por\s+\d+(?:\.\d+)?/i.test(normalizedMsg) ||
                                /(?:de|medida)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?/i.test(normalizedMsg);

    // Check if message contains reference objects (e.g., "tamaño de un carro", "para un patio")
    const hasReferenceObject = extractReference(correctedMessage) !== null;

    // Skip edge case detection if message has clear dimensions, references, or is likely a city name
    const skipEdgeCaseDetection = isLikelyCityResponse || hasDimensionPattern || hasReferenceObject;

    // Run AI calls in parallel to save time
    const [edgeCase, classification] = await Promise.all([
      skipEdgeCaseDetection
        ? Promise.resolve({ isUnintelligible: false, isComplex: false, confidence: 0 })
        : detectEdgeCase(userMessage, openai),
      classifyIntent(userMessage, {
        psid,
        lastIntent: convo.lastIntent,
        campaignRef: convo.campaignRef
      })
    ]);

    // Check edge cases first (unintelligible or complex)
    if (!skipEdgeCaseDetection) {
      if (edgeCase.isComplex && edgeCase.confidence > 0.9) {
        console.log(`🔴 Mensaje complejo detectado (${edgeCase.confidence}): ${edgeCase.reason}`);
        return await handleComplexQuestion(psid, convo, edgeCase.reason);
      }

      if (edgeCase.isUnintelligible && edgeCase.confidence > 0.9) {
        console.log(`⚠️ Mensaje ininteligible detectado (${edgeCase.confidence}): ${edgeCase.reason}`);
        return await handleUnintelligible(psid, convo, BOT_PERSONA_NAME);
      }
    }

    // ✅ Message is understandable - reset clarification counter if it was set
    if (convo.clarificationCount > 0) {
      updateConversation(psid, { clarificationCount: 0 }).catch(err =>
        console.error("Error resetting clarification count:", err)
      );
      console.log("✅ Mensaje entendido, contador de clarificación reiniciado");
    }

    // 🤖 AI-POWERED INTENT CLASSIFICATION
    // Try to route by classified intent
    if (classification.confidence > 0.6) {
      const intentResponse = await routeByIntent(
        classification.intent,
        correctedMessage,
        psid,
        convo,
        BOT_PERSONA_NAME
      );

      if (intentResponse) {
        return intentResponse;
      }
    } else {
      console.log(`⚠️ Low confidence (${classification.confidence}), falling back to pattern matching`);
    }

    // 🔄 FALLBACK: Pattern-based handlers (if AI classification didn't work)
    // These still run as backup for reliability

    // 💬 Agradecimientos (greeting already handled earlier, before campaign flow)
    const thanksResponse = await handleThanks(cleanMsg, psid, convo, BOT_PERSONA_NAME);
    if (thanksResponse) return thanksResponse;

    // 🛒 Human-sellable product sales flow (multi-step: zipcode → size/color → quantity)
    const humanSalesResponse = await handleHumanSalesFlow(correctedMessage, psid, convo);
    if (humanSalesResponse) return humanSalesResponse;

    // 🌍 Global intents (measures, shipping, location, etc.) - for ALL users
    const globalResponse = await handleGlobalIntents(cleanMsg, psid, convo);
    if (globalResponse) return globalResponse;

    // 📦 Catálogo general
    const catalogResponse = await handleCatalogOverview(cleanMsg, psid);
    if (catalogResponse) return catalogResponse;

    // 📦 Roll query with enriched product information
    const rollResponse = await handleRollQuery(correctedMessage, psid, convo);
    if (rollResponse) return rollResponse;

    // 🔄 Product cross-sell (when customer asks about product not in current context)
    const crossSellResponse = await handleProductCrossSell(correctedMessage, psid, convo, availableProducts);
    if (crossSellResponse) return crossSellResponse;

    // 🧩 Familias
    const familyResponse = await handleFamilyFlow(cleanMsg, psid, convo);
    if (familyResponse) return familyResponse;

    // 🛒 Búsqueda de producto (solo si hay keywords)
    // Skip product search for multi-question scenarios - let fallback handle comprehensive answers
    const multiQuestionIndicators = [
      /precio|costo|cu[aá]nto.*(?:cuesta|vale)/i, // Price questions
      /\b(si|funciona|repele|impermeable|agua)\b.*\b(agua|repele|impermeable|funciona)/i, // Water/function questions
      /\by\s+(si|funciona|repele|tiempo|entrega|pago|forma|cuanto|donde)/i, // Multiple questions with "y"
      /\btambién|además|ademas/i, // Also/additionally
      /\?.*\?/, // Multiple question marks
      /,.*\b(y|si|tiempo|entrega|pago|forma|costo|precio)/i // Commas followed by other questions
    ];

    // 📏 Detect multiple size requests (e.g., "4x3 y 4x4", "precios de 3x4 y 4x6")
    const multipleSizeIndicators = [
      /\d+(?:\.\d+)?[xX×*]\d+(?:\.\d+)?.*\b(y|,|de)\b.*\d+(?:\.\d+)?[xX×*]\d+(?:\.\d+)?/i, // Multiple dimensions with "y" or comma (e.g., "4x3 y 4x4")
      /\bprecios\b/i, // Plural "precios" suggests multiple items
      /\bcostos\b/i, // Plural "costos"
      /\bmall?as?\b.*\bmall?as?\b/i, // Multiple mentions of "malla/mallas"
    ];

    const isMultiQuestion = multiQuestionIndicators.some(regex => regex.test(cleanMsg));
    const isMultiSize = multipleSizeIndicators.some(regex => regex.test(cleanMsg));

    // 📏 HANDLE MULTIPLE SIZE REQUESTS
    if (isMultiSize) {
      console.log("📏 Multiple size request detected, using specialized handler");
      const multiSizeResponse = await handleMultipleSizes(correctedMessage, psid, convo, convo.campaignRef);
      if (multiSizeResponse) return multiSizeResponse;
      // If handler returned null (less than 2 dimensions), continue to regular flow
    }

    // Skip product search for generic quote requests without specific size
    const isGenericQuoteRequest = /\b(cotizar|cotiza|cotizaci[oó]n)\b/i.test(cleanMsg) &&
                                   !/\d+\s*x\s*\d+/.test(cleanMsg);

    if (!isMultiQuestion && !isMultiSize && !isGenericQuoteRequest && productKeywordRegex.test(cleanMsg)) {
      const product = await getProduct(cleanMsg);
      if (product) {
        await updateConversation(psid, { lastIntent: "product_search", state: "active", unknownCount: 0 });

        if (product.source === "ml") {
          const verbosity = determineVerbosity(userMessage, convo);
          const displayName = await getProductDisplayName(product, verbosity);
          const trackedLink = await generateClickLink(psid, product.permalink, {
            productName: product.name,
            productId: product._id || product.id,
            campaignId: convo.campaignId,
            adSetId: convo.adSetId,
            adId: convo.adId,
            userName: convo.userName,
            city: convo.city,
            stateMx: convo.stateMx
          });

          return {
            type: "image",
            text: `Encontré "${displayName}" en nuestro catálogo de Mercado Libre 💚\nPuedes comprarlo directamente aquí 👉 ${trackedLink}`,
            imageUrl: product.imageUrl
          };
        }

        const verbosity = determineVerbosity(userMessage, convo);
        const displayName = await getProductDisplayName(product, verbosity);
        return {
          type: "image",
          text: `Tenemos "${displayName}" disponible por $${product.price}.\n¿Quieres que te envíe más detalles o medidas?`,
          imageUrl: product.imageUrl
        };
      }
    } else if (isMultiQuestion) {
      console.log("⏩ Multi-question detected before product search, skipping to fallback");
    }

    // 🔁 Respuestas automáticas rápidas (FAQ / respuestas simples)
    const autoResponse = await autoResponder(cleanMsg);
    if (autoResponse) return autoResponse;

    // 📍 Location questions - respond with simple location info
    if (/d[oó]nde\s+(est[aá]n|se\s+ubican|quedan)|h?ubicaci[oó]n|direcci[oó]n|qued[ao]n?|encuentran/i.test(cleanMsg)) {
      console.log("📍 Location question detected at fallback stage");
      await updateConversation(psid, { lastIntent: "location_info" });
      return {
        type: "text",
        text: "Estamos en Querétaro, pero enviamos a todo el país por Mercado Libre 📦"
      };
    }

    // 🧠 Fallback IA (si no se detectó ninguna intención conocida)
    return await handleFallback(correctedMessage, psid, convo, openai, BOT_PERSONA_NAME);

  } catch (error) {
    console.error("❌ Error en generateReply:", error);
    return { type: "text", text: "Lo siento 😔 hubo un problema al generar la respuesta." };
  }
}

/**
 * Main entry point - wraps generateReplyInternal with repetition detection
 */
async function generateReply(userMessage, psid, referral = null) {
  const convo = await getConversation(psid);

  // Get the response from internal logic
  const response = await generateReplyInternal(userMessage, psid, convo, referral);

  // Check for repetition and escalate if needed
  return await checkForRepetition(response, psid, convo);
}

module.exports = { generateReply };
