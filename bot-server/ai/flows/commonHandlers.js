// ai/flows/commonHandlers.js
// Shared "master flow" handlers inherited by all product flows.
// Each product flow calls checkCommonHandlers() early in its handle().
// If a common handler matches, the flow returns its response immediately.
//
// PRINCIPLE: Regex only handles when the FULL message is about that topic.
// If the message has product-specific content (dimensions, mixed topics),
// skip all common handlers → let the flow's AI escalation handle the full message.
//
// flowContext = {
//   salesChannel: 'mercado_libre' | 'direct',
//   productName: string,           // e.g. "malla sombra confeccionada"
//   installationNote: string|null, // product-specific installation info
// }

const { getBusinessInfo, MAPS_URL } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");
const { classifyLocationIntent } = require("../utils/locationIntent");

/**
 * Check if the message is a standalone common question (no product-specific content mixed in).
 * If the message contains dimensions, multiple topics, or product specs, it's NOT standalone
 * and should be handled by the flow's AI which can digest the full message.
 */
function isStandaloneQuestion(userMessage) {
  const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");

  // Message contains product dimensions → not standalone
  if (parseDimensions(userMessage)) return false;

  // Multiple topics joined by conjunctions → not standalone
  if (/\b(y\s+(?:también|aparte|además)|también\s+(?:quiero|necesito|me\s+(?:dan|pasan|interesa))|además\s+(?:de|quiero|necesito)|aparte\s+de|otra\s+(?:cosa|pregunta|duda))\b/i.test(userMessage)) return false;

  return true;
}

/**
 * Check all common handlers. Returns a response object or null.
 * Call this early in each flow's handle() — before stage-specific logic.
 */
