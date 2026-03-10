// ai/flows/resellerFlow.js
// Dedicated flow for reseller-ad conversations.
// Owns the first touchpoint: sends a pitch, then routes based on reply
// (reseller interest → catalog + handoff, wholesale → handoff, retail → malla flow).

const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");
// getCatalogUrl required lazily inside handle() to avoid circular dependency with flowManager
const { sendCatalog } = require("../../utils/sendCatalog");
const { INTENTS } = require("../classifier");

const PITCH_MESSAGES = {
  malla_sombra:
    `Estamos buscando revendedores para nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV.\n\n` +
    `Viene con refuerzo en las esquinas para una vida útil de hasta 5 años, y con ojillos para sujeción cada 80 cm por lado, lista para instalar. El envío está incluido.\n\n` +
    `Manejamos medidas desde 2x2m hasta 7x10m.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos la cantidad y tu código postal.\n\n` +
    `Si solo buscas una malla sombra, solo indícanos la medida.`,
  borde_separador:
    `Somos fabricantes de borde separador de jardín, el complemento perfecto para paisajistas, ferreterías y viveros.\n\n` +
    `Nuestro borde es más grueso y resistente que los de la competencia, fácil de instalar y con alta demanda.\n\n` +
    `Manejamos rollos de 18m y 54m con envío a todo México.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos la cantidad y tu código postal.\n\n` +
    `Si solo buscas un borde para tu jardín, solo indícanos el largo que necesitas.`
};

// Default pitch (backwards compatibility)
const PITCH_MESSAGE = PITCH_MESSAGES.malla_sombra;

function getPitchMessage(productInterest) {
  return PITCH_MESSAGES[productInterest] || PITCH_MESSAGE;
}

// ── Detection patterns ──

const RESELLER_PATTERNS = /\b(distribui|revend|cat[aá]logo|lista\s*(?:de\s*)?precios?|red\s*distribuid|ampliar\s*cat[aá]logo|mi\s+negocio|mi\s+tienda|mi\s+ferreter[ií]a)\b/i;
const WHOLESALE_QUANTITY_PATTERN = /\b\d+\s*(piezas?|unidades?|mallas?)\b/i;
const WHOLESALE_KEYWORD = /\b(mayoreo|al\s*por\s*mayor|mayor)\b/i;

