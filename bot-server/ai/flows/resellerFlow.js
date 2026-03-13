// ai/flows/resellerFlow.js
// Wholesale flow for reseller-ad conversations.
// Pitch → dimensions → zip → handoff.
// Detects singular-unit language ("quiero una") to pivot to retail.

const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");
// getCatalogUrl required lazily inside handle() to avoid circular dependency with flowManager
const { sendCatalog } = require("../../utils/sendCatalog");

const PITCH_MESSAGES = {
  malla_sombra:
    `Estamos buscando revendedores para nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV.\n\n` +
    `Viene con refuerzo en las esquinas para una vida útil de hasta 5 años, y con ojillos para sujeción cada 80 cm por lado, lista para instalar. El envío está incluido.\n\n` +
    `Manejamos medidas desde 2x2m hasta 7x10m.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos la medida y tu código postal.\n\n` +
    `Si solo buscas una malla sombra, solo indícanos la medida.`,
  borde_separador:
    `Somos fabricantes de borde separador de jardín, el complemento perfecto para paisajistas, ferreterías y viveros.\n\n` +
    `Nuestro borde es más grueso y resistente que los de la competencia, fácil de instalar y con alta demanda.\n\n` +
    `Manejamos rollos de 18m y 54m con envío a todo México.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos el largo y tu código postal.\n\n` +
    `Si solo buscas un borde para tu jardín, solo indícanos el largo que necesitas.`
};

function getPitchMessage(productInterest) {
  return PITCH_MESSAGES[productInterest] || PITCH_MESSAGES.malla_sombra;
}

// Singular-unit language → retail signal
// "quiero una", "busco uno", "una malla", "un rollo", "solo una", "nada más una", "para mi casa"
// But NOT plural: "unas mallas", "mallas", "las de 3x4"
const SINGULAR_RETAIL = /\b((?:quiero|busco|necesito|ocupo|llevo|me\s+llevo)\s+un[oa]?\b|(?:solo|solamente|nada\s*m[aá]s|nadamas|nomas|nom[aá]s)\s+un[oa]\b|un[oa]\s+(?:malla|pieza|rollo|borde|unidad)\b|un[oa]\s+(?:nada\s*m[aá]s|nadamas|nomas|nom[aá]s|sol[oa])\b|para\s+mi\s+(?:casa|jard[ií]n|patio|terreno|propiedad)|uso\s+personal|para\s+uso\s+propio|de\s+a\s+un[oa])\b/i;

/**
 * Should this flow handle the message?
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  if (convo?.currentFlow === 'reseller') return true;

  if (convo?.isWholesaleInquiry) {
    const currentFlow = convo?.currentFlow || 'default';
    if (currentFlow === 'default') return true;
  }

  return false;
}

/**
 * Extract dimensions from message (malla WxH or borde lengths)
 */
function extractSpecs(msg, isBorde) {
  if (!msg) return null;

  // Malla: WxH format
  if (!isBorde) {
    const dims = parseDimensions(msg);
    if (dims) return { sizeStr: dims.userExpressed || dims.normalized, width: dims.width, height: dims.height };
    return null;
  }

  // Borde: length with meter suffix
  const meterMatch = msg.match(/\b(\d+)\s*(?:m(?:ts?|etros?)?)\b/i);
  if (meterMatch) return { sizeStr: `${meterMatch[1]}m` };

  // Bare numbers matching common borde lengths
  const bareMatch = msg.match(/\b(6|9|18|54)\b/);
  if (bareMatch) return { sizeStr: `${bareMatch[1]}m` };

  return null;
}

/**
 * Send catalog PDF via the appropriate channel
 */
