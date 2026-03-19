// ai/flows/resellerFlow.js
// Wholesale flow for reseller-ad conversations.
// Pitch → dimensions → quantity → zip → handoff.
// Detects singular-unit language ("quiero una") to pivot to retail.
// Unrecognized messages escalate to AI instead of dumping to handoff.

const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { parseConfeccionadaDimensions: parseDimensions } = require("../utils/dimensionParsers");
const { MAPS_URL } = require("../../businessInfoManager");
// getCatalogUrl required lazily inside handle() to avoid circular dependency with flowManager
const { sendCatalog } = require("../../utils/sendCatalog");
const { OpenAI } = require("openai");
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

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
  if (!catalogUrl) return false;

  if (channel === 'whatsapp') {
    const phone = psid.replace('wa:', '');
    const { sendWhatsAppMessage } = require('../../channels/whatsapp/api');
    try {
      await sendWhatsAppMessage(phone, {
        type: 'document',
        document: { link: catalogUrl, filename: 'Catalogo_Hanlob.pdf' }
      });
      return true;
    } catch (err) {
      console.error('❌ Error sending WhatsApp catalog:', err.message);
      return false;
    }
  } else {
    const fbPsid = psid.startsWith('fb:') ? psid.replace('fb:', '') : psid;
    const result = await sendCatalog(fbPsid, catalogUrl);
    return result?.fileSent === true;
  }
}

/**
 * Escalate to AI for reseller questions that don't match regex handlers.
 * Returns { response } for text answers, { dimensions } for parsed sizes, or null on failure.
 */
