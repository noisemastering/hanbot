// ai/campaigns/hanlob_confeccionada_general_oct25.js
const { updateConversation } = require("../../conversationManager");
const { getCampaignProductFromConversation } = require("../../utils/productCompatibility");
const { generateClickLink } = require("../../tracking");

// --- Helpers ---
function parseSize(str) {
  const m = String(str).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (Number.isNaN(w) || Number.isNaN(h)) return null;
  return { w, h, area: w * h };
}

function normalizeVariants(variants = []) {
  return variants
    .filter(v => v && v.size)
    .map(v => {
      const p = parseSize(v.size);
      return p ? { ...v, _w: p.w, _h: p.h, _area: p.area } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a._area - b._area);
}

function findExactVariant(variants, req) {
  return variants.find(v =>
    (v._w === req.w && v._h === req.h) ||
    (v._w === req.h && v._h === req.w)
  );
}

function findClosestUpDown(variants, req) {
  // Suponemos lista ordenada por área ascendente
  let lower = null;
  let upper = null;

  for (const v of variants) {
    if (v._area < req.area) lower = v;
    if (v._area >= req.area) { upper = v; break; }
  }
  return { lower, upper };
}

function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}

async function variantLine(v, includeLink = false, psid = null, convo = {}) {
  const price = formatMoney(v.price);
  if (includeLink && v.permalink) {
    const trackedLink = await generateClickLink(psid, v.permalink, {
      productName: v.productName || v.name,
      productId: v.productId || v._id,
      campaignId: convo.campaignId,
      adSetId: convo.adSetId,
      adId: convo.adId
    });
    return `• ${v.size} → ${price}  \n${trackedLink}`;
  }
  return `• ${v.size} → ${price}`;
}

function variantLineCompact(v) {
  const price = formatMoney(v.price);
  return `• ${v.size} → ${price}`;
}

// --- Handler principal del flujo ---
async function handleHanlobConfeccionadaGeneralOct25(msg, psid, convo, campaign) {
  const clean = String(msg).trim().toLowerCase();

  // 0) Carga de producto guía de la campaña (usando nuevo sistema de productos)
  const product = getCampaignProductFromConversation(convo, campaign);

  // Si no hay producto asociado, cae a un fallback mínimo de campaña
  if (!product) {
    await updateConversation(psid, { lastIntent: "campaign_fallback" });
    return {
      type: "text",
      text: "Puedo ayudarte con precios, medidas o cotizaciones de la malla sombra confeccionada 🌿. ¿Qué te gustaría saber?"
    };
  }

  const variants = normalizeVariants(product.variants || []);

  // 1) Entrada a campaña
  if (convo.lastIntent === "campaign_entry" || convo.lastIntent === null) {
    await updateConversation(psid, { lastIntent: "intro" });
    const intro = campaign.initialMessage ||
      "👋 ¡Hola! Bienvenido a Hanlob 🌿. ¿Deseas ver precios o medidas de nuestra malla sombra beige confeccionada?";
    return { type: "text", text: intro };
  }

  // 2) Mensajes tipo precio
  if (/precio|cu[aá]nto|vale|costo/.test(clean)) {
    await updateConversation(psid, { lastIntent: "price_info" });
    return {
      type: "text",
      text: `La tenemos desde *$450* en medida 4x3 🌿\n¿Qué medida estás buscando?`
    };
  }

  // 3) Detección de medida (6x5, 4 x 3, 3.5x7, etc.)
  const requested = parseSize(clean);
  if (requested) {
    // 3a) ¿Existe exacta?
    const exact = findExactVariant(variants, requested);
    if (exact) {
      await updateConversation(psid, { lastIntent: "size_exact" });
      const line = await variantLine(exact, true, psid, convo); // incluye link
      return {
        type: "text",
        text:
          `¡Perfecto! Tengo **${exact.size}** disponible.\n` +
          `${line}\n\n` +
          `¿Te interesa esta medida o buscas otra? 🌿`
      };
    }

    // 3b) Si no existe exacta → sugerir lo más cercano (abajo/arriba)
    const { lower, upper } = findClosestUpDown(variants, requested);
    await updateConversation(psid, { lastIntent: "size_suggested" });

    // Construir respuesta con links para sugerencias
    let suggestions = "No tengo exactamente esa medida, pero lo más cercano es:\n";
    if (lower) suggestions += `${await variantLine(lower, true, psid, convo)}\n`;
    if (upper) suggestions += `${await variantLine(upper, true, psid, convo)}\n`;

    // Ofrecer confección a la medida
    suggestions += `\nTambién puedo confeccionarla **a la medida**. ¿Te interesa alguna de estas o prefieres a la medida?`;

    return { type: "text", text: suggestions };
  }

  // 4) Mensajes tipo "medidas"
  if (/medidas|dimensiones|tamañ|opciones/.test(clean)) {
    await updateConversation(psid, { lastIntent: "sizes_list" });

    // Lista compacta (sin links) para respuesta genérica
    const compactList = variants.map(variantLineCompact).join("\n");
    return {
      type: "text",
      text:
        `Tenemos estas medidas disponibles:\n` +
        `${compactList}\n\n` +
        `¿Cuál te interesa? Mándame la medida y te paso el enlace para comprar 😊`
    };
  }

  // 5) Mensajes de uso/contexto
  if (/invernadero|jard[ií]n|cochera|estacionamiento|sombra/.test(clean)) {
    await updateConversation(psid, { lastIntent: "usage" });
    return {
      type: "text",
      text:
        `Perfecto 🌞 la *malla sombra beige 90% reforzada* es de larga duración y funciona muy bien para invernadero, jardín y cochera.\n` +
        `¿Qué medida te gustaría revisar?`
    };
  }

  // 6) Envío / entrega
    if (/env[ií]o|entrega|domicilio|enviar|mandan|llegan|envias|entregan/.test(clean)) {
        await updateConversation(psid, { lastIntent: "shipping_info" });

        return {
            type: "text",
            text:
            `Sí, entregamos sin problema 🚚✨\n\n` +
            `En **Querétaro zona urbana**, el envío normalmente **va incluido** 🏡.\n` +
            `Para el resto del país también enviamos, y puedes comprar con entrega garantizada desde nuestra **Tienda Oficial en Mercado Libre**.\n\n` +
            `¿En qué ciudad te encuentras? 😊`
        };
    }

    // Ubicación / recoger en tienda
    if (/donde|ubicaci[oó]n|direcci[oó]n|est[aá]n|tienda|recoger|pasar/.test(clean)) {
        await updateConversation(psid, { lastIntent: "location_info" });

        return {
            type: "text",
            text:
            `Estamos en Querétaro 📍\n\n` +
            `**HANLOB - Microparque Industrial Navex Park**\n` +
            `Calle Loma de San Gremal No. 108, **bodega 73**\n` +
            `Col. Ejido Santa María Magdalena\n` +
            `C.P. 76137, Santiago de Querétaro, Qro.\n\n` +
            `Google Maps → https://www.google.com/maps/place/Hanlob\n\n` +
            `Puedes pasar a recoger o te enviamos a domicilio 🚚✨`
        };
    }

  // 7) Fallback específico de campaña
  await updateConversation(psid, { lastIntent: "campaign_fallback" });
  return {
    type: "text",
    text: product.fallbackMessage ||
      "Puedo ayudarte con precios, medidas o cotizaciones de la malla sombra confeccionada 🌿. ¿Qué te gustaría saber?"
  };
}

module.exports = { handleHanlobConfeccionadaGeneralOct25 };