async function checkCommonHandlers(userMessage, convo, psid, flowContext) {
  if (!userMessage) return null;
  const msg = userMessage.toLowerCase();

  // ── GUARD: If message has product-specific content, skip all common handlers ──
  // The flow's AI escalation will handle the full message with DB context.
  // Exception: farewell after quote (handler #5) — "gracias" after a quote is always standalone.
  // Exception: human escalation (handler #2) — always respect the request to talk to a person.

  const standalone = isStandaloneQuestion(userMessage);

  // ── 1. PHONE / CONTACT REQUEST ──
  if (standalone) {
    const isPhoneRequest =
      /\b(tel[eé]fon\w*|whatsapp|celular)\b/i.test(userMessage) ||
      /\b(nu?m(ero)?)\s*(de\s*)?(tel[eé]fon\w*|contacto|celular)\b/i.test(userMessage) ||
      /\b(llamar|contactar|ll[aá]m[ae]me|me\s+llam[ae]n|pueden?\s+llamar)\b/i.test(userMessage);
    if (isPhoneRequest) {
      console.log(`📞 [common] Phone request in ${flowContext.flowType}`);
      const info = await getBusinessInfo();
      await updateConversation(psid, { lastIntent: 'phone_request', unknownCount: 0 });
      return {
        type: "text",
        text: `¡Claro! Nuestro número es:\n\n` +
              `📞 ${info?.phones?.[0] || "442 352 1646"}\n` +
              `💬 WhatsApp: https://wa.me/524423521646\n\n` +
              `🕓 Horario: ${info?.hours || "Lun-Vie 8am-6pm"}\n\n` +
              `También puedes comprar directamente por Mercado Libre con envío incluido.`
      };
    }
  }

  // ── 2. HUMAN ESCALATION ── (always respected, even in mixed messages)
  const wantsHuman =
    /\b(hablar|comunicar(me|nos)?|platicar|contactar)\s+(con\s+)?(un[ao]?\s+)?(especialista|asesor[a]?|persona|humano|agente|ejecutiv[oa]|vendedor[a]?|alguien|representante)\b/i.test(userMessage) ||
    /\b(oportunidad|posibilidad|forma|manera)\s+de\s+(hablar|comunicar|contactar|platicar)\b/i.test(userMessage) ||
    /\b(me\s+(comunican?|pasan?|transfier[ae]n?|conect[ae]n?)\s+con)\b/i.test(userMessage) ||
    /\b(atenci[oó]n\s+(personalizada|directa|humana|personal))\b/i.test(userMessage) ||
    /\b(quiero|necesito|ocupo|requiero)\s+(hablar|comunicarme|que\s+me\s+(llam|atiend|contact))\b/i.test(userMessage);
  if (wantsHuman) {
    console.log(`🙋 [common] Human escalation request in ${flowContext.flowType}`);
    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Cliente pide hablar con un especialista: "${userMessage.substring(0, 80)}"`,
      responsePrefix: 'Con gusto te comunico con un especialista.',
      lastIntent: 'human_escalation',
      timingStyle: 'elaborate'
    });
  }

  // All remaining handlers require standalone messages
  if (!standalone) return null;

  // ── 3. TRUST / SCAM CONCERN ──
  if (/\b(estaf\w*|fraude|timo|enga[ñn]\w*|desconfian\w*|no\s+conf[ií]\w*|conf[ií]ar|conf[ií]able|miedo|me\s+da\s+pendiente|es\s+segur[oa]|ser[áa]\s+segur[oa]|le\s+pienso|le\s+pienzo)\b/i.test(msg)) {
    console.log(`🛡️ [common] Trust concern in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'trust_concern', unknownCount: 0 });

    if (flowContext.salesChannel === 'direct') {
      return {
        type: "text",
        text: "Entiendo tu preocupación. Somos fabricantes directos en Querétaro con más de 5 años de experiencia. " +
              "La compra es directa con nosotros — te damos factura y comprobante de envío.\n\n" +
              "Si gustas, podemos platicar por WhatsApp: +52 442 595 7432"
      };
    }
    return {
      type: "text",
      text: "Entiendo tu preocupación, y es muy válida. La compra se realiza por Mercado Libre, " +
            "así que cuentas con su programa de *compra protegida*: si no te llega, llega defectuoso " +
            "o diferente, te devuelven tu dinero.\n\n" +
            "Somos fabricantes en Querétaro con más de 5 años vendiendo en Mercado Libre."
    };
  }

  // ── 4. PAY ON DELIVERY ──
  if (/\b(contra\s*entrega|pag[oa]\s*(al|contra|cuando)\s*(recib|entreg)|cobr\w*\s*(al|cuando)\s*entreg|al\s+recibir\s*(se\s+)?pag|se\s+pag[aá]\s+al\s+recibir)\b/i.test(msg)) {
    console.log(`💳 [common] Pay-on-delivery in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'pay_on_delivery', unknownCount: 0 });

    if (flowContext.salesChannel === 'direct') {
      return {
        type: "text",
        text: "No manejamos pago contra entrega. El pago es 100% por adelantado mediante " +
              "transferencia o depósito bancario. Te enviamos factura y comprobante de envío."
      };
    }
    return {
      type: "text",
      text: "No manejamos pago contra entrega. El pago es 100% por adelantado al momento de " +
            "ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, " +
            "se te devuelve tu dinero."
    };
  }

  // ── 5. FAREWELL AFTER QUOTE ──
  // Customer says thanks/goodbye after receiving a quote — don't re-quote
  if (convo?.lastSharedProductLink) {
    const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");
    const hasNoDimensions = !parseDimensions(userMessage);
    const hasThanks = /\b(gracias|grax|thanks)\b/i.test(userMessage);
    const hasBye = /\b(adi[oó]s|bye|hasta\s*luego|nos\s*vemos)\b/i.test(userMessage);
    const hasNoQuestion = !/[?¿]/.test(userMessage);

    if ((hasThanks || hasBye) && hasNoDimensions && hasNoQuestion) {
      const name = convo?.userName?.split(' ')?.[0] || '';
      await updateConversation(psid, { lastIntent: 'farewell_after_quote', unknownCount: 0 });
      return {
        type: "text",
        text: `¡Con gusto${name ? ', ' + name : ''}! Cualquier duda aquí estoy para ayudarte.`
      };
    }

    // "por eso la estoy pidiendo", "ya la pedí", "ya la compré"
    if (/\b(por\s+eso\s+(la|lo)\s+(pido|estoy|ped[ií])|ya\s+(la|lo)\s+(ped[ií]|compr[eé]|orden[eé])|la\s+estoy\s+pidiendo|eso\s+estoy\s+haciendo|ya\s+(ped[ií]|compr[eé]|orden[eé]))\b/i.test(userMessage)) {
      await updateConversation(psid, { lastIntent: 'customer_buying', unknownCount: 0 });
      return {
        type: "text",
        text: "¡Excelente! Si tienes cualquier duda con tu pedido, aquí estoy para ayudarte."
      };
    }
  }

  // ── 6. LOCATION / ADDRESS ──
  const isLocationQuestion = /\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde\s+(est[aá]n|est[aá]s|se\s+ubica|queda)|tienda\s+f[ií]sica|pueden?\s+ir|puedo\s+ir|recoger|pasar\s+a\s+recoger|visitar(los|les)?|showroom|sucursal)\b/i.test(userMessage);
  if (isLocationQuestion) {
    console.log(`📍 [common] Location question in ${flowContext.flowType}`);
    const locationIntent = classifyLocationIntent(userMessage);

    if (locationIntent === 'sending_theirs') {
      return {
        type: "text",
        text: "¡Perfecto! Mándanos tu ubicación por WhatsApp: https://wa.me/524425957432"
      };
    }

    await updateConversation(psid, { lastIntent: 'location_shared', unknownCount: 0 });
    return {
      type: "text",
      text: `Estamos en Querétaro. Te comparto nuestra ubicación:\n\n${MAPS_URL}\n\n` +
            `También puedes comprar en línea por Mercado Libre con envío incluido a todo México.`
    };
  }

  // ── 7. SHIPPING COST QUESTION ──
  if (/\b(env[ií]o|entreg|paqueter[ií]a|mensajer[ií]a)\b/i.test(msg) &&
      /\b(cu[aá]nto|costo|precio|c[oó]mo|tarda|demora|d[ií]as|incluido|gratis|cobr)\b/i.test(msg)) {
    console.log(`📦 [common] Shipping question in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'shipping_question', unknownCount: 0 });

    // Specific concern about delivery schedule (weekends, not home, pickup)
    if (/\b(fin\s*de\s*semana|s[aá]bado|domingo|no\s+(hay\s+)?nadie|no\s+est[oéa]y|entre\s*semana|horario|d[ií]a\s+espec[ií]fico|recoger|punto\s+de\s+entrega)\b/i.test(msg)) {
      return {
        type: "text",
        text: "El envío depende de Mercado Libre, nosotros no tenemos control sobre los días ni horarios de entrega. " +
              "Sin embargo, ellos cuentan con un servicio muy eficiente e incluso puedes recogerlo en alguna de sus " +
              "oficinas o puntos de entrega cercanos. ¡Tienen muchas opciones!"
      };
    }

    if (flowContext.salesChannel === 'direct') {
      return {
        type: "text",
        text: "El envío se realiza por paquetería a todo México. El costo depende de tu ubicación.\n\n" +
              "¿Me compartes tu código postal para cotizarte el envío?"
      };
    }
    return {
      type: "text",
      text: "El envío está incluido en todas las compras por Mercado Libre. Normalmente tarda de 3 a 5 días hábiles."
    };
  }

  // ── 8. PAYMENT METHOD ──
  if (/\b(forma|m[eé]todo|manera|tipo)\s*(de\s+)?pago\b/i.test(msg) ||
      (/\b(pag[oa]r?|aceptan?|manejan?|reciben?)\b/i.test(msg) &&
       /\b(tarjeta|efectivo|oxxo|meses|d[eé]bito|cr[eé]dito|paypal|spei)\b/i.test(msg))) {
    console.log(`💰 [common] Payment method question in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'payment_question', unknownCount: 0 });

    if (flowContext.salesChannel === 'direct') {
      return {
        type: "text",
        text: "Aceptamos transferencia y depósito bancario. Te enviamos factura y comprobante de envío."
      };
    }
    return {
      type: "text",
      text: "En Mercado Libre puedes pagar con tarjeta de crédito/débito, efectivo en OXXO, " +
            "transferencia bancaria, o hasta en meses sin intereses. Tu compra está protegida."
    };
  }

  // ── 9. INVOICE / FACTURA ──
  if (/\b(factura|facturar|facturaci[oó]n|facturan?)\b/i.test(msg)) {
    console.log(`🧾 [common] Invoice question in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'invoice_question', unknownCount: 0 });

    if (flowContext.salesChannel === 'direct') {
      return {
        type: "text",
        text: "¡Claro que sí! Nosotros te emitimos tu factura directamente. " +
              "Al momento de confirmar tu pedido te pedimos tus datos fiscales."
      };
    }
    return {
      type: "text",
      text: "¡Claro que sí! Mercado Libre genera tu factura automáticamente con los datos fiscales " +
            "que tengas registrados en tu cuenta. Si necesitas factura con otros datos, " +
            "puedes solicitarla directamente desde tu compra en Mercado Libre."
    };
  }

  // ── 10. INSTALLATION ──
  if (/\b(instalaci[oó]n|instal[ae]n?|ponen|colocan|pasan?\s+a\s+medir)\b/i.test(msg) &&
      flowContext.installationNote) {
    console.log(`🔧 [common] Installation question in ${flowContext.flowType}`);
    await updateConversation(psid, { lastIntent: 'installation_query', unknownCount: 0 });
    return {
      type: "text",
      text: `No contamos con servicio de instalación. ${flowContext.installationNote}`
    };
  }

  return null;
}

module.exports = { checkCommonHandlers };
