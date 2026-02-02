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

// ====== OLD SYSTEM - DEACTIVATED ======
// These imports are kept for reference but the old system is no longer used.
// See generateReplyInternal() below - it's preserved but not called.
const { classifyIntent } = require("./intentClassifier");
const { routeByIntent } = require("./intentRouter");

// Customer type classification
const { identifyCustomerType, getCustomerTypeDetails, hasCustomerTypeIndicators } = require("./customerClassifier");

const { handleGlobalIntents } = require("./global/intents");
const { handleGreeting, handleThanks, handleOptOut, handleAcknowledgment, handlePurchaseDeferral, handleStoreVisit } = require("./core/greetings");
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
const { identifyAndSetProduct } = require("./utils/productIdentifier");
const { lockPOI, checkVariantExists, getNotAvailableResponse } = require("./utils/productTree");
const { handleLocationStatsResponse, appendStatsQuestionIfNeeded, syncConversationLocationToUser } = require("./utils/locationStats");

// Layer 0: Source Context Detection
const { buildSourceContext, logSourceContext, getProductFromSource } = require("./context");

// Layer 1: Intent Classification
const { classify, logClassification } = require("./classifier");

// Layer 2-3: Flow Router (legacy - being replaced by flowManager)
const { processMessage: processWithFlows } = require("./flows");

// NEW: Central Flow Manager - ALL messages go through here
const { processMessage: processWithFlowManager } = require("./flowManager");

// Intent model for DB-driven responses
const Intent = require("../models/Intent");

// Flow executor for DB-driven conversation flows
const {
  isInFlow,
  processFlowStep,
  startFlow,
  getFlowByIntent
} = require("./flowExecutor");

// Wholesale handler
const {
  extractQuantity,
  handleWholesaleRequest,
  getWholesaleMention,
  isWholesaleInquiry
} = require("./utils/wholesaleHandler");
const Product = require("../models/Product");

/**
 * Handle intent based on DB configuration (responseTemplate + handlerType)
 * @param {string} intentKey - The classified intent key
 * @param {object} classification - Full classification result
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @returns {object|null} Response if handled, null to continue to flows
 */
