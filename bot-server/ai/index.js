// ai/index.js
require("dotenv").config();
const { OpenAI } = require("openai");
const { getConversation, updateConversation } = require("../conversationManager");
const { getBusinessInfo } = require("../businessInfoManager");
const { getProduct } = require("../hybridSearch");
const Campaign = require("../models/Campaign");

// AI-powered intent classification
const { classifyIntent } = require("./intentClassifier");
const { routeByIntent } = require("./intentRouter");

const { handleGlobalIntents } = require("./global/intents");
const { handleGreeting, handleThanks, handleOptOut } = require("./core/greetings");
const { handleCatalogOverview } = require("./core/catalog");
const { handleFamilyFlow } = require("./core/family");
const { autoResponder } = require("./core/autoResponder");
const { handleFallback } = require("./core/fallback");
const { detectEdgeCase, handleUnintelligible, handleComplexQuestion } = require("./core/edgeCaseHandler");
const { isHumanHandoffRequest, handleHumanHandoff, detectFrustration, shouldAutoEscalate } = require("./core/humanHandoff");



const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const botNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];
console.log(`🤖 Asistente asignada para esta sesión: ${BOT_PERSONA_NAME}`);

const productKeywordRegex = /\b(malla|sombra|borde|rollo|beige|monofilamento|invernadero|negra|verde|blanca|azul|90%|70%)\b/i;

async function generateReply(userMessage, psid, referral = null) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();
    const convo = await getConversation(psid);
    console.log("🧩 Conversación actual:", convo);

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

    // Check if message contains dimension patterns (e.g., "7x5", "7 x 5", "3 por 4")
    const hasDimensionPattern = /\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?/.test(cleanMsg) ||
                                /\d+(?:\.\d+)?\s+por\s+\d+(?:\.\d+)?/i.test(cleanMsg) ||
                                /(?:de|medida)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?/i.test(cleanMsg);

    // Skip edge case detection if message has clear dimensions or is likely a city name
    const skipEdgeCaseDetection = isLikelyCityResponse || hasDimensionPattern;

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
        return await handleComplexQuestion(psid, edgeCase.reason);
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
        userMessage,
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

    // 💬 Saludos / agradecimientos
    const greetingResponse = await handleGreeting(cleanMsg, psid, convo, BOT_PERSONA_NAME);
    if (greetingResponse) return greetingResponse;

    const thanksResponse = await handleThanks(cleanMsg, psid, BOT_PERSONA_NAME);
    if (thanksResponse) return thanksResponse;

    // 🌍 Global intents (measures, shipping, location, etc.) - for ALL users
    const globalResponse = await handleGlobalIntents(cleanMsg, psid, convo);
    if (globalResponse) return globalResponse;

    // 📦 Catálogo general
    const catalogResponse = await handleCatalogOverview(cleanMsg, psid);
    if (catalogResponse) return catalogResponse;

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

    const isMultiQuestion = multiQuestionIndicators.some(regex => regex.test(cleanMsg));

    if (!isMultiQuestion && productKeywordRegex.test(cleanMsg)) {
      const product = await getProduct(cleanMsg);
      if (product) {
        await updateConversation(psid, { lastIntent: "product_search", state: "active", unknownCount: 0 });

        if (product.source === "ml") {
          return {
            type: "image",
            text: `Encontré "${product.name}" en nuestro catálogo de Mercado Libre 💚\nPuedes comprarlo directamente aquí 👉 ${product.permalink}`,
            imageUrl: product.imageUrl
          };
        }

        return {
          type: "image",
          text: `Tenemos "${product.name}" disponible por $${product.price}.\n¿Quieres que te envíe más detalles o medidas?`,
          imageUrl: product.imageUrl
        };
      }
    } else if (isMultiQuestion) {
      console.log("⏩ Multi-question detected before product search, skipping to fallback");
    }

    // 🔁 Respuestas automáticas rápidas (FAQ / respuestas simples)
    const autoResponse = await autoResponder(cleanMsg);
    if (autoResponse) return autoResponse;

    // 🧠 Fallback IA (si no se detectó ninguna intención conocida)
    return await handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME);

  } catch (error) {
    console.error("❌ Error en generateReply:", error);
    return { type: "text", text: "Lo siento 😔 hubo un problema al generar la respuesta." };
  }
}

module.exports = { generateReply };
