// ai/flows/promo6x4Flow.js
// Promo flow for malla sombra confeccionada — pitches featured products from ad's promoProducts.
// Combines masterFlow-style AI common question handling with promo product pitching.
//
// Architecture:
// 1. Embedded _handleCommonQuestions (from masterFlow blueprint — NOT imported)
// 2. Promo product pitch for purchase/price questions
// 3. Dimension handling for other sizes from the same family
//
// Does NOT limit the flow — other products from the same family can still be offered.

const { OpenAI } = require("openai");
const { getBusinessInfo, MAPS_URL, STORE_ADDRESS } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { isBusinessHours } = require("../utils/businessHours");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const Ad = require("../../models/Ad");
const { resolveWithAI } = require("../utils/flowFallback");
const {
  parseConfeccionadaDimensions: parseDimensions,
  extractAllDimensions
} = require("../utils/dimensionParsers");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const STAGES = {
  START: "start",
  AWAITING_DIMENSIONS: "awaiting_dimensions",
  COMPLETE: "complete"
};

function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Get promo products from the ad's promoProducts field.
 * Returns populated ProductFamily documents.
 */
async function getPromoProducts(convo) {
  if (!convo?.adId) return [];

  try {
    const ad = await Ad.findOne({ fbAdId: convo.adId })
      .populate("promoProducts")
      .lean();

    if (!ad?.promoProducts?.length) return [];

    return ad.promoProducts.filter(p => p.active && p.sellable && p.price > 0);
  } catch (err) {
    console.error("❌ [6x4_promo] Error loading promo products:", err.message);
    return [];
  }
}

/**
 * Build the promo pitch message with tracked product links.
 * Returns { text, quotedProducts } or null.
 */
async function buildPromoPitch(promoProducts, psid, convo) {
  if (!promoProducts.length) return null;

  const parts = [];
  const quotedProducts = [];

  for (const product of promoProducts) {
    const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url
      || product.onlineStoreLinks?.[0]?.url;

    const dims = parseDimensions(product.name || product.size || '');
    const sizeDisplay = dims ? `${dims.width}x${dims.height}m` : (product.size || product.name);

    if (productUrl) {
      const trackedLink = await generateClickLink(psid, productUrl, {
        productName: product.name,
        productId: product._id,
        reason: 'promo_pitch'
      });

      parts.push(`• ${sizeDisplay} — ${formatMoney(product.price)} con envío incluido\n  🛒 ${trackedLink}`);

      quotedProducts.push({
        width: dims?.width, height: dims?.height,
        displayText: sizeDisplay,
        price: product.price,
        productId: product._id?.toString(),
        productUrl,
        productName: product.name
      });
    } else {
      parts.push(`• ${sizeDisplay} — ${formatMoney(product.price)}`);
      quotedProducts.push({
        width: dims?.width, height: dims?.height,
        displayText: sizeDisplay,
        price: product.price,
        productId: product._id?.toString(),
        productName: product.name
      });
    }
  }

  return { text: parts.join('\n\n'), quotedProducts };
}

/**
 * Find matching malla confeccionada products by size.
 */