async function handleIntentFromDB(intentKey, classification, psid, convo, userMessage = null) {
  try {
    // Lookup intent in DB
    const intent = await Intent.findOne({ key: intentKey, active: true });

    if (!intent) {
      console.log(`📋 No DB intent found for "${intentKey}", continuing to flows`);
      return null;
    }

    // Increment hit count and update lastTriggered
    await Intent.updateOne(
      { _id: intent._id },
      { $inc: { hitCount: 1 }, $set: { lastTriggered: new Date() } }
    );

    console.log(`📋 DB Intent matched: ${intent.name} (${intent.handlerType})`);

    // Handle based on handlerType
    switch (intent.handlerType) {
      case 'auto_response':
        // Return the template directly - no AI involved
        if (intent.responseTemplate) {
          console.log(`✅ Auto-response from DB template`);
          return {
            type: "text",
            text: intent.responseTemplate,
            handledBy: "intent_auto_response"
          };
        }
        // No template defined, fall through to flows
        console.log(`⚠️ auto_response but no template defined, continuing to flows`);
        return null;

      case 'human_handoff':
        // Trigger human handoff
        console.log(`🤝 Intent triggers human handoff`);
        const { updateConversation } = require("../conversationManager");
        await updateConversation(psid, {
          handoffRequested: true,
          handoffReason: `Intent: ${intent.name}`,
          handoffTimestamp: new Date(),
          state: "needs_human"
        });

        return {
          type: "text",
          text: intent.responseTemplate || "Te comunico con un especialista. En un momento te atienden.",
          handledBy: "intent_human_handoff"
        };

      case 'ai_generate':
        // Store template as guidance for AI - flows will use it
        if (intent.responseTemplate) {
          classification.responseGuidance = intent.responseTemplate;
          classification.intentName = intent.name;
          console.log(`🤖 AI will use template as guidance: "${intent.responseTemplate.substring(0, 50)}..."`);
        }
        // Continue to flows which will use the guidance
        return null;

      case 'flow':
        // Check if there's a linked flow for this intent
        const linkedFlow = await getFlowByIntent(intentKey);
        if (linkedFlow) {
          console.log(`🔀 Intent has linked flow: ${linkedFlow.name}`);
          // Pass userMessage so flow can extract dimensions or other data
          return await startFlow(linkedFlow.key, psid, convo, userMessage);
        }
        // No linked flow, continue to normal flow handling
        console.log(`⚠️ handlerType=flow but no linked flow found`);
        return null;

      default:
        // Continue to normal flow handling
        return null;
    }
  } catch (error) {
    console.error(`❌ Error handling intent from DB:`, error.message);
    return null; // Continue to flows on error
  }
}

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

  // Check time since last message - if more than 6 hours, treat as fresh conversation
  const lastMessageTime = convo.lastMessageAt ? new Date(convo.lastMessageAt) : null;
  const hoursSinceLastMessage = lastMessageTime
    ? (Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60)
    : 999;

  if (hoursSinceLastMessage > 6) {
    console.log(`⏰ Conversation resumed after ${hoursSinceLastMessage.toFixed(1)} hours - treating as fresh`);
    // Clear lastBotResponse to prevent false repetition detection
    await updateConversation(psid, { lastBotResponse: response.text });
    return response;
  }

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
    console.log("🔄 REPETITION DETECTED - checking if it's same size request");

    // Check if this is a price/product quote (contains price and dimensions)
    const isPriceQuote = /\$[\d,]+/.test(response.text) &&
                         /\d+\s*[xX×]\s*\d+/.test(response.text);

    if (isPriceQuote) {
      // User is asking about the same size they were just quoted
      // Extract size, price, and link from the response
      const sizeMatch = response.text.match(/(\d+)\s*[xX×]\s*(\d+)/);
      const priceMatch = response.text.match(/\$([\d,]+)/);
      const linkMatch = response.text.match(/(https:\/\/agente\.hanlob\.com\.mx\/r\/\w+)/);

      if (sizeMatch && priceMatch) {
        const size = `${sizeMatch[1]}x${sizeMatch[2]}`;
        const price = priceMatch[1];

        console.log(`📏 User asking for same size ${size} - sending link again`);

        await updateConversation(psid, { lastIntent: "same_size_confirmation" });

        // If we have the link, send it directly. Otherwise ask.
        if (linkMatch) {
          return {
            type: "text",
            text: `¡Claro! Te paso nuevamente el link de la ${size}m a $${price} con envío gratis:\n\n${linkMatch[1]}`
          };
        } else {
          return {
            type: "text",
            text: `Sí, es la misma medida: ${size}m a $${price} con envío gratis.\n\n¿Te paso el link para que puedas comprarlo?`
          };
        }
      }
    }

    // Check if this is a simple logistics response that user is re-asking
    // (location, shipping, payment) - these are valid re-asks, not bot loops
    const isLogisticsResponse = /quer[eé]taro|enviamos|env[ií]o|pago|tarjeta|mercado libre/i.test(response.text);
    if (isLogisticsResponse) {
      console.log(`📍 Logistics re-ask detected - allowing repeat response`);
      // Just allow the response through, save it for next comparison
      await updateConversation(psid, { lastBotResponse: response.text });
      return response;
    }

    // Not a price quote or logistics repetition - escalate to human
    console.log("🔄 Non-price repetition - escalating to human");

    await updateConversation(psid, {
      lastIntent: "human_handoff",
      state: "needs_human",
      handoffReason: "Bot attempted to repeat same response"
    });

    await sendHandoffNotification(psid, convo, "Bot detectó repetición - necesita atención humana");

    return {
      type: "text",
      text: "Déjame comunicarte con un especialista que pueda ayudarte mejor.\n\nEn un momento te atienden."
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

// ====== OLD SYSTEM - DEACTIVATED ======
// This function is preserved for reference but is NO LONGER CALLED.
// The new flow system (Layer 0-3) handles all messages now.
// To re-enable: uncomment the call in generateReply() above.
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

    // 🏪 STORE VISIT: Handle when user says they'll visit the physical store
    const storeVisitResponse = await handleStoreVisit(cleanMsg, psid, convo);
    if (storeVisitResponse) return storeVisitResponse;

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

    // Skip product search for info/characteristics requests - let flows handle these
    const isInfoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|detalles?|especificaciones?|material|qu[eé]\s+es|c[oó]mo\s+es)\b/i.test(cleanMsg);

    if (!isMultiQuestion && !isMultiSize && !isGenericQuoteRequest && !isInfoRequest && productKeywordRegex.test(cleanMsg)) {
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

    // 📍 "Donde las consigo" - Ask for location to personalize shipping response
    if (/d[oó]nde\s+(l[ao]s?\s+)?(cons?igo|consiguen|compro|encuentro|venden|adquiero)|c[oó]mo\s+(l[ao]s?\s+)?(compro|consigo|adquiero)/i.test(cleanMsg)) {
      console.log("📍 'Donde las consigo' detected - asking for location");
      await updateConversation(psid, {
        lastIntent: "asking_where_to_buy",
        pendingShippingLocation: true
      });
      return {
        type: "text",
        text: "¿Cuál es tu código postal o ciudad?"
      };
    }

    // 📍 Physical location questions - where are you located
    if (/d[oó]nde\s+(est[aá]n|se\s+ubican|quedan)|h?ubicaci[oó]n|direcci[oó]n/i.test(cleanMsg)) {
      console.log("📍 Physical location question detected");
      await updateConversation(psid, { lastIntent: "location_info" });
      return {
        type: "text",
        text: "Estamos en Querétaro en el parque industrial Navex, Tlacote. Pero enviamos a todo el país por Mercado Libre 📦\n\n¿De qué ciudad nos escribes?"
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
  let convo = await getConversation(psid);

  // ====== CONVERSATION BASKET: Extract and merge specs from EVERY message ======
  // This ensures we never lose information the customer gave us
  const { extractAllSpecs, mergeSpecs } = require("./utils/specExtractor");
  const extractedSpecs = extractAllSpecs(userMessage, { lastIntent: convo.lastIntent });

  if (Object.keys(extractedSpecs).length > 0) {
    const mergedSpecs = mergeSpecs(convo.productSpecs || {}, extractedSpecs);
    console.log(`🛒 Basket updated:`, JSON.stringify(mergedSpecs));

    // Save merged specs to conversation (non-blocking)
    updateConversation(psid, { productSpecs: mergedSpecs }).catch(err =>
      console.error("Error updating productSpecs:", err.message)
    );

    // Update local convo object so handlers have the latest specs
    convo.productSpecs = mergedSpecs;
  }
  // ====== END CONVERSATION BASKET ======

  // ====== STRUCTURAL FIX: ENSURE PRODUCT INTEREST IS RESOLVED ======
  // If conversation has adId or campaignRef but NO productInterest, resolve it now
  // This is a self-healing mechanism - even if initial referral handling failed,
  // we always have a second chance to resolve the context
  if (!convo?.productInterest && (convo?.adId || convo?.campaignRef)) {
    try {
      const { resolveByAdId, resolveByCampaignRef } = require("../utils/campaignResolver");
      const { getProductInterest } = require("./utils/productEnricher");
      const ProductFamily = require("../models/ProductFamily");

      let resolvedSettings = null;

      // Try to resolve by adId first, then by campaignRef
      if (convo.adId) {
        resolvedSettings = await resolveByAdId(convo.adId);
        console.log(`🔄 Self-healing: resolving productInterest from adId ${convo.adId}`);
      } else if (convo.campaignRef) {
        resolvedSettings = await resolveByCampaignRef(convo.campaignRef);
        console.log(`🔄 Self-healing: resolving productInterest from campaignRef ${convo.campaignRef}`);
      }

      if (resolvedSettings?.productIds?.length > 0) {
        const productId = resolvedSettings.mainProductId || resolvedSettings.productIds[0];
        const product = await ProductFamily.findById(productId).lean();

        if (product) {
          const productInterest = await getProductInterest(product);
          if (productInterest) {
            // Lock POI with full tree context
            const poiContext = await lockPOI(psid, product._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              convo.productFamilyId = product._id.toString();
              console.log(`✅ Self-healing: POI locked to ${poiContext.rootName} (${productInterest})`);
            } else {
              await updateConversation(psid, { productInterest });
              convo.productInterest = productInterest;
              console.log(`✅ Self-healing: set productInterest to ${productInterest}`);
            }
          }
        }
      } else if (resolvedSettings?.campaignName) {
        // Fallback: infer from campaign name and try to lock to root family
        const campaignName = (resolvedSettings.campaignName || '').toLowerCase();
        let productInterest = null;
        let rootFamilyName = null;

        if (campaignName.includes('malla') || campaignName.includes('sombra') || campaignName.includes('confeccionada')) {
          productInterest = 'malla_sombra';
          rootFamilyName = 'Malla Sombra';
        } else if (campaignName.includes('borde') || campaignName.includes('jardin')) {
          productInterest = 'borde_separador';
          rootFamilyName = 'Borde Separador';
        } else if (campaignName.includes('ground') || campaignName.includes('cover')) {
          productInterest = 'ground_cover';
          rootFamilyName = 'Ground Cover';
        }

        if (productInterest) {
          // Try to find and lock to the root family
          const rootFamily = await ProductFamily.findOne({
            name: { $regex: rootFamilyName, $options: 'i' },
            parentId: null,
            active: true
          }).lean();

          if (rootFamily) {
            const poiContext = await lockPOI(psid, rootFamily._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              console.log(`✅ Self-healing: POI locked to ${poiContext.rootName} from campaign name`);
            }
          } else {
            await updateConversation(psid, { productInterest });
            convo.productInterest = productInterest;
            console.log(`✅ Self-healing: inferred productInterest ${productInterest} from campaign name`);
          }
        }
      }
    } catch (err) {
      console.error(`⚠️ Self-healing productInterest resolution failed:`, err.message);
    }
  }
  // ====== END STRUCTURAL FIX ======

  // ====== CHECK ACTIVE FLOW ======
  // If user is in an active flow, process the flow step first
  if (isInFlow(convo)) {
    console.log(`🔄 User is in active flow: ${convo.activeFlow.flowKey}`);
    const flowResponse = await processFlowStep(userMessage, psid, convo);
    if (flowResponse) {
      return await checkForRepetition(flowResponse, psid, convo);
    }
    // If flow returns null, continue with normal processing
    console.log(`⚠️ Flow returned null, continuing with normal processing`);
  }
  // ====== END ACTIVE FLOW CHECK ======

  // ====== EARLY HANDLERS (from old system) ======
  // These handle common patterns before the main flow system
  const cleanMsg = userMessage.toLowerCase().trim();

  // 📊 LOCATION STATS: Check if user is answering our "de qué ciudad?" question
  if (convo.pendingLocationResponse) {
    const locationResponse = await handleLocationStatsResponse(userMessage, psid, convo);
    if (locationResponse) {
      return await checkForRepetition(locationResponse, psid, convo);
    }
    // Not a location response, continue normal flow
  }

  // 📍 SHIPPING LOCATION: Check if user is answering "¿Cuál es tu código postal o ciudad?"
  if (convo.pendingShippingLocation) {
    const { parseLocationResponse, syncLocationToUser } = require("./utils/locationStats");
    const { detectLocationEnhanced } = require("../mexicanLocations");

    // Try to parse as location
    let location = parseLocationResponse(userMessage);

    // If parseLocationResponse didn't work, try detectLocationEnhanced
    if (!location) {
      const detected = await detectLocationEnhanced(userMessage);
      if (detected) {
        location = {
          city: detected.location || detected.normalized,
          state: detected.state,
          zipcode: detected.code || null
        };
      }
    }

    // Clear pending flag
    await updateConversation(psid, { pendingShippingLocation: false });

    if (location) {
      console.log("📍 Shipping location received:", location);

      // Save location to conversation and User model
      const convoUpdate = { unknownCount: 0 };
      if (location.city) convoUpdate.city = location.city;
      if (location.state) convoUpdate.stateMx = location.state;
      if (location.zipcode) convoUpdate.zipcode = location.zipcode;
      await updateConversation(psid, convoUpdate);
      await syncLocationToUser(psid, location, 'shipping_question');

      // Build location string for response
      const locationStr = location.city || location.state || `CP ${location.zipcode}`;

      // Check if they're in Querétaro
      const isQueretaro = (location.state && /quer[eé]taro/i.test(location.state)) ||
                          (location.city && /quer[eé]taro/i.test(location.city));

      let response = `Perfecto, enviamos a ${locationStr} sin costo a través de Mercado Libre 📦`;

      if (isQueretaro) {
        response += `\n\nTambién puedes visitar nuestra tienda en el parque industrial Navex, Tlacote.`;
      }

      response += `\n\n¿Qué medida de malla sombra necesitas?`;

      return await checkForRepetition({ type: "text", text: response }, psid, convo);
    }
    // Not a valid location, continue normal flow
  }

  // 👍 ACKNOWLEDGMENT: Handle simple acknowledgments and emojis
  const acknowledgmentResponse = await handleAcknowledgment(cleanMsg, psid, convo);
  if (acknowledgmentResponse) {
    return await checkForRepetition(acknowledgmentResponse, psid, convo);
  }

  // 📞 PHONE NUMBER: Handle when user asks for phone/contact number
  if (/\b(tel[eé]fono|n[uú]mero|cel(ular)?|contacto|llam(ar|o|e)|whatsapp|wsp)\b/i.test(cleanMsg) &&
      !/precio|cuanto|cuesta|medida|cotiza/i.test(cleanMsg)) {
    console.log("📞 Phone number request detected");
    const { getBusinessInfo } = require("./core/businessInfo");
    const info = await getBusinessInfo();
    await updateConversation(psid, { lastIntent: "phone_request" });
    return await checkForRepetition({
      type: "text",
      text: `¡Claro! Aquí tienes nuestros datos de contacto:\n\n` +
            `📞 ${info.phones.join(" / ")}\n` +
            `💬 WhatsApp: wa.me/524421809696\n` +
            `🕓 ${info.hours}\n\n` +
            `¿Hay algo más en lo que pueda ayudarte?`
    }, psid, convo);
  }

  // 🏪 STORE VISIT: Handle when user says they'll visit the physical store
  const storeVisitResponse = await handleStoreVisit(cleanMsg, psid, convo);
  if (storeVisitResponse) {
    return await checkForRepetition(storeVisitResponse, psid, convo);
  }

  // 📅 PURCHASE DEFERRAL: Handle when user wants to think about it
  const deferralResponse = await handlePurchaseDeferral(cleanMsg, psid, convo, BOT_PERSONA_NAME);
  if (deferralResponse) {
    return await checkForRepetition(deferralResponse, psid, convo);
  }

  // ====== END EARLY HANDLERS ======

  // ====== LAYER 0: SOURCE CONTEXT ======
  // Detect where this conversation came from (ad, comment, cold DM, returning user)
  const sourceContext = await buildSourceContext(
    referral ? { referral, sender: { id: psid } } : { sender: { id: psid } },
    convo,
    convo?.channel || "facebook"
  );

  // Log source context for analytics
  logSourceContext(psid, sourceContext, userMessage);
  // ====== END LAYER 0 ======

  // ====== LOAD CAMPAIGN CONTEXT ======
  let campaign = null;
  let campaignContext = null;

  // Check for campaign from referral or existing conversation
  const campaignRef = referral?.ref || convo?.campaignRef;
  if (campaignRef) {
    try {
      campaign = await Campaign.findOne({ ref: campaignRef, active: true });
      if (campaign) {
        campaignContext = campaign.toAIContext();
        console.log(`📣 Campaign loaded: ${campaign.name} (goal: ${campaign.conversationGoal})`);

        // Save campaign ref to conversation if new
        if (!convo?.campaignRef && referral?.ref) {
          await updateConversation(psid, { campaignRef: campaign.ref });
        }
      }
    } catch (err) {
      console.error(`⚠️ Error loading campaign:`, err.message);
    }
  }
  // ====== END CAMPAIGN CONTEXT ======

  // ====== PRODUCT IDENTIFICATION & POI LOCK ======
  // Try to identify product from message content
  // This runs even if productInterest is already set (might be switching products)
  const identifiedProduct = await identifyAndSetProduct(userMessage, psid, convo);
  if (identifiedProduct) {
    convo.productInterest = identifiedProduct.key; // Update local copy
    console.log(`🎯 Product context: ${identifiedProduct.displayName} (${identifiedProduct.key})`);

    // Lock POI with full tree context
    if (identifiedProduct.familyId && !convo.poiLocked) {
      const poiContext = await lockPOI(psid, identifiedProduct.familyId);
      if (poiContext) {
        convo.poiLocked = true;
        convo.poiRootId = poiContext.rootId?.toString();
        convo.poiRootName = poiContext.rootName;
        console.log(`🔒 POI locked: ${poiContext.name} (root: ${poiContext.rootName})`);
      }
    }
  }

  // If POI is locked but user asks for something outside the tree, inform them
  if (convo.poiLocked && convo.poiRootId) {
    // Check if message mentions a different product category entirely
    const ProductFamily = require("../models/ProductFamily");
    const otherProduct = await identifyAndSetProduct(userMessage, psid, {});

    if (otherProduct && otherProduct.familyId) {
      // Check if this product is in our locked tree
      const variantCheck = await checkVariantExists(convo.poiRootId, otherProduct.name);

      if (!variantCheck.exists && variantCheck.reason === "not_in_tree") {
        // User asked for a product outside their locked tree
        // Allow switching - update POI to new tree
        const newPOI = await lockPOI(psid, otherProduct.familyId);
        if (newPOI) {
          convo.productInterest = otherProduct.key;
          convo.poiRootId = newPOI.rootId?.toString();
          convo.poiRootName = newPOI.rootName;
          console.log(`🔄 POI switched: ${newPOI.rootName}`);
        }
      }
    }
  }
  // ====== END PRODUCT IDENTIFICATION & POI LOCK ======

  // ====== LAYER 1: INTENT CLASSIFICATION ======
  const conversationFlow = convo?.productSpecs ? {
    product: convo.productSpecs.productType,
    stage: convo.lastIntent,
    collected: convo.productSpecs
  } : null;

  // Pass campaign context to classifier
  const classification = await classify(userMessage, sourceContext, conversationFlow, campaignContext);
  logClassification(psid, userMessage, classification);
  // ====== END LAYER 1 ======

  // ====== PHONE NUMBER DETECTION (HOT LEAD!) ======
  // This runs before flow manager because it's a special case that triggers immediate handoff
  if (classification.intent === 'phone_shared' && classification.entities?.phone) {
    const phone = classification.entities.phone;
    console.log(`📱 HOT LEAD! Phone number captured: ${phone}`);

    await updateConversation(psid, {
      'leadData.contact': phone,
      'leadData.contactType': 'phone',
      'leadData.capturedAt': new Date(),
      handoffRequested: true,
      handoffReason: `Cliente compartió su teléfono: ${phone}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    return {
      type: "text",
      text: "¡Perfecto! Anotado tu número. En un momento te contacta uno de nuestros asesores para atenderte personalmente.",
      handledBy: "phone_captured"
    };
  }
  // ====== END PHONE NUMBER DETECTION ======

  // ====== FLOW MANAGER - CENTRAL ROUTING ======
  // ALL messages go through the flow manager
  // - Scoring ALWAYS runs (detects tire-kickers, competitors)
  // - Routes to appropriate flow (default, malla, rollo, etc.)
  // - Handles flow transfers when product is detected
  let response = null;

  try {
    response = await processWithFlowManager(userMessage, psid, convo, classification, sourceContext, campaign);

    if (response) {
      console.log(`✅ Flow manager handled message (${response.handledBy})`);
    }
  } catch (flowError) {
    console.error(`❌ Error in flow manager:`, flowError.message);
  }

  // ====== FALLBACK: Legacy flows if flow manager didn't handle ======
  if (!response) {
    try {
      response = await processWithFlows(classification, sourceContext, convo, psid, userMessage, campaign);
      if (response) {
        console.log(`✅ Legacy flow system handled message (${response.handledBy})`);
      }
    } catch (legacyError) {
      console.error(`❌ Error in legacy flows:`, legacyError.message);
    }
  }

  // ====== FINAL FALLBACK ======
  if (!response) {
    const unhandledCount = (convo.unhandledCount || 0) + 1;
    await updateConversation(psid, { unhandledCount });

    console.log(`🔴 Unhandled message (count: ${unhandledCount}): "${userMessage}"`);

    if (unhandledCount >= 3) {
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: "Multiple unhandled messages",
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      response = {
        type: "text",
        text: "Déjame comunicarte con un especialista que pueda ayudarte mejor.\n\nEn un momento te atienden."
      };
    } else {
      response = {
        type: "text",
        text: "¿Qué producto te interesa?\n\n• Malla sombra confeccionada\n• Rollos de malla sombra\n• Borde separador para jardín"
      };
    }
  }

  // ====== LOCATION STATS QUESTION ======
  // Append "de qué ciudad nos escribes?" if we're sending an ML link
  // and haven't asked yet
  if (response && response.text) {
    const statsResult = await appendStatsQuestionIfNeeded(response.text, convo, psid);
    if (statsResult.askedStats) {
      response.text = statsResult.text;
    }
  }
  // ====== END LOCATION STATS QUESTION ======

  // Check for repetition and escalate if needed
  return await checkForRepetition(response, psid, convo);
}

module.exports = { generateReply };
