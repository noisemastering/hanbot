// ai/flows/convo_promo6x4.js
// Convo flow for malla sombra confeccionada promo 6x4 — retail, buyer.
// Assembled from: master_flow + product_flow + retail_flow + buyer_flow + promo_flow
// Custom dimension pre-processing: fractional→round, both sides >8→handoff.

const convoFlow = require("./convoFlow");
const { executeHandoff } = require("../utils/executeHandoff");
const {
  parseConfeccionadaDimensions: parseDimensions
} = require("../utils/dimensionParsers");
const { generateClickLink } = require("../../tracking");
const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");

const manifest = {
  type: 'convo_flow',
  name: 'convo_promo6x4',
  products: ['6942d85ba539ce7f9f28429b'],  // Confeccionada con Refuerzo — Rectangular (38 sizes)
  clientProfile: 'buyer',
  salesChannel: 'retail',
  endpointOfSale: 'online_store',
  voice: 'casual',
  installationNote: 'La malla viene lista para instalar con ojillos cada 80 cm. Solo se necesita soga o cable para sujetarla. Enfócate en lo práctico: fácil instalación y protección solar inmediata.',
  allowListing: true,
  offersCatalog: false,
  promo: {
    promoProductIds: ['6943123eed2d4185ba47052f'],  // 6m x 4m
    promoPrices: [],
    timeframe: null,
    terms: null
  }
};

const instance = convoFlow.create(manifest);

function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Find matching confeccionada product by rounded size.
 */
async function findBySize(w, h) {
  const minD = Math.min(w, h);
  const maxD = Math.max(w, h);
  const sizeRegex = new RegExp(
    `^\\s*(${minD}\\s*m?\\s*[xX×]\\s*${maxD}|${maxD}\\s*m?\\s*[xX×]\\s*${minD})\\s*m?\\s*$`, 'i'
  );
  return ProductFamily.find({ sellable: true, active: true, size: sizeRegex })
    .sort({ price: 1 }).lean();
}

async function handle(userMessage, convo, psid, state = {}) {
  // ── DIMENSION PRE-PROCESSING ──
  // Intercept fractional and oversize dimensions before the standard pipeline.
  // Integer dimensions within catalog range go straight to the pipeline.
  const dims = parseDimensions(userMessage);

  if (dims) {
    const w = Math.min(dims.width, dims.height);
    const h = Math.max(dims.width, dims.height);

    // Both sides > 8 → handoff to human
    if (w > 8 && h > 8) {
      const handoffResp = await executeHandoff(psid, convo, userMessage, {
        reason: `Medida grande: ${w}x${h}m (ambos lados >8m)`,
        responsePrefix: `Esa medida (${w}x${h}m) requiere cotización especial ya que es más grande que nuestro catálogo estándar. Te comunico con un especialista para cotizarte.`,
        lastIntent: 'oversize_handoff',
        timingStyle: 'elaborate'
      });
      return { response: handoffResp, state };
    }

    // Fractional dimensions → round and offer nearest standard size
    const hasFractions = (w % 1 !== 0) || (h % 1 !== 0);
    if (hasFractions) {
      const fractionalKey = `${w}x${h}`;
      const isInsisting = convo?.lastFractionalSize === fractionalKey;

      // Customer insists on exact fractional size → handoff
      if (isInsisting) {
        const handoffResp = await executeHandoff(psid, convo, userMessage, {
          reason: `Medida con decimales: ${w}x${h}m (insiste en medida exacta)`,
          responsePrefix: `La medida exacta de ${w}x${h}m requiere fabricación especial. Te comunico con un especialista para cotizarte.`,
          lastIntent: 'fractional_meters_handoff',
          timingStyle: 'elaborate'
        });
        return { response: handoffResp, state };
      }

      const rw = (w % 1 !== 0) ? Math.round(w) : w;
      const rh = (h % 1 !== 0) ? Math.round(h) : h;
      console.log(`📏 [promo6x4] Fractional ${w}x${h}m → offering ${rw}x${rh}m`);

      const products = await findBySize(rw, rh);

      if (products.length > 0) {
        const product = products[0];
        const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url
          || product.onlineStoreLinks?.[0]?.url;

        if (productUrl) {
          const trackedLink = await generateClickLink(psid, productUrl, {
            productName: product.name,
            productId: product._id,
            reason: 'promo_fractional_round'
          });

          await updateConversation(psid, {
            lastFractionalSize: fractionalKey,
            lastSharedProductId: product._id?.toString(),
            lastSharedProductLink: trackedLink,
            lastQuotedProducts: [{
              width: rw, height: rh,
              displayText: `${rw}x${rh}m`,
              price: product.price,
              productId: product._id?.toString(),
              productUrl,
              productName: product.name
            }]
          });

          const explanation = dims.convertedFromFeet
            ? `Tu medida de ${dims.originalFeetStr} equivale a aproximadamente ${w}x${h} metros.\n\nLa medida más cercana que manejamos es ${rw}x${rh}m:`
            : `La medida más cercana que manejamos es ${rw}x${rh}m:`;

          return {
            response: {
              type: 'text',
              text: `${explanation}\n\nLa malla de ${rw}x${rh}m está en ${formatMoney(product.price)} con envío incluido.\n\n🛒 Cómprala aquí:\n${trackedLink}`
            },
            state
          };
        }
      }

      // No standard size found for fractional → handoff
      const handoffResp = await executeHandoff(psid, convo, userMessage, {
        reason: `Medida con decimales: ${w}x${h}m — sin tamaño estándar cercano`,
        responsePrefix: `La medida ${w}x${h}m no la tenemos en catálogo estándar. Te comunico con un especialista.`,
        lastIntent: 'fractional_meters_handoff',
        timingStyle: 'elaborate'
      });
      return { response: handoffResp, state };
    }
  }

  // ── STANDARD PIPELINE ──
  // Integer dimensions, product questions, promo pitch, general questions
  // all handled by: promoFlow → masterFlow → buyerFlow → productFlow → retailFlow
  // If customer provided dimensions, skip the promo pitch — serve the requested size directly.
  if (dims) {
    state.pitchSent = true;
  }
  return await instance.handle(userMessage, convo, psid, state);
}

module.exports = {
  manifest,
  handle,
  getProductCache: instance.getProductCache
};