async function findMatchingProducts(width, height) {
  try {
    const w = Math.min(Math.round(width), Math.round(height));
    const h = Math.max(Math.round(width), Math.round(height));

    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`, 'i'
    );

    const products = await ProductFamily.find({
      sellable: true, active: true, size: sizeRegex
    }).sort({ price: 1 }).lean();

    // Exclude rolls (any dimension >= 50m)
    return products.filter(p => {
      const match = p.size?.match(/(\d+)\s*[xX×]\s*(\d+)/);
      if (!match) return true;
      return Math.max(parseInt(match[1]), parseInt(match[2])) < 50;
    });
  } catch (err) {
    console.error("❌ [6x4_promo] Error finding products:", err.message);
    return [];
  }
}

// ============================================================
// EMBEDDED COMMON QUESTION HANDLER (masterFlow blueprint copy)
// ============================================================

async function _handleCommonQuestions(userMessage, convo, psid) {
  if (!userMessage) return null;

  try {
    const info = await getBusinessInfo();
    const afterHours = !isBusinessHours();

    const systemPrompt = `Eres asesora de ventas de Hanlob, empresa mexicana fabricante de malla sombra.
Tu trabajo es clasificar el mensaje del cliente y responder SI es una pregunta general.
Si el mensaje es sobre un PRODUCTO ESPECÍFICO (medidas, cotización, colores, porcentaje de sombra, comparación de productos, compra, "dónde compro", "cómo compro", "me interesa"), NO respondas — devuelve product_specific.

PRODUCTO ACTUAL: Malla sombra confeccionada

CANAL DE VENTA: Mercado Libre.
- Pago: 100% por adelantado al ordenar en Mercado Libre (tarjeta crédito/débito, OXXO, transferencia, meses sin intereses).
- Envío: INCLUIDO en todas las compras por Mercado Libre. Tarda aprox 3-5 días hábiles.
- Compra protegida: si no llega, llega defectuoso o diferente, Mercado Libre devuelve el dinero.
- Factura: Mercado Libre la genera automáticamente con los datos fiscales del cliente.

DATOS DEL NEGOCIO:
- Ubicación: Querétaro, Microparque Industrial Navex Park, Tlacote
- Dirección: ${STORE_ADDRESS || 'Microparque Industrial Navex Park, Tlacote, Querétaro'}
- Google Maps: ${MAPS_URL}
- Teléfono: ${info?.phones?.[0] || '442 352 1646'}
- WhatsApp: https://wa.me/524425957432
- Horario: ${info?.hours || 'Lun-Vie 8am-6pm'}
- Envío a todo México y Estados Unidos
- Más de 5 años de experiencia como fabricantes
${afterHours ? '- FUERA DE HORARIO: si el cliente necesita un especialista, menciona que le contactarán el siguiente día hábil.' : ''}

REGLAS DE PAGO:
- NUNCA digas que tenemos pago contra entrega — NO lo manejamos.
- SIEMPRE di "100% por adelantado", nunca frases ambiguas.

INSTALACIÓN: No contamos con servicio de instalación. Viene con ojillos para sujeción cada 80 cm, lista para instalar.

INSTRUCCIONES:
Clasifica el mensaje y responde con JSON:

1. Si el cliente pide hablar con un humano/especialista/asesor:
   → { "type": "handoff", "reason": "<razón breve>" }

2. Si es una pregunta general que puedes responder con los datos de arriba (envío, pago, ubicación, factura, instalación, teléfono, confianza/seguridad, horario, etc.):
   → { "type": "response", "text": "<respuesta>", "intent": "<tema>" }
   Temas: phone_request, trust_concern, pay_on_delivery, location, shipping, payment_method, invoice, installation, farewell, general

3. Si es un agradecimiento o despedida (gracias, adiós, bye) sin pregunta adicional:
   → { "type": "response", "text": "<despedida breve>", "intent": "farewell" }

4. Si es sobre un producto específico o si NO estás seguro:
   → { "type": "product_specific" }

REGLAS:
- Español mexicano, amable y conciso (2-4 oraciones máximo)
- NUNCA inventes precios ni medidas
- NUNCA incluyas URLs en tu respuesta EXCEPTO el link de Google Maps cuando pregunten ubicación y el WhatsApp cuando compartan el teléfono
- Si tienes duda entre "general" y "producto específico", SIEMPRE devuelve product_specific
- Solo devuelve JSON, nada más`;

    const userContext = [];
    if (convo?.userName) userContext.push(`Nombre: ${convo.userName}`);
    if (convo?.lastSharedProductLink) userContext.push(`(Ya se le compartió un link de compra previamente)`);
    if (convo?.lastBotResponse) userContext.push(`Último mensaje del bot: "${convo.lastBotResponse.slice(0, 120)}"`);
    const contextStr = userContext.length > 0 ? `\n[Contexto: ${userContext.join(' | ')}]` : '';

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userMessage}${contextStr}` }
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`🏛️ [6x4_promo] AI classified: ${result.type}${result.intent ? ` (${result.intent})` : ''}`);

    if (result.type === 'handoff') {
      return await executeHandoff(psid, convo, userMessage, {
        reason: result.reason || 'Cliente pide hablar con un especialista',
        responsePrefix: result.text || 'Con gusto te comunico con un especialista.',
        lastIntent: 'human_escalation',
        timingStyle: 'elaborate'
      });
    }

    if (result.type === 'response' && result.text) {
      await updateConversation(psid, {
        lastIntent: result.intent || 'promo_common_response',
        unknownCount: 0
      });
      return { type: "text", text: result.text };
    }

    // product_specific → let promo flow handle
    return null;

  } catch (err) {
    console.error(`❌ [6x4_promo] Common questions error:`, err.message);
    return null;
  }
}