async function escalateToAI(userMessage, convo) {
  try {
    const isBorde = convo?.productInterest === 'borde_separador';
    const adProduct = convo?.adMainProductName || null;
    const lastBotMsg = convo?.lastBotResponse || null;
    const userName = convo?.userName || null;

    let contextLines = [];
    if (userName) contextLines.push(`Nombre del cliente: ${userName}`);
    if (adProduct) contextLines.push(`Anuncio de Facebook que trajo al cliente: ${adProduct}`);
    if (lastBotMsg) contextLines.push(`Último mensaje del bot: "${lastBotMsg.slice(0, 150)}"`);
    const contextBlock = contextLines.length > 0 ? `\nCONTEXTO:\n${contextLines.join('\n')}\n` : '';

    const productBlock = isBorde
      ? `PRODUCTO: Borde separador de jardín.
- Cinta plástica gruesa de 13cm de alto para delimitar jardín
- Resistente a la intemperie, fácil de instalar
- Se fija al suelo con estacas (se venden por separado)
- Rollos de 18m y 54m
- Compra por Mercado Libre, envío incluido`
      : `PRODUCTO: Malla sombra raschel confeccionada.
- 90% de cobertura, protección UV
- Refuerzo en esquinas, vida útil hasta 5 años
- Ojillos para sujeción cada 80cm, lista para instalar
- Colores: negro y beige
- Medidas desde 2x2m hasta 7x10m
- Compra por Mercado Libre, envío incluido`;

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres asesora de ventas de Hanlob, empresa mexicana fabricante de malla sombra y borde separador.
${contextBlock}
${productBlock}

MODELO DE NEGOCIO PARA REVENDEDORES:
- El negocio es sencillo: compras producto a precio de mayoreo y revendes a tu cliente al precio que tú pongas
- No necesitas local ni inventario grande — con pocas piezas puedes empezar
- Somos fabricantes directos en Querétaro, lo que significa mejores precios
- El envío a todo México está incluido en el precio
- La compra se realiza por Mercado Libre (compra protegida)
- Ideal para ferreterías, viveros, paisajistas, instaladores, o emprendedores
- Más de 5 años vendiendo en Mercado Libre con excelente reputación

DATOS DEL NEGOCIO:
- WhatsApp: +52 442 595 7432
- Horario: Lunes a Viernes 8am-6pm

INSTRUCCIONES:
1. Si el cliente PIDE una medida específica:
   → { "type": "dimensions", "width": <menor lado>, "height": <mayor lado> }

2. Para cualquier otra cosa (pregunta sobre el negocio, cómo funciona, dudas, etc.):
   → { "type": "response", "text": "<tu respuesta>" }
   - Explica el modelo de negocio de forma clara y atractiva
   - Si preguntan "cómo se gana", "de qué se trata", "cómo funciona": explica que compran a mayoreo y revenden
   - Si preguntan algo que no sabes: di que con gusto un especialista le puede ayudar
   - Siempre guía al cliente a dar el siguiente paso (pedir medida o cantidad)

REGLAS:
- Español mexicano, amable y conciso (2-4 oraciones)
- NUNCA incluyas URLs/links (el sistema los agrega después)
- NUNCA inventes precios
- Solo devuelve JSON`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 250,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.type === 'dimensions' && result.width && result.height) {
      const w = Math.min(result.width, result.height);
      const h = Math.max(result.width, result.height);
      if (w > 0 && h > 0 && w <= 100 && h <= 100) {
        return { dimensions: { width: w, height: h } };
      }
    }

    if (result.type === 'response' && result.text) {
      return { response: result.text };
    }

    return null;
  } catch (err) {
    console.error("❌ reseller escalateToAI error:", err.message);
    return null;
  }
}

/**
 * Handle the reseller flow.
 *
 * Stages:
 *  PITCH → send wholesale value proposition
 *  AWAITING_RESPONSE → dimensions given? ask quantity : AI escalation
 *  AWAITING_QUANTITY → quantity given? ask zip
 *  AWAITING_ZIP → zip given? handoff
 *
 * At any stage: singular-unit language → switch to retail flow
 * Unrecognized messages → AI escalation (not immediate handoff)
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

  // ── LOCATION QUESTION (any stage) ──
  if (/\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde\s+(est[aá]n|est[aá]s|se\s+ubica|queda)|tienda\s+f[ií]sica|pueden?\s+ir|puedo\s+ir|recoger|pasar\s+a\s+recoger|visitar(los|les)?|showroom|local|bodega|sucursal)\b/i.test(msg)) {
    console.log(`📍 Reseller flow — location question`);
    return {
      type: "text",
      text: `Estamos en Querétaro. Te comparto nuestra ubicación:\n\n${MAPS_URL}\n\nTambién enviamos a todo México con envío incluido.`
    };
  }

  // ── AWAITING QUANTITY ──
  if (lastIntent === 'reseller_awaiting_quantity') {
    // Parse quantity from message
    const qtyMatch = msg.match(/\b(\d+)\s*(?:piezas?|unidades?|mallas?|rollos?|bordes?)?\b/i);
    const wordQty = /\b(un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.exec(msg);
    const WORD_TO_NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
    let quantity = null;

    if (qtyMatch) {
      const n = parseInt(qtyMatch[1]);
      if (n > 0 && n <= 1000) quantity = n;
    } else if (wordQty) {
      quantity = WORD_TO_NUM[wordQty[1].toLowerCase()] || null;
    }

    // Also check if zip is in the same message
    const zipInMsg = msg.match(/\b(\d{5})\b/);

    if (quantity && zipInMsg) {
      const savedSize = convo?.productSpecs?.userExpressedSize || '';
      console.log(`🏪 Reseller flow — qty ${quantity} + CP ${zipInMsg[1]}, handing off`);
      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo — ${quantity} pzas ${savedSize}, CP ${zipInMsg[1]}`,
        responsePrefix: `¡Perfecto! Un especialista te contactará para cotizarte.\n\n`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });
      await updateConversation(psid, { currentFlow: null });
      return { ...handoffResponse, handledBy: "reseller" };
    }

    if (quantity) {
      await updateConversation(psid, {
        lastIntent: 'reseller_awaiting_zip',
        productSpecs: { ...convo?.productSpecs, quantity }
      });
      return { type: "text", text: "¿Cuál es tu código postal para cotizar el envío?" };
    }

    // Maybe they gave a zip instead of quantity
    if (zipInMsg) {
      const savedSize = convo?.productSpecs?.userExpressedSize || '';
      console.log(`🏪 Reseller flow — skipped quantity, got zip ${zipInMsg[1]}, handing off`);
      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo — ${savedSize}, CP ${zipInMsg[1]}`,
        responsePrefix: `¡Perfecto! Un especialista te contactará para cotizarte.\n\n`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });
      await updateConversation(psid, { currentFlow: null });
      return { ...handoffResponse, handledBy: "reseller" };
    }

    // New dimensions instead of quantity — update and re-ask quantity
    const newSpecs = extractSpecs(msg, isBorde);
    if (newSpecs) {
      await updateConversation(psid, {
        productSpecs: { userExpressedSize: newSpecs.sizeStr, width: newSpecs.width, height: newSpecs.height }
      });
      return { type: "text", text: "¿Cuántas piezas necesitas?" };
    }

    // Not a quantity, zip, or dimensions — escalate to AI
    console.log(`🏪 Reseller flow (awaiting_quantity) — escalating to AI: "${msg.substring(0, 60)}"`);
    const aiResult = await escalateToAI(msg, convo);

    if (aiResult?.dimensions) {
      const { width, height } = aiResult.dimensions;
      const sizeStr = `${width}x${height}m`;
      await updateConversation(psid, {
        productSpecs: { userExpressedSize: sizeStr, width, height }
      });
      return { type: "text", text: "¿Cuántas piezas necesitas?" };
    }

    if (aiResult?.response) {
      return { type: "text", text: aiResult.response };
    }

    return { type: "text", text: "¿Cuántas piezas necesitas?" };
  }

  // ── AWAITING ZIP ──
  if (lastIntent === 'reseller_awaiting_zip') {
    const zipMatch = msg.match(/\b(\d{5})\b/);

    if (zipMatch) {
      const zip = zipMatch[1];
      const savedSize = convo?.productSpecs?.userExpressedSize || '';
      const qty = convo?.productSpecs?.quantity;
      const qtyStr = qty ? `${qty} pzas ` : '';
      console.log(`🏪 Reseller flow — zip ${zip}, handing off`);

      const handoffResponse = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo — ${qtyStr}${savedSize}, CP ${zip}`,
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

    // Not a zip or dimensions — escalate to AI
    console.log(`🏪 Reseller flow (awaiting_zip) — escalating to AI: "${msg.substring(0, 60)}"`);
    const aiResult = await escalateToAI(msg, convo);

    if (aiResult?.dimensions) {
      const { width, height } = aiResult.dimensions;
      const sizeStr = `${width}x${height}m`;
      await updateConversation(psid, {
        lastIntent: 'reseller_awaiting_quantity',
        productSpecs: { userExpressedSize: sizeStr, width, height }
      });
      return { type: "text", text: "¿Cuántas piezas necesitas?" };
    }

    if (aiResult?.response) {
      return { type: "text", text: aiResult.response };
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

    // Dimensions but no zip → ask for quantity
    console.log(`🏪 Reseller flow — ${specs.sizeStr}, asking for quantity`);
    await updateConversation(psid, {
      lastIntent: 'reseller_awaiting_quantity',
      productSpecs: { userExpressedSize: specs.sizeStr, width: specs.width, height: specs.height }
    });

    return { type: "text", text: `¿Cuántas piezas necesitas?` };
  }

  // ── NO DIMENSIONS — escalate to AI instead of dumping to handoff ──
  console.log(`🏪 Reseller flow — no dimensions, escalating to AI: "${msg.substring(0, 60)}"`);
  const aiResult = await escalateToAI(msg, convo);

  if (aiResult?.dimensions) {
    const { width, height } = aiResult.dimensions;
    const sizeStr = `${width}x${height}m`;
    console.log(`🏪 Reseller flow — AI parsed dimensions ${sizeStr}`);
    await updateConversation(psid, {
      lastIntent: 'reseller_awaiting_quantity',
      productSpecs: { userExpressedSize: sizeStr, width, height }
    });
    return { type: "text", text: "¿Cuántas piezas necesitas?" };
  }

  if (aiResult?.response) {
    await updateConversation(psid, { lastIntent: 'reseller_ai_answered' });
    return { type: "text", text: aiResult.response };
  }

  // AI failed — fall back to catalog + handoff
  console.log(`🏪 Reseller flow — AI failed, falling back to catalog + handoff`);
  const catalogUrl = await getCatalogUrl(convo, convo?.productInterest || 'malla_sombra');
  const catalogSent = await sendCatalogToUser(catalogUrl, psid, channel);

  const handoffResponse = await executeHandoff(psid, convo, userMessage, {
    reason: `Mayoreo: "${msg.substring(0, 80)}"`,
    responsePrefix: catalogSent
      ? "Te comparto nuestro catálogo con medidas y precios. Un especialista te contactará para darte más detalles.\n\n"
      : "Un especialista te contactará para darte más detalles sobre precios de mayoreo.\n\n",
    lastIntent: 'wholesale_handoff',
    timingStyle: 'elaborate'
  });

  await updateConversation(psid, { currentFlow: null });
  return { ...handoffResponse, handledBy: "reseller" };
}

module.exports = { shouldHandle, handle, PITCH_MESSAGES, getPitchMessage };