/**
 * Should this flow handle the message?
 *
 * Activates when:
 *  - convo.isWholesaleInquiry === true (set by purchase-intent scorer for reseller ads)
 *  - currentFlow is 'default' or unset (hasn't entered a product flow)
 *  - lastIntent starts with 'reseller_' OR no product-specific intent yet
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  // Primary governance: currentFlow lock-in (same as all other flows)
  if (convo?.currentFlow === 'reseller') return true;

  // Secondary: wholesale inquiry detected outside ad path (e.g., user typed "mayoreo")
  // Only activate if no product flow has claimed the conversation yet
  if (convo?.isWholesaleInquiry) {
    const currentFlow = convo?.currentFlow || 'default';
    if (currentFlow === 'default') return true;
  }

  return false;
}

/**
 * Handle the reseller flow.
 *
 * Stages:
 *  PITCH → send value proposition
 *  AWAITING_RESPONSE → parse reply → route to reseller/wholesale/retail path
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { getCatalogUrl } = require("../flowManager");
  const lastIntent = convo?.lastIntent || '';

  // ── Stage: PITCH ──
  // First message for a reseller-ad conversation.
  // Always send the pitch — even if the message has dimensions or retail signals,
  // we need to confirm intent before changing flow.
  if (!lastIntent.startsWith('reseller_')) {
    console.log(`🏪 Reseller flow — sending pitch`);
    await updateConversation(psid, { lastIntent: 'reseller_pitch_sent' });
    return { type: "text", text: getPitchMessage(convo?.productInterest) };
  }

  // ── Stage: AWAITING_RESPONSE ──
  if (lastIntent === 'reseller_pitch_sent') {
    const msg = String(userMessage || '').trim();
    const intent = classification?.intent;

    const channel = convo?.channel || (psid.startsWith('wa:') ? 'whatsapp' : 'facebook');

    // --- Path 1: Reseller interest ---
    if (RESELLER_PATTERNS.test(msg) || intent === INTENTS.CONFIRMATION) {
      console.log(`🏪 Reseller flow — reseller confirmed, sending catalog + handoff`);

      const catalogUrl = await getCatalogUrl(convo, 'malla_sombra');

      if (catalogUrl) {
        if (channel === 'whatsapp') {
          const phone = psid.replace('wa:', '');
          const { sendWhatsAppMessage } = require('../../channels/whatsapp/api');
          try {
            await sendWhatsAppMessage(phone, {
              type: 'document',
              document: { link: catalogUrl, filename: 'Catalogo_Hanlob.pdf' }
            });
          } catch (err) {
            console.error('❌ Error sending WhatsApp catalog:', err.message);
          }
        } else {
          const fbPsid = psid.startsWith('fb:') ? psid.replace('fb:', '') : psid;
          await sendCatalog(fbPsid, catalogUrl);
        }
      }

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Revendedor interesado: "${msg.substring(0, 80)}"`,
        responsePrefix: catalogUrl
          ? "Te comparto nuestro catálogo con medidas y precios. Un especialista te contactará para darte más detalles sobre cómo ser parte de nuestra red de distribuidores.\n\n"
          : "Un especialista te contactará para darte información sobre cómo ser parte de nuestra red de distribuidores.\n\n",
        lastIntent: 'reseller_catalog_sent',
        notificationText: `Revendedor interesado: "${msg.substring(0, 60)}"`,
        timingStyle: 'elaborate',
        includeQueretaro: false
      });

      // Release currentFlow so other flows can handle post-handoff questions
      await updateConversation(psid, { currentFlow: null });

      return { ...handoffResponse, handledBy: "reseller" };
    }

    // --- Path 2: Wholesale buyer ---
    const hasQuantity = WHOLESALE_QUANTITY_PATTERN.test(msg);
    const hasMayoreo = WHOLESALE_KEYWORD.test(msg);
    if (hasQuantity || hasMayoreo) {
      console.log(`🏪 Reseller flow — wholesale buyer detected, handoff`);

      const dims = parseDimensions(msg);
      const sizeInfo = dims ? ` — medida ${dims.userExpressed || dims.normalized}` : '';

      // Send price list / catalog before handoff
      const wholesaleCatalogUrl = await getCatalogUrl(convo, 'malla_sombra');
      if (wholesaleCatalogUrl) {
        if (channel === 'whatsapp') {
          const phone = psid.replace('wa:', '');
          const { sendWhatsAppMessage } = require('../../channels/whatsapp/api');
          try {
            await sendWhatsAppMessage(phone, {
              type: 'document',
              document: { link: wholesaleCatalogUrl, filename: 'Catalogo_Hanlob.pdf' }
            });
          } catch (err) {
            console.error('❌ Error sending WhatsApp catalog:', err.message);
          }
        } else {
          const fbPsid = psid.startsWith('fb:') ? psid.replace('fb:', '') : psid;
          await sendCatalog(fbPsid, wholesaleCatalogUrl);
        }
      }

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo desde anuncio revendedor${sizeInfo}: "${msg.substring(0, 80)}"`,
        responsePrefix: wholesaleCatalogUrl
          ? "Te comparto nuestra lista de precios. Un especialista te contactará para darte la cotización de mayoreo.\n\n"
          : "¡Claro! Para pedidos de mayoreo te comunico con un especialista.\n\n",
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });

      // Release currentFlow so other flows can handle post-handoff questions
      await updateConversation(psid, { currentFlow: null });

      return { ...handoffResponse, handledBy: "reseller" };
    }

    // --- Path 3: Retail intent (wants to buy, not resell) ---
    const RETAIL_PATTERNS = /\b(busco\s+comprar|quiero\s+comprar|solo\s+(quiero\s+)?comprar|para\s+uso\s+propio|comprar\s+una|quiero\s+una|necesito\s+una|una\s+pieza|una\s+malla|solo\s+una|para\s+mi|uso\s+personal)\b/i;
    if (RETAIL_PATTERNS.test(msg)) {
      const retailFlow = convo?.productInterest === 'borde_separador' ? 'borde_separador' : 'malla_sombra';
      console.log(`🏪 Reseller flow — retail intent "${msg.substring(0, 40)}", switching to ${retailFlow}`);

      await updateConversation(psid, {
        isWholesaleInquiry: false,
        currentFlow: retailFlow,
        lastIntent: null
      });

      // Check if they also gave dimensions in the same message
      const dims = parseDimensions(msg);
      if (dims) {
        // Return null to re-process with dimensions in the retail flow
        return null;
      }

      // No dimensions yet — ask for them naturally
      return {
        type: "text",
        text: convo?.productInterest === 'borde_separador'
          ? "¡Perfecto! ¿Qué largo necesitas?"
          : "¡Perfecto! ¿Qué medida necesitas? (ejemplo: 3x4m)"
      };
    }

    // --- Path 4: Retail buyer (gives dimensions directly) ---
    const dimensions = parseDimensions(msg);
    if (dimensions) {
      // Break out to the ad's product flow (malla by default, borde if that's what the ad sells)
      const retailFlow = convo?.productInterest === 'borde_separador' ? 'borde_separador' : 'malla_sombra';
      console.log(`🏪 Reseller flow — retail buyer detected (${dimensions.normalized}), breaking out to ${retailFlow} flow`);

      await updateConversation(psid, {
        isWholesaleInquiry: false,
        currentFlow: retailFlow,
        lastIntent: null
      });

      // Return null so the message gets re-processed by the appropriate flow
      return null;
    }

    // --- Fallback: not clear yet, re-send a shorter prompt ---
    console.log(`🏪 Reseller flow — unclear response, asking to clarify`);
    await updateConversation(psid, { lastIntent: 'reseller_pitch_sent' });
    const isBorde = convo?.productInterest === 'borde_separador';
    return {
      type: "text",
      text: isBorde
        ? "¿Te interesa ser distribuidor, o buscas comprar borde separador para uso propio? Si solo necesitas uno, indícanos el largo."
        : "¿Te interesa ser distribuidor, o buscas comprar malla sombra para uso propio? Si solo necesitas una pieza, indícanos la medida."
    };
  }

  // Already handed off or past the reseller stage — don't interfere
  return null;
}

module.exports = { shouldHandle, handle, PITCH_MESSAGE, PITCH_MESSAGES, getPitchMessage };