// ============================================================
// MAIN FLOW HANDLER
// ============================================================

function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    width: specs.width || null,
    height: specs.height || null,
    color: specs.color || null,
    quantity: specs.quantity || null
  };
}

async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  // ====== PENDING HANDOFF ======
  if (convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('../utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) return pendingResult;
  }

  const state = getFlowState(convo);
  console.log(`🎁 [6x4_promo] Message: "${userMessage?.slice(0, 60)}"`);

  // ====== LOAD PROMO PRODUCTS ======
  const promoProducts = await getPromoProducts(convo);
  console.log(`🎁 [6x4_promo] Promo products: ${promoProducts.length}`);

  // ====== COMMON QUESTIONS (masterFlow embedded) ======
  const commonResponse = await _handleCommonQuestions(userMessage, convo, psid);
  if (commonResponse) return commonResponse;

  // ====== AI FALLBACK FOR QUOTED PRODUCTS ======
  // When we've already pitched products, let AI interpret confirmations,
  // selections, and follow-up questions (no regex).
  if (convo?.lastQuotedProducts?.length > 0) {
    const aiResult = await resolveWithAI({
      psid, userMessage,
      flowType: 'malla',
      stage: convo?.lastIntent || 'promo',
      basket: convo?.productSpecs,
      lastQuotedProducts: convo.lastQuotedProducts
    });

    if (aiResult.confidence >= 0.7) {
      if (aiResult.action === 'select_products' || aiResult.action === 'select_one') {
        const indices = aiResult.action === 'select_products'
          ? aiResult.selectedIndices
          : [aiResult.selectedIndex];
        const validIndices = indices.filter(i => i >= 0 && i < convo.lastQuotedProducts.length);

        if (validIndices.length > 0) {
          const selected = validIndices.map(i => convo.lastQuotedProducts[i]);
          const linkParts = [];
          for (const prod of selected) {
            if (prod.productUrl) {
              const trackedLink = await generateClickLink(psid, prod.productUrl, {
                productName: prod.productName,
                productId: prod.productId
              });
              linkParts.push(`• ${prod.displayText} — ${formatMoney(prod.price)}\n  🛒 ${trackedLink}`);
              await updateConversation(psid, {
                lastSharedProductId: prod.productId,
                lastSharedProductLink: trackedLink
              });
            }
          }
          if (linkParts.length > 0) {
            await updateConversation(psid, { lastIntent: 'promo_link_shared', unknownCount: 0 });
            const intro = linkParts.length > 1
              ? '¡Perfecto! Aquí tienes los links de compra:'
              : '¡Perfecto! Aquí tienes el link de compra:';
            return {
              type: "text",
              text: `${intro}\n\n${linkParts.join('\n\n')}\n\nLa compra se realiza a través de Mercado Libre y el envío está incluido.`
            };
          }
        }
      }

      if (aiResult.action === 'answer_question' && aiResult.text) {
        await updateConversation(psid, { lastIntent: 'promo_ai_answered', unknownCount: 0 });
        return { type: "text", text: aiResult.text };
      }

      // provide_dimensions → fall through to dimension handling below
    }
  }

  // ====== DIMENSION EXTRACTION ======
  const dims = parseDimensions(userMessage);
  if (dims) {
    const w = Math.min(dims.width, dims.height);
    const h = Math.max(dims.width, dims.height);

    // Fractional → round to nearest standard size
    const rw = Math.ceil(w);
    const rh = Math.ceil(h);

    const products = await findMatchingProducts(rw, rh);

    if (products.length > 0) {
      const product = products[0];
      const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url
        || product.onlineStoreLinks?.[0]?.url;

      if (productUrl) {
        const trackedLink = await generateClickLink(psid, productUrl, {
          productName: product.name,
          productId: product._id
        });

        await updateConversation(psid, {
          lastIntent: 'promo_size_quoted',
          lastSharedProductId: product._id?.toString(),
          lastSharedProductLink: trackedLink,
          lastQuotedProducts: [{
            width: rw, height: rh,
            displayText: `${rw}x${rh}m`,
            price: product.price,
            productId: product._id?.toString(),
            productUrl,
            productName: product.name
          }],
          productSpecs: { productType: 'malla', width: rw, height: rh, updatedAt: new Date() },
          unknownCount: 0
        });

        const sizeNote = (w !== rw || h !== rh)
          ? `La medida más cercana que manejamos es ${rw}x${rh}m:\n\n`
          : '';

        return {
          type: "text",
          text: `${sizeNote}La malla de ${rw}x${rh}m está en ${formatMoney(product.price)} con envío incluido.\n\n🛒 Cómprala aquí:\n${trackedLink}`
        };
      }
    }

    // Size not found → hand off
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Promo 6x4: cliente pide ${w}x${h}m — no disponible`,
      responsePrefix: `La medida ${w}x${h}m no la tenemos en nuestro catálogo estándar. Te comunico con un especialista para cotizarte.`,
      lastIntent: 'promo_custom_size_handoff',
      timingStyle: 'elaborate'
    });
  }

  // ====== MULTIPLE DIMENSIONS ======
  const allDims = extractAllDimensions(userMessage, 'confeccionada');
  if (allDims.length >= 2) {
    const parts = [];
    const quotedProducts = [];

    for (const dim of allDims) {
      const w = Math.min(Math.round(dim.width), Math.round(dim.height));
      const h = Math.max(Math.round(dim.width), Math.round(dim.height));
      const products = await findMatchingProducts(w, h);

      if (products.length > 0) {
        const product = products[0];
        parts.push(`• ${w}x${h}m: ${formatMoney(product.price)}`);
        const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url
          || product.onlineStoreLinks?.[0]?.url;
        quotedProducts.push({
          width: w, height: h,
          displayText: `${w}x${h}m`,
          price: product.price,
          productId: product._id?.toString(),
          productUrl,
          productName: product.name
        });
      } else {
        parts.push(`• ${w}x${h}m: No disponible`);
      }
    }

    await updateConversation(psid, {
      lastIntent: 'promo_multiple_sizes',
      lastQuotedProducts: quotedProducts.length > 0 ? quotedProducts : undefined,
      productSpecs: { productType: 'malla', updatedAt: new Date() },
      unknownCount: 0
    });

    return {
      type: "text",
      text: `Aquí te van los precios:\n\n${parts.join('\n')}\n\n¿Quieres los enlaces para comprar?`
    };
  }

  // ====== DEFAULT: PITCH PROMO PRODUCTS ======
  // AI classified as product_specific, no dimensions found → pitch promo products.
  // This handles: purchase questions, price queries, "me interesa", "esa medida",
  // confirmations without prior quotes, and any other product-specific intent.
  if (promoProducts.length > 0) {
    const pitch = await buildPromoPitch(promoProducts, psid, convo);
    if (pitch) {
      await updateConversation(psid, {
        lastIntent: 'promo_initial_pitch',
        lastQuotedProducts: pitch.quotedProducts,
        productInterest: 'malla_sombra',
        unknownCount: 0
      });
      return {
        type: "text",
        text: `Nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV, lista para instalar con ojillos para sujeción.\n\n${pitch.text}\n\nTambién manejamos otras medidas. ¿Cuál te interesa?`
      };
    }
  }

  // ====== FALLBACK ======
  return {
    type: "text",
    text: "¿Qué medida te interesa? Manejamos diversas medidas de malla sombra confeccionada."
  };
}

/**
 * shouldHandle — this flow is only entered via flowRef routing in flowManager.
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  if (convo?.currentFlow === '6x4_promo') return true;
  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES
};
