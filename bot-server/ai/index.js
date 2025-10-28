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
const { handleGreeting, handleThanks } = require("./core/greetings");
const { handleCatalogOverview } = require("./core/catalog");
const { handleFamilyFlow } = require("./core/family");
const { autoResponder } = require("./core/autoResponder");
const { handleFallback } = require("./core/fallback");



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

    // 🎯 Detectar campaña activa
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

    // 🤖 AI-POWERED INTENT CLASSIFICATION (NEW!)
    // This gives us flexibility to handle misspellings, slang, and variations
    const classification = await classifyIntent(userMessage, {
      psid,
      lastIntent: convo.lastIntent,
      campaignRef: convo.campaignRef
    });

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
    if (productKeywordRegex.test(cleanMsg)) {
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
