// ai/campaigns/hanlob_confeccionada_general_oct25.js
const { updateConversation } = require("../../conversationManager");
const { getCampaignProductFromConversation } = require("../../utils/productCompatibility");
const { generateClickLink } = require("../../tracking");
const { getAvailableSizes } = require("../../measureHandler");

// --- Helpers ---
function parseSize(str) {
  // Pattern 1: Simple "3x4" or "3 x 4"
  let m = String(str).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);

  // Pattern 2: "3 metros x 1.70" - handles "metros" between number and x
  if (!m) {
    m = String(str).match(/(\d+(?:\.\d+)?)\s*metros?\s*x\s*(\d+(?:\.\d+)?)/i);
  }

  // Pattern 3: "3 por 4" or "3 metros por 4"
  if (!m) {
    m = String(str).match(/(\d+(?:\.\d+)?)\s*(?:metros?\s+)?por\s+(\d+(?:\.\d+)?)/i);
  }

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
      adId: convo.adId,
      userName: convo.userName,
      city: convo.city,
      stateMx: convo.stateMx
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

  // 🔴 SKIP: If user is asking about rolls, let the roll handler process it
  // This campaign is for confeccionada (pre-made sizes), not rolls
  if (/\b(rol+[oy]s?|rollo|rollos)\b/i.test(clean)) {
    console.log("📦 Roll request detected in confeccionada campaign, skipping to roll handler");
    return null;
  }

  // 🔴 SKIP: Deferral and closing phrases - let greetings.js handle them
  const hasDeferralPattern = /\b(lo\s+reviso|te\s+aviso|luego\s+(te\s+|le\s+|me\s+)?(hablo|escribo|contacto|mando|aviso)|despu[eé]s\s+(te\s+|le\s+|me\s+)?(hablo|escribo|contacto|mando|aviso)|voy\s+a\s+(checar|ver|revisar|pensar)|deja\s+(lo\s+)?(checo|reviso|pienso|veo)|m[aá]s\s+tarde|ahorita\s+no|por\s+ahora|coordinamos|lo\s+pienso|lo\s+analizo)\b/i.test(clean);
  const hasThanks = /\b(gracias|muchas\s+gracias|muy\s+amable)\b/i.test(clean);
  const isExplicitGoodbye = /^(gracias|muchas gracias|ok gracias|perfecto gracias|excelente|muy amable|adi[oó]s|bye|nos vemos|hasta luego)\.?!?$/i.test(clean);

  // Deferral + gracias = definitely goodbye (e.g., "Lo reviso y te aviso, gracias")
  // Pure deferral = let deferral handler respond
  // Pure thanks/goodbye = let thanks handler close
  // Gracias after already deferred = closing
  const isGoodbye = hasDeferralPattern ||
                    isExplicitGoodbye ||
                    (hasThanks && hasDeferralPattern) ||  // Same message: "lo reviso, gracias"
                    (hasThanks && convo.lastIntent === "purchase_deferred") ||  // After deferral
                    (hasThanks && convo.state === "deferred");  // State is deferred

  if (isGoodbye) {
    console.log("👋 Closing/deferral detected in campaign, skipping to global handlers");
    return null;
  }

  // 0) Carga de producto guía de la campaña (usando nuevo sistema de productos)
  const product = getCampaignProductFromConversation(convo, campaign);

  // Si no hay producto asociado, try to show actual price range from available sizes
  if (!product) {
    // Check if user is asking about prices/sizes - fetch actual data
    if (/precio|medida|cu[aá]nto|vale|costo|tamañ|dimensi/i.test(clean)) {
      const availableSizes = await getAvailableSizes(convo);

      if (availableSizes.length > 0) {
        const smallest = availableSizes[0];
        const largest = availableSizes[availableSizes.length - 1];

        await updateConversation(psid, { lastIntent: "price_range_shown" });
        return {
          type: "text",
          text: `Los precios dependen de la medida que necesites 📐\n\n` +
                `Tenemos desde ${smallest.sizeStr} en $${smallest.price} hasta ${largest.sizeStr} en $${largest.price}.\n\n` +
                `¿Qué medida necesitas? Si me dices las dimensiones te doy el precio exacto 😊`
        };
      }
    }

    await updateConversation(psid, { lastIntent: "campaign_fallback" });
    return {
      type: "text",
      text: "Los precios van desde $320 hasta $1,800 dependiendo de la medida 📐\n\n¿Qué medida necesitas para tu proyecto?"
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

  // 2) Detección de medida FIRST (6x5, 4 x 3, 3.5x7, 3 metros x 1.70, etc.)
  // This must come BEFORE generic price check so "precio de 3x4" handles the dimension
  const requested = parseSize(clean);
  if (requested) {
    // Check for fractional meters
    const hasFractions = (requested.w % 1 !== 0) || (requested.h % 1 !== 0);

    if (hasFractions) {
      // Explain we only have whole meters and show closest options
      await updateConversation(psid, { lastIntent: "size_fractional" });

      const { lower, upper } = findClosestUpDown(variants, requested);
      let response = `📏 Solo manejamos medidas en metros completos.\n\n`;
      response += `Para ${requested.w}x${requested.h}m, las opciones más cercanas son:\n`;
      if (lower) response += `${await variantLine(lower, true, psid, convo)}\n`;
      if (upper) response += `${await variantLine(upper, true, psid, convo)}\n`;
      response += `\n¿Te interesa alguna de estas medidas?`;

      return { type: "text", text: response };
    }

    // 2a) ¿Existe exacta?
    const exact = findExactVariant(variants, requested);
    if (exact) {
      await updateConversation(psid, { lastIntent: "size_exact" });
      const line = await variantLine(exact, true, psid, convo); // incluye link
      return {
        type: "text",
        text:
          `¡Perfecto! Tengo ${exact.size} disponible.\n` +
          `${line}\n\n` +
          `¿Te interesa esta medida o buscas otra? 🌿`
      };
    }

    // 2b) Si no existe exacta → sugerir lo más cercano (abajo/arriba)
    const { lower, upper } = findClosestUpDown(variants, requested);
    await updateConversation(psid, { lastIntent: "size_suggested" });

    // Construir respuesta con links para sugerencias
    let suggestions = "No tengo exactamente esa medida, pero lo más cercano es:\n";
    if (lower) suggestions += `${await variantLine(lower, true, psid, convo)}\n`;
    if (upper) suggestions += `${await variantLine(upper, true, psid, convo)}\n`;

    // Ofrecer confección a la medida
    suggestions += `\nTambién puedo confeccionarla a la medida. ¿Te interesa alguna de estas o prefieres a la medida?`;

    return { type: "text", text: suggestions };
  }

  // 3) Mensajes tipo precio (only if no dimension was detected)
  if (/precio|cu[aá]nto|vale|costo/.test(clean)) {
    await updateConversation(psid, { lastIntent: "price_info" });
    return {
      type: "text",
      text: `La tenemos desde *$450* en medida 4x3 🌿\n¿Qué medida estás buscando?`
    };
  }

  // 4) Mensajes tipo "medidas"
  if (/medidas|dimensiones|tamañ|opciones/.test(clean)) {
    await updateConversation(psid, { lastIntent: "sizes_list" });

    // If more than 3 variants, show range instead of listing all
    if (variants.length > 3) {
      const smallest = variants[0];
      const largest = variants[variants.length - 1];
      return {
        type: "text",
        text:
          `Tenemos medidas desde ${smallest.size} (${formatMoney(smallest.price)}) hasta ${largest.size} (${formatMoney(largest.price)}).\n\n` +
          `¿Qué medida necesitas? Mándame las dimensiones y te paso el precio exacto 😊`
      };
    }

    // 3 or fewer - list them all
    const compactList = variants.map(variantLineCompact).join("\n");
    return {
      type: "text",
      text:
        `Tenemos estas medidas disponibles:\n` +
        `${compactList}\n\n` +
        `¿Cuál te interesa? Mándame la medida y te paso el enlace para comprar 😊`
    };
  }

  // 5) Mensajes de uso/contexto - expanded patterns
  if (/invernadero|jard[ií]n|cochera|estacionamiento|sombra|terraza|patio|vivero|cultivo|plantas?|casa|negocio|local|puesto|taco|comida|calle|afuera|exterior|tendido|toldo|techado|techo|cubrir|tapar/.test(clean)) {
    await updateConversation(psid, { lastIntent: "usage" });

    // If they mentioned a specific project but no size, ask about area
    return {
      type: "text",
      text:
        `Perfecto, la malla sombra funciona muy bien para eso 🌞\n\n` +
        `¿Qué área buscas cubrir? (por ejemplo: 4x3 metros, 5x5 metros)`
    };
  }

  // 6) Envío / entrega
    if (/env[ií]o|entrega|domicilio|enviar|mandan|llegan|envias|entregan/.test(clean)) {
        await updateConversation(psid, { lastIntent: "shipping_info" });

        return {
            type: "text",
            text: `¡Sí! Enviamos a toda la república 📦\n\n¿Qué medida necesitas?`
        };
    }

  // 6b) Compra / Mercado Libre / cómo comprar
  if (/compra|mercado\s*libre|c[oó]mo\s+(compro|pago|ordeno)|pago|forma\s+de\s+pago|d[oó]nde\s+compro/.test(clean)) {
    await updateConversation(psid, { lastIntent: "purchase_confirmed" });

    return {
      type: "text",
      text: `¡Sí! La compra es por Mercado Libre 💚\n\n` +
            `Puedes pagar con tarjeta, efectivo en OXXO, o meses sin intereses.\n\n` +
            `¿Qué medida necesitas? Te paso el link directo al producto 😊`
    };
  }

    // Ubicación / recoger en tienda
    if (/d[oó]nde\s+(est[aá]n|se\s+ubican|quedan)|ubica[n]?|ubicaci[oó]n|direcci[oó]n|tienda|recoger|pasar/.test(clean)) {
        console.log("📍 Location question detected");
        await updateConversation(psid, { lastIntent: "location_info" });
        return {
            type: "text",
            text: "Estamos en Querétaro, pero enviamos a todo el país por Mercado Libre 📦"
        };
    }

  // 7) Fallback específico de campaña - show price range instead of generic message
  // Check if we'd be repeating the fallback - ask a different question instead
  if (convo.lastIntent === "campaign_fallback") {
    await updateConversation(psid, { lastIntent: "campaign_fallback_retry" });
    return {
      type: "text",
      text: "Para darte el precio exacto necesito saber la medida 📐\n\n" +
            "¿Qué área buscas cubrir? (ejemplo: 4x3 metros, 5x5 metros)"
    };
  }

  await updateConversation(psid, { lastIntent: "campaign_fallback" });

  // If we have variants, show range from variants
  if (variants.length > 0) {
    const smallest = variants[0];
    const largest = variants[variants.length - 1];
    return {
      type: "text",
      text: `Los precios van desde ${smallest.size} en ${formatMoney(smallest.price)} hasta ${largest.size} en ${formatMoney(largest.price)} 📐\n\n` +
            `¿Qué medida necesitas? Te doy el precio exacto 😊`
    };
  }

  // No variants available - fetch from database
  const fallbackSizes = await getAvailableSizes(convo);
  if (fallbackSizes.length > 0) {
    const smallest = fallbackSizes[0];
    const largest = fallbackSizes[fallbackSizes.length - 1];
    return {
      type: "text",
      text: `Los precios van desde ${smallest.sizeStr} en $${smallest.price} hasta ${largest.sizeStr} en $${largest.price} 📐\n\n` +
            `¿Qué medida necesitas? Te doy el precio exacto 😊`
    };
  }

  // Last resort - hardcoded range
  return {
    type: "text",
    text: "Los precios van desde $320 hasta $1,800 dependiendo de la medida 📐\n\n¿Qué medida necesitas?"
  };
}

module.exports = { handleHanlobConfeccionadaGeneralOct25 };