async function sendCatalogToUser(catalogUrl, psid, channel) {
  if (!catalogUrl) return;

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

/**
 * Handle the reseller flow.
 *
 * Stages:
 *  PITCH → send wholesale value proposition
 *  AWAITING_RESPONSE → dimensions given? ask zip : catalog + handoff
 *  AWAITING_ZIP → zip given? handoff
 *
 * At any stage: singular-unit language → switch to retail flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { getCatalogUrl } = require("../flowManager");
  const lastIntent = convo?.lastIntent || '';
  const msg = String(userMessage || '').trim();
  const channel = convo?.channel || (psid.startsWith('wa:') ? 'whatsapp' : 'facebook');
  const isBorde = convo?.productInterest === 'borde_separador';

  // ── PITCH ──
  if (!lastIntent.startsWith('reseller_')) {
    console.log(`🏪 Reseller flow — sending pitch`);
    await updateConversation(psid, { lastIntent: 'reseller_pitch_sent', currentFlow: 'reseller' });
    return { type: "text", text: getPitchMessage(convo?.productInterest) };
  }

  // ── RETAIL DETECTION (any stage after pitch) ──
  if (SINGULAR_RETAIL.test(msg)) {
    const retailFlow = isBorde ? 'borde_separador' : 'malla_sombra';
    console.log(`🏪 Reseller flow — singular retail detected "${msg.substring(0, 40)}", switching to ${retailFlow}`);

    await updateConversation(psid, {
      isWholesaleInquiry: false,
      currentFlow: retailFlow,
      lastIntent: null
    });

    // If they also gave dimensions, re-process in the retail flow
    const specs = extractSpecs(msg, isBorde);
    if (specs) return null;

    return {
      type: "text",
      text: isBorde
        ? "¡Perfecto! ¿Qué largo necesitas?"
        : "¡Perfecto! ¿Qué medida necesitas? (ejemplo: 3x4m)"
    };
  }

  // ── AWAITING ZIP ──
  if (lastIntent === 'reseller_awaiting_zip') {
    const zipMatch = msg.match(/\b(\d{5})\b/);

    if (zipMatch) {
      const zip = zipMatch[1];
      const savedSize = convo?.productSpecs?.userExpressedSize || '';
      console.log(`🏪 Reseller flow — zip ${zip}, handing off`);

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo — ${savedSize}, CP ${zip}`,
        responsePrefix: `¡Perfecto! Un especialista te contactará para cotizarte.\n\n`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });

      await updateConversation(psid, { currentFlow: null });
      return { ...handoffResponse, handledBy: "reseller" };
    }

    // New dimensions instead of zip — update and re-ask
    const newSpecs = extractSpecs(msg, isBorde);
    if (newSpecs) {
      await updateConversation(psid, {
        productSpecs: { userExpressedSize: newSpecs.sizeStr, width: newSpecs.width, height: newSpecs.height }
      });
      return { type: "text", text: "¿Cuál es tu código postal para cotizar el envío?" };
    }

    return { type: "text", text: "¿Me compartes tu código postal para cotizar el envío?" };
  }

  // ── AFTER PITCH — check for dimensions ──
  const specs = extractSpecs(msg, isBorde);

  if (specs) {
    // Check if zip is also in the message (5-digit number that isn't part of the dimensions)
    const zipCandidates = [...msg.matchAll(/\b(\d{5})\b/g)].map(m => m[1]);
    const zip = zipCandidates.find(z => !specs.sizeStr.includes(z));

    if (zip) {
      // Dimensions + zip → handoff immediately
      console.log(`🏪 Reseller flow — ${specs.sizeStr} + CP ${zip}, handing off`);

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo — ${specs.sizeStr}, CP ${zip}`,
        responsePrefix: `¡Perfecto! Un especialista te contactará para cotizarte.\n\n`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });

      await updateConversation(psid, { currentFlow: null });
      return { ...handoffResponse, handledBy: "reseller" };
    }

    // Dimensions but no zip → ask for zip
    console.log(`🏪 Reseller flow — ${specs.sizeStr}, asking for zip`);
    await updateConversation(psid, {
      lastIntent: 'reseller_awaiting_zip',
      productSpecs: { userExpressedSize: specs.sizeStr, width: specs.width, height: specs.height }
    });

    return { type: "text", text: `¿Cuál es tu código postal para cotizar el envío?` };
  }

  // ── NO DIMENSIONS — catalog + handoff ──
  console.log(`🏪 Reseller flow — no dimensions, catalog + handoff`);

  const catalogUrl = await getCatalogUrl(convo, convo?.productInterest || 'malla_sombra');
  await sendCatalogToUser(catalogUrl, psid, channel);

  const handoffResponse = await executeHandoff(psid, convo, userMessage, {
    reason: `Mayoreo: "${msg.substring(0, 80)}"`,
    responsePrefix: catalogUrl
      ? "Te comparto nuestro catálogo con medidas y precios. Un especialista te contactará para darte más detalles.\n\n"
      : "Un especialista te contactará para darte más detalles sobre precios de mayoreo.\n\n",
    lastIntent: 'wholesale_handoff',
    timingStyle: 'elaborate'
  });

  await updateConversation(psid, { currentFlow: null });
  return { ...handoffResponse, handledBy: "reseller" };
}

module.exports = { shouldHandle, handle, PITCH_MESSAGES, getPitchMessage };
