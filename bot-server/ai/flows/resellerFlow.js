// ai/flows/resellerFlow.js
// Dedicated flow for reseller-ad conversations.
// Owns the first touchpoint: sends a pitch, then routes based on reply
// (reseller interest → catalog + handoff, wholesale → handoff, retail → malla flow).

const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");
const { getCatalogUrl } = require("../flowManager");
const { sendCatalog } = require("../../utils/sendCatalog");
const { INTENTS } = require("../classifier");

const PITCH_MESSAGE =
  `Estamos buscando revendedores para nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV.\n\n` +
  `Viene con refuerzo en las esquinas para una vida útil de hasta 5 años, y con ojillos para sujeción cada 80 cm por lado, lista para instalar. El envío está incluido.\n\n` +
  `Manejamos medidas desde 2x2m hasta 7x10m.\n\n` +
  `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
  `Si solo buscas comprar al mayoreo por favor indícanos la cantidad y tu código postal.\n\n` +
  `Si solo buscas una malla sombra, solo indícanos la medida.`;

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
  if (!convo?.isWholesaleInquiry) return false;

  const currentFlow = convo?.currentFlow || 'default';
  if (currentFlow !== 'default') return false;

  const lastIntent = convo?.lastIntent || '';

  // Already in the reseller flow
  if (lastIntent.startsWith('reseller_')) return true;

  // No product-specific intent yet (first contact)
  const hasProductIntent = lastIntent.startsWith('malla_') ||
    lastIntent.startsWith('borde_') ||
    lastIntent.startsWith('rollo_') ||
    lastIntent === 'wholesale_handoff' ||
    lastIntent === 'handoff';

  if (!hasProductIntent) return true;

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
  const lastIntent = convo?.lastIntent || '';

  // ── Stage: PITCH ──
  // First message for a reseller-ad conversation
  if (!lastIntent.startsWith('reseller_')) {
    console.log(`🏪 Reseller flow — sending pitch`);
    await updateConversation(psid, { lastIntent: 'reseller_pitch_sent' });
    return { type: "text", text: PITCH_MESSAGE };
  }

  // ── Stage: AWAITING_RESPONSE ──
  if (lastIntent === 'reseller_pitch_sent') {
    const msg = String(userMessage || '').trim();
    const intent = classification?.intent;

    // --- Path 1: Reseller interest ---
    if (RESELLER_PATTERNS.test(msg) || intent === INTENTS.CONFIRMATION) {
      console.log(`🏪 Reseller flow — reseller confirmed, sending catalog + handoff`);

      const catalogUrl = await getCatalogUrl(convo, 'malla_sombra');
      const channel = convo?.channel || (psid.startsWith('wa:') ? 'whatsapp' : 'facebook');

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

      return { ...handoffResponse, handledBy: "reseller" };
    }

    // --- Path 2: Wholesale buyer ---
    const hasQuantity = WHOLESALE_QUANTITY_PATTERN.test(msg);
    const hasMayoreo = WHOLESALE_KEYWORD.test(msg);
    if (hasQuantity || hasMayoreo) {
      console.log(`🏪 Reseller flow — wholesale buyer detected, handoff`);

      const dims = parseDimensions(msg);
      const sizeInfo = dims ? ` — medida ${dims.userExpressed || dims.normalized}` : '';

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo desde anuncio revendedor${sizeInfo}: "${msg.substring(0, 80)}"`,
        responsePrefix: "¡Claro! Para pedidos de mayoreo te comunico con un especialista.\n\n",
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });

      return { ...handoffResponse, handledBy: "reseller" };
    }

    // --- Path 3: Retail buyer (gives dimensions) ---
    const dimensions = parseDimensions(msg);
    if (dimensions) {
      console.log(`🏪 Reseller flow — retail buyer detected (${dimensions.normalized}), breaking out to malla flow`);

      await updateConversation(psid, {
        isWholesaleInquiry: false,
        currentFlow: 'malla_sombra',
        lastIntent: null
      });

      // Return null so the message gets re-processed by the malla flow
      return null;
    }

    // --- Fallback: not clear yet, re-send a shorter prompt ---
    console.log(`🏪 Reseller flow — unclear response, asking to clarify`);
    await updateConversation(psid, { lastIntent: 'reseller_pitch_sent' });
    return {
      type: "text",
      text: "¿Te interesa ser distribuidor, o buscas comprar malla sombra para uso propio? Si solo necesitas una pieza, indícanos la medida."
    };
  }

  // Already handed off or past the reseller stage — don't interfere
  return null;
}

module.exports = { shouldHandle, handle };
