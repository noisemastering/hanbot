// ai/campaigns/hanlob_confeccionada_general_oct25.js
const { updateConversation } = require("../../conversationManager");
const { getCampaignProductFromConversation } = require("../../utils/productCompatibility");
const { generateClickLink } = require("../../tracking");
const { getAvailableSizes } = require("../../measureHandler");
const { executeHandoff } = require("../utils/executeHandoff");
const { parseConfeccionadaDimensions } = require("../utils/dimensionParsers");
const { generateBotResponse } = require("../responseGenerator");

// --- Helpers ---
// Use centralized parser - converts Spanish numbers and handles all formats
function parseSize(str) {
  const result = parseConfeccionadaDimensions(str);
  if (!result) return null;
  return {
    w: result.width,
    h: result.height,
    area: result.area,
    convertedFromFeet: result.convertedFromFeet || false,
    originalFeetStr: result.originalFeetStr || null
  };
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

  // 1) Entrada a campaña — only greet if user didn't ask something specific
  if (convo.lastIntent === "campaign_entry" || convo.lastIntent === null) {
    const hasQuestion = /\b(precio|cu[aá]nto|cuesta|vale|costo|medida|tamaño|dimensi|metro|env[ií]o|entrega|impermeable|instala|garant|durabilidad|color|pago|compra|d[oó]nde|ubicaci[oó]n|sombra|porcentaje|%)\b/i.test(clean);
    const hasDimensions = parseSize(clean);

    if (!hasQuestion && !hasDimensions) {
      await updateConversation(psid, { lastIntent: "intro" });
      const intro = campaign.initialMessage ||
        "👋 ¡Hola! Bienvenido a Hanlob 🌿. ¿Deseas ver precios o medidas de nuestra malla sombra beige confeccionada?";
      return { type: "text", text: intro };
    }
    // User asked something — update intent and fall through to handlers
    await updateConversation(psid, { lastIntent: "intro" });
  }

  // 1c) Reseller disambiguation — user replied to "¿una pieza o mayoreo?"
  if (convo.lastIntent === "awaiting_reseller_intent") {
    const isRetail = /\b(una?\s*(pieza|unidad)?|solo\s*(una?|1)|personal|particular|nada\s+m[aá]s|mi\s*(casa|patio|jard[ií]n|negocio|terreno))\b/i.test(clean);
    const isWholesale = /\b(mayoreo|mayor|al\s+por\s+mayor|revender|reventa|distribui[rd]|cantidad|lote|ferreter[ií]a|tienda|varias?)\b/i.test(clean);
    const newDimensions = parseSize(clean);

    if (newDimensions) {
      // User gave new dimensions — clear pending state, fall through to normal handling
      await updateConversation(psid, { lastIntent: "intro", productSpecs: { ...convo.productSpecs, pendingSize: null } });
      // Fall through — will be caught by dimension detection below
    } else if (isRetail) {
      // Retail — clear wholesale flag, quote the pending size
      await updateConversation(psid, { isWholesaleInquiry: false });
      const pendingSize = convo.productSpecs?.pendingSize;
      if (pendingSize) {
        const req = parseSize(pendingSize);
        if (req) {
          const exact = findExactVariant(variants, req);
          if (exact) {
            await updateConversation(psid, { lastIntent: "size_exact", productSpecs: { ...convo.productSpecs, pendingSize: null } });
            const line = await variantLine(exact, true, psid, convo);
            return {
              type: "text",
              text: `¡Perfecto! Tengo ${exact.size} disponible.\n${line}\n\n¿Te interesa esta medida o buscas otra? 🌿`
            };
          }
          // No exact match — show closest
          const { lower, upper } = findClosestUpDown(variants, req);
          await updateConversation(psid, { lastIntent: "size_suggested", productSpecs: { ...convo.productSpecs, pendingSize: null } });
          let suggestions = "No tengo exactamente esa medida, pero lo más cercano es:\n";
          if (lower) suggestions += `${await variantLine(lower, true, psid, convo)}\n`;
          if (upper) suggestions += `${await variantLine(upper, true, psid, convo)}\n`;
          suggestions += `\nTambién puedo confeccionarla a la medida. ¿Te interesa alguna de estas o prefieres a la medida?`;
          return { type: "text", text: suggestions };
        }
      }
      // No pending size — ask for dimensions
      await updateConversation(psid, { lastIntent: "intro", productSpecs: { ...convo.productSpecs, pendingSize: null } });
      return { type: "text", text: "¡Claro! ¿Qué medida necesitas? Dime las dimensiones y te paso el precio con link de compra 😊" };
    } else if (isWholesale) {
      // Wholesale — hand off to specialist
      const pendingSize = convo.productSpecs?.pendingSize || "sin medida especificada";
      await updateConversation(psid, { productSpecs: { ...convo.productSpecs, pendingSize: null } });
      return await executeHandoff(psid, convo, msg, {
        reason: `Mayoreo: cliente confirma interés en mayoreo — medida ${pendingSize}`,
        responsePrefix: `Perfecto, para precio de mayoreo un especialista te dará la cotización.`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });
    } else {
      // Unclear — re-ask
      return { type: "text", text: "¿Buscas comprar una pieza o te interesa precio de mayoreo para reventa?" };
    }
  }

  // 1b) Non-90% shade percentage — confeccionada is ONLY 90%
  const shadeMatch = clean.match(/\b(al\s*)?(\d{2,3})\s*(%|porciento|por\s*ciento|de\s+sombra)/i);
  const requestedShade = shadeMatch ? parseInt(shadeMatch[2]) : null;
  if (requestedShade && requestedShade !== 90) {
    const AVAILABLE_ROLL_SHADES = [35, 50, 70, 80, 90];
    const isAvailableAsRoll = AVAILABLE_ROLL_SHADES.includes(requestedShade);
    const dimInMsg = parseSize(clean);

    // If they also mentioned dimensions, offer the 90% product in that size
    if (dimInMsg) {
      const match = findExactVariant(variants, dimInMsg);
      if (match) {
        const line = await variantLine(match, true, psid, convo);
        await updateConversation(psid, { lastIntent: "shade_clarified", unknownCount: 0 });
        return {
          type: "text",
          text: `La malla confeccionada solo la manejamos en 90% de sombra.\n\n` +
                (isAvailableAsRoll
                  ? `Malla al ${requestedShade}% sí la manejamos pero en rollo de 100m de largo.\n\n`
                  : `No manejamos ${requestedShade}% de sombra. Nuestros porcentajes disponibles en rollo son: 35%, 50%, 70%, 80% y 90%.\n\n`) +
                `En tu medida de ${dimInMsg.w}x${dimInMsg.h}m en confeccionada de 90% tenemos:\n${line}\n\n` +
                `¿Te interesa la confeccionada de 90% o prefieres información sobre rollos?`
        };
      }
    }

    await updateConversation(psid, { lastIntent: "shade_clarified", unknownCount: 0 });
    return {
      type: "text",
      text: `La malla confeccionada solo la manejamos en 90% de sombra.\n\n` +
            (isAvailableAsRoll
              ? `Malla al ${requestedShade}% sí la manejamos pero en rollo de 100m de largo.\n\n`
              : `No manejamos ${requestedShade}% de sombra. Nuestros porcentajes disponibles en rollo son: 35%, 50%, 70%, 80% y 90%.\n\n`) +
            `¿Te interesa la confeccionada de 90% o prefieres información sobre rollos?`
    };
  }

  // 2) Detección de medida FIRST (6x5, 4 x 3, 3.5x7, 3 metros x 1.70, etc.)
  // This must come BEFORE generic price check so "precio de 3x4" handles the dimension
  const requested = parseSize(clean);
  if (requested) {
    // Check for fractional meters - hand off to human for custom quote
    const hasFractions = (requested.w % 1 !== 0) || (requested.h % 1 !== 0);

    if (hasFractions) {
      const fractionalKey = `${Math.min(requested.w, requested.h)}x${Math.max(requested.w, requested.h)}`;
      const isInsisting = convo?.lastFractionalSize === fractionalKey;

      // Customer insists on exact fractional size - hand off
      if (isInsisting) {
        console.log(`📏 Campaign: customer insists on ${fractionalKey}m, handing off`);

        const response = await generateBotResponse("specialist_handoff", {
          dimensions: `${requested.w}x${requested.h}m`
        });
        return await executeHandoff(psid, convo, msg, {
          reason: `Medida con decimales: ${requested.w}x${requested.h}m (insiste en medida exacta)`,
          responsePrefix: response,
          lastIntent: 'fractional_meters_handoff',
          timingStyle: 'none',
          notificationText: `Medida con decimales: ${requested.w}x${requested.h}m - cliente insiste en medida exacta`
        });
      }

      // First time - only floor the fractional dimension(s), keep whole-number dimensions as-is
      const minD = Math.min(requested.w, requested.h);
      const maxD = Math.max(requested.w, requested.h);
      const flooredW = (minD % 1 !== 0) ? Math.floor(minD) : minD;
      const flooredH = (maxD % 1 !== 0) ? Math.floor(maxD) : maxD;
      console.log(`📏 Campaign: fractional ${requested.w}x${requested.h}m → offering ${flooredW}x${flooredH}m`);

      const flooredReq = { w: flooredW, h: flooredH, area: flooredW * flooredH };
      const flooredMatch = findExactVariant(variants, flooredReq);

      if (flooredMatch) {
        const line = await variantLine(flooredMatch, true, psid, convo);
        await updateConversation(psid, {
          lastIntent: "size_confirmed",
          lastFractionalSize: fractionalKey,
          unknownCount: 0
        });

        // Build explanation — different for feet conversion vs. fractional meters
        let explanation;
        if (requested.convertedFromFeet) {
          explanation = `📏 Tu medida de ${requested.originalFeetStr} equivale a aproximadamente ${requested.w}x${requested.h} metros.\n\nLa medida más cercana que manejamos es ${flooredW}x${flooredH}m:`;
        } else {
          explanation = `Te ofrecemos ${flooredW}x${flooredH} ya que es necesario considerar un tamaño menor para dar espacio a los tensores o soga sujetadora.`;
        }

        return {
          type: "text",
          text: `${explanation}\n\n${line}`
        };
      }
      // If no floored variant found, fall through to normal size matching below
    }

    // 2a) ¿Existe exacta?
    const exact = findExactVariant(variants, requested);
    if (exact) {
      // Reseller ad disambiguation — ask retail vs wholesale before quoting
      if (convo.isWholesaleInquiry) {
        await updateConversation(psid, {
          lastIntent: "awaiting_reseller_intent",
          productSpecs: { ...convo.productSpecs, pendingSize: `${requested.w}x${requested.h}` }
        });
        return {
          type: "text",
          text: `¡Tenemos la medida de ${exact.size}! ¿Buscas comprar una pieza o te interesa precio de mayoreo para reventa?`
        };
      }

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

    // Reseller ad disambiguation — ask retail vs wholesale before quoting
    if (convo.isWholesaleInquiry) {
      await updateConversation(psid, {
        lastIntent: "awaiting_reseller_intent",
        productSpecs: { ...convo.productSpecs, pendingSize: `${requested.w}x${requested.h}` }
      });
      let closestInfo = "";
      if (lower) closestInfo += `• ${lower.size}\n`;
      if (upper) closestInfo += `• ${upper.size}\n`;
      return {
        type: "text",
        text: `No tenemos exactamente ${requested.w}x${requested.h}, pero manejamos:\n${closestInfo}\n¿Buscas comprar una pieza o te interesa precio de mayoreo para reventa?`
      };
    }

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

  // 4b) Price per meter / m² — answer with base price
  if (/\b(precio|cu[aá]nto|vale|cuesta|costo|a\s*c[oó]mo)\s+(por|el|del?)?\s*(metro|m2|m²)\b/i.test(clean) ||
      /\b(metro\s*\.?\s*(cuadrado)?|m2|m²)\s+(cu[aá]nto|precio|cuesta|vale)\b/i.test(clean)) {
    await updateConversation(psid, { lastIntent: "price_per_meter" });
    return {
      type: "text",
      text: "El precio base del metro cuadrado es de 30 pesos pero varía dependiendo de la dimensión, entre más grande es, más baja el precio por metro cuadrado.\n\n¿Qué medida te interesa?"
    };
  }

  // 4c) Custom size question — "hacen la medida que necesita?", "fabrican a medida?"
  if (/\b(hacen|fabrican|tienen|manejan|pueden)\b.*(medida|tamaño|dimensi[oó]n).*(necesit|quier|pid|ocup|exact|personalizad|especial|cualquier)/i.test(clean) ||
      /\b(medida|tamaño).*(personalizad|especial|exact|a\s+la\s+medida|custom|sobre\s*medida)\b/i.test(clean) ||
      /\b(cualquier|otra)\s*(medida|tamaño|dimensi[oó]n)\b/i.test(clean) ||
      /\b(a\s+la\s+medida|sobre\s*medida|a\s+medida)\b/i.test(clean) ||
      /\b(hacen|fabrican)\s+(la|una|otra|cualquier)\s*(medida|otra)\b/i.test(clean)) {
    await updateConversation(psid, { lastIntent: "custom_size_confirmed" });
    return {
      type: "text",
      text: `¡Sí! Somos fabricantes y hacemos la malla sombra a la medida que necesites.\n\n` +
            `Tenemos medidas estándar listas para envío inmediato, y si necesitas una medida especial la fabricamos.\n\n` +
            `¿Qué medida necesitas? 😊`
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

  // 6b-pre) Pay on delivery question - explicit NO
  if (/\b(al\s+recibir|contra\s*entrega|pago\s+al\s+(recibir|entreg))\b/i.test(clean)) {
    await updateConversation(psid, { lastIntent: "pay_on_delivery_answered" });
    return {
      type: "text",
      text: "No manejamos pago contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega, llega defectuoso o es diferente a lo solicitado, se te devuelve tu dinero."
    };
  }

  // 6b) Compra / Mercado Libre / cómo comprar
  if (/compra|mercado\s*libre|c[oó]mo\s+(compro|pago|ordeno)|pago|forma\s+de\s+pago|d[oó]nde\s+compro/.test(clean)) {
    await updateConversation(psid, { lastIntent: "purchase_confirmed" });

    return {
      type: "text",
      text: `¡Sí! La compra es por Mercado Libre 💚\n\n` +
            `El pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero.\n\n` +
            `¿Qué medida necesitas? Te paso el link directo al producto 😊`
    };
  }

    // Ubicación / recoger en tienda — defer to dispatcher for full address handling
    if (/d[oó]nde\s+(est[aá]n|se\s+ubican|quedan)|ubica[n]?|ubicaci[oó]n|direcci[oó]n|tienda|recoger|pasar/.test(clean)) {
        console.log("📍 Location question detected in campaign, deferring to dispatcher");
        return null;
    }

  // 7) Product specs / FAQ questions — let the dispatcher handle these properly
  // (eyelets, installation, color, warranty, material, rain, etc.)
  if (/\b(ojillo|ojillos|argolla|argollas|ojito|ojitos|instala|garant|color|beige|negro|material|impermeable|lluvia|agua|refuerz|porcentaje|vida\s*[uú]til|dur[ao]|c[oó]mo\s+se|para\s+colgar|para\s+amarrar|factura[nr]?|RFC|fiscal)\b/i.test(clean)) {
    console.log("🔧 Specs/FAQ question detected in campaign, deferring to dispatcher");
    return null;
  }

  // 8) Fallback — ONLY for messages that look like product questions.
  // Everything else returns null so the AI classifier can properly identify
  // complaints, frustration, payment issues, etc.
  const isProductRelated = /\b(precio|cu[aá]nto|vale|costo|medida|tamaño|dimensi|metro|malla|sombra|confeccionada|beige|negr[oa]|rollo|tela|producto|cotiza|disponib|tienen|manejan|hay)\b/i.test(clean);

  if (!isProductRelated) {
    console.log("📋 Message not product-related in campaign, deferring to AI classifier");
    return null;
  }

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
