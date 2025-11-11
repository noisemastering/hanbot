// ai/intentRouter.js
// Smart routing based on AI-classified intents

const { updateConversation } = require("../conversationManager");
const { handleGlobalIntents } = require("./global/intents");
const { handleGreeting, handleThanks } = require("./core/greetings");
const { handleCatalogOverview } = require("./core/catalog");
const { handleFamilyFlow } = require("./core/family");
const { getProduct } = require("../hybridSearch");

/**
 * Route message to appropriate handler based on AI-classified intent
 * @param {string} intent - Classified intent from AI
 * @param {string} message - Original user message
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @param {string} botName - Bot's persona name
 * @returns {object|null} - Response or null if intent not handled
 */
async function routeByIntent(intent, message, psid, convo, botName) {
  const cleanMsg = message.toLowerCase().trim();

  console.log(`🎯 Routing intent: ${intent}`);

  switch (intent) {
    case "greeting":
      return await handleGreeting(cleanMsg, psid, convo, botName);

    case "thanks":
      return await handleThanks(cleanMsg, psid, convo, botName);

    case "catalog_overview":
      return await handleCatalogOverview(cleanMsg, psid);

    case "family_inquiry":
      return await handleFamilyFlow(cleanMsg, psid, convo);

    case "product_search":
      const product = await getProduct(cleanMsg);
      if (product) {
        await updateConversation(psid, {
          lastIntent: "product_search",
          state: "active",
          unknownCount: 0
        });

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
      return null;

    // All measure-related, payment, and purchase intents go to global handler
    case "details_request":  // User asks for more info - show ML link
    case "buying_intent":  // HIGH PRIORITY - conversion critical!
    case "measures_generic":
    case "measures_specific":
    case "measures_guidance":
    case "installation":
    case "shipping":
    case "location":
    case "colors":
    case "payment_methods":  // Payment inquiries - clarify upfront payment
    case "stock_availability":
      return await handleGlobalIntents(cleanMsg, psid, convo);

    case "material_specs":
      // Future: dedicated handler for material specs
      return await handleGlobalIntents(cleanMsg, psid, convo);

    case "unknown":
    default:
      return null; // Will fall through to fallback
  }
}

module.exports = { routeByIntent };
