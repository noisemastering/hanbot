// ai/flows/mallaFlow.js
// State machine for malla confeccionada (pre-made shade mesh) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");
const { getAvailableSizes } = require("../../measureHandler");

// Import existing utilities - USE THESE, don't reinvent
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductLineage,
  formatProductForBot,
  getProductDisplayName,
  getProductInterest,
  formatProductResponse
} = require("../utils/productEnricher");

// POI tree management
const {
  checkVariantExists,
  getNotAvailableResponse,
  getSiblings,
  getAvailableOptions,
  findInTree,
  getAllDescendants
} = require("../utils/productTree");

// Centralized dimension parsing
const {
  parseConfeccionadaDimensions: parseDimensions,
  parseSingleDimension,
  extractAllDimensions
} = require("../utils/dimensionParsers");

// AI-powered response generation
const { generateBotResponse } = require("../responseGenerator");

// AI fallback for flow dead-ends
const { resolveWithAI } = require("../utils/flowFallback");

// Location detection
const { detectMexicanLocation, detectZipCode } = require("../../mexicanLocations");


// NOTE: Global intents are now handled by the Intent Dispatcher (ai/intentDispatcher.js)
// which runs BEFORE flows. This delegation is being phased out.
// Keeping import for backwards compatibility during migration.
const { handleGlobalIntents } = require("../global/intents");

// parseAndLookupZipCode is now shared — imported from ../utils/preHandoffCheck
const { parseAndLookupZipCode } = require("../utils/preHandoffCheck");

/**
 * Flow stages for malla confeccionada
 */
const STAGES = {
  START: "start",
  AWAITING_DIMENSIONS: "awaiting_dimensions",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  COMPLETE: "complete"
};

/**
 * Valid shade percentages
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

// NOTE: parseDimensions, parseSingleDimension, and extractAllDimensions
// are now imported from ../utils/dimensionParsers.js for consistency across all flows

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'malla' ? STAGES.AWAITING_DIMENSIONS : STAGES.START,
    width: specs.width || null,
    height: specs.height || null,
    percentage: specs.percentage || null,
    color: specs.color || null,
    quantity: specs.quantity || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  if (!state.width || !state.height) return STAGES.AWAITING_DIMENSIONS;
  // Percentage is optional for malla - we can show options
  return STAGES.COMPLETE;
}

/**
 * Find standard sizes near a given area (±2m²)
 * Returns sizes sorted by how close they are to the requested area
 */
async function findSizesNearArea(targetArea, convo = null) {
  try {
    // Get all sellable malla products
    const products = await ProductFamily.find({
      sellable: true,
      active: true,
      size: { $regex: /^\d+\s*[xX×]\s*\d+/, $options: 'i' }
    }).lean();

    // Parse sizes and calculate areas
    const sizesWithArea = [];
    for (const p of products) {
      const match = p.size?.match(/(\d+)\s*[xX×]\s*(\d+)/);
      if (match) {
        const w = parseInt(match[1]);
        const h = parseInt(match[2]);
        const area = w * h;
        // Only include if within ±3m² of target
        if (Math.abs(area - targetArea) <= 3) {
          sizesWithArea.push({
            width: Math.min(w, h),
            height: Math.max(w, h),
            area,
            price: p.price,
            product: p
          });
        }
      }
    }

    // Remove duplicates (same dimensions)
    const unique = [];
    const seen = new Set();
    for (const s of sizesWithArea) {
      const key = `${s.width}x${s.height}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }

    // Sort by how close to target area
    unique.sort((a, b) => Math.abs(a.area - targetArea) - Math.abs(b.area - targetArea));

    // Return top 3-4 closest options
    return unique.slice(0, 4);
  } catch (error) {
    console.error("❌ Error finding sizes near area:", error);
    return [];
  }
}

/**
 * Find matching sellable products by size
 * Searches ONLY sellable products and dimensions are interchangeable
 * If poiRootId is provided, searches only within that tree
 */
async function findMatchingProducts(width, height, percentage = null, color = null, poiRootId = null) {
  try {
    // Normalize dimensions (smaller first for consistent matching)
    const w = Math.min(Math.floor(width), Math.floor(height));
    const h = Math.max(Math.floor(width), Math.floor(height));

    // Build size regex - match exactly WxH or HxW (not any combo like WxW or HxH)
    // Formats: "3x5", "5x3", "3x5m", "5 x 3 m", "5 m x 3 m", etc.
    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`,
      'i'
    );

    console.log(`🔍 Searching for malla ${w}x${h}m with regex: ${sizeRegex}${poiRootId ? ` in tree ${poiRootId}` : ''}`);

    // Query ONLY sellable, active products with matching size
    const query = {
      sellable: true,
      active: true,
      size: sizeRegex
    };

    let products = await ProductFamily.find(query)
      .sort({ price: 1 }) // Cheapest first
      .lean();

    // Filter by percentage using lineage — the percentage lives in an ancestor (Gen 2),
    // not in the sellable product's own name. Walk the tree to build the full identity.
    if (percentage && VALID_PERCENTAGES.includes(Number(percentage)) && products.length > 0) {
      const pctRegex = new RegExp(`\\b${percentage}\\s*%`, 'i');
      const filtered = [];
      for (const product of products) {
        const lineage = await getProductLineage(product);
        const fullName = lineage.map(l => l.name).join(' ');
        if (pctRegex.test(fullName)) {
          filtered.push(product);
        }
      }
      if (filtered.length > 0) {
        products = filtered;
        console.log(`🔍 Percentage ${percentage}% filter (via lineage): ${products.length} matches`);
      } else {
        console.log(`🔍 Percentage ${percentage}% not found in any lineage, keeping all ${products.length} results`);
      }
    }

    // If POI tree is locked, filter to only products in that tree
    if (poiRootId && products.length > 0) {
      const { getAllDescendants } = require("../utils/productTree");
      const treeDescendants = await getAllDescendants(poiRootId);
      const treeIds = new Set(treeDescendants.map(d => d._id.toString()));

      // Filter products to only those in the tree
      const filteredProducts = products.filter(p => treeIds.has(p._id.toString()));
      console.log(`🔍 Filtered from ${products.length} to ${filteredProducts.length} products in POI tree`);
      products = filteredProducts;
    }

    console.log(`🔍 Found ${products.length} matching sellable products for ${w}x${h}m`);

    return products;
  } catch (error) {
    console.error("❌ Error finding malla products:", error);
    return [];
  }
}

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

/**
 * Handle accessory questions (arnés, cuerda, lazo, kit de instalación)
 * Offers lazo and kit de instalación as additional products
 */
async function handleAccessoryQuestion(psid, convo, userMessage) {
  // Find the lazo and kit products
  const kitProduct = await ProductFamily.findOne({
    name: /Kit de Instalación para Malla Sombra/i,
    sellable: true
  }).lean();

  const lazoProduct = await ProductFamily.findOne({
    name: /Rollo de 47 m/i,
    parentId: { $exists: true },
    sellable: true,
    price: { $gt: 0 }
  }).lean();

  // Build response
  let response = `La malla sombra confeccionada viene lista para instalar con ojillos para sujeción cada 80 cm por lado, pero no incluye cuerda ni arnés.\n\n`;
  response += `Te ofrecemos estos accesorios:\n\n`;

  if (lazoProduct) {
    const lazoLink = lazoProduct.mlLink || null;
    const lazoTracked = lazoLink ? await generateClickLink(psid, lazoLink, {
      productName: 'Lazo con protección UV',
      productId: lazoProduct._id
    }) : null;
    response += `• **Lazo con protección UV** (rollo de 47m): ${formatMoney(lazoProduct.price)}${lazoTracked ? `\n  ${lazoTracked}` : ''}\n\n`;
  }

  if (kitProduct) {
    const kitLink = kitProduct.mlLink || null;
    const kitTracked = kitLink ? await generateClickLink(psid, kitLink, {
      productName: 'Kit de Instalación',
      productId: kitProduct._id
    }) : null;
    response += `• **Kit de Instalación para Malla Sombra**: ${formatMoney(kitProduct.price)}${kitTracked ? `\n  ${kitTracked}` : ''}\n\n`;
  }

  response += `¿Te interesa agregar alguno de estos accesorios?`;

  await updateConversation(psid, {
    lastIntent: 'malla_accessory_offered',
    unknownCount: 0
  });

  return {
    type: "text",
    text: response
  };
}

/**
 * Handle multiple dimensions request (e.g., "6x5 o 5x5")
 */
async function handleMultipleDimensions(dimensions, psid, convo) {
  const poiRootId = convo?.poiRootId;
  const responseParts = [];
  const quotedProducts = [];

  for (const dim of dimensions) {
    const w = Math.min(dim.width, dim.height);
    const h = Math.max(dim.width, dim.height);
    const hasFractions = (w % 1 !== 0) || (h % 1 !== 0);

    if (hasFractions) {
      // Floor to standard size and explain
      const flooredW = Math.floor(w);
      const flooredH = Math.floor(h);
      const products = await findMatchingProducts(flooredW, flooredH, null, null, poiRootId);

      if (products.length > 0) {
        const product = products[0];
        responseParts.push(`• ${dim.width}x${dim.height}m → te ofrecemos ${flooredW}x${flooredH}m: ${formatMoney(product.price)}`);
        const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url || product.onlineStoreLinks?.[0]?.url;
        quotedProducts.push({
          width: flooredW, height: flooredH,
          displayText: `${flooredW}x${flooredH}m`,
          price: product.price,
          productId: product._id?.toString(),
          productUrl,
          productName: product.name
        });
      } else {
        responseParts.push(`• ${dim.width}x${dim.height}m: No disponible en esta medida`);
      }
    } else {
      // Standard size — direct lookup
      const products = await findMatchingProducts(w, h, null, null, poiRootId);

      if (products.length > 0) {
        const product = products[0];
        responseParts.push(`• ${dim.width}x${dim.height}m: ${formatMoney(product.price)}`);
        const productUrl = product.onlineStoreLinks?.find(l => l.isPreferred)?.url || product.onlineStoreLinks?.[0]?.url;
        quotedProducts.push({
          width: w, height: h,
          displayText: `${w}x${h}m`,
          price: product.price,
          productId: product._id?.toString(),
          productUrl,
          productName: product.name
        });
      } else {
        responseParts.push(`• ${dim.width}x${dim.height}m: No disponible en esta medida`);
      }
    }
  }

  const hasFractionalDims = dimensions.some(d =>
    (Math.min(d.width, d.height) % 1 !== 0) || (Math.max(d.width, d.height) % 1 !== 0)
  );

  const fractionalNote = hasFractionalDims
    ? '\n\nLas medidas con decimales se ajustan al tamaño estándar inmediato inferior para dar espacio a los tensores o soga sujetadora.'
    : '';

  await updateConversation(psid, {
    lastIntent: 'malla_multiple_sizes',
    productInterest: 'malla_sombra',
    lastQuotedProducts: quotedProducts.length > 0 ? quotedProducts : undefined,
    productSpecs: {
      productType: 'malla',
      updatedAt: new Date()
    }
  });

  return {
    type: "text",
    text: `Aquí te van los precios:\n\n${responseParts.join('\n')}${fractionalNote}\n\n¿Quieres los enlaces para comprar?`
  };
}

/**
 * Handle AI-resolved product selection from lastQuotedProducts.
 * Takes an AI action + the quoted products array, generates tracked links, returns formatted response.
 */
async function handleQuoteSelection(aiAction, lastQuotedProducts, psid, convo) {
  const indices = aiAction.action === 'select_products'
    ? aiAction.selectedIndices
    : [aiAction.selectedIndex];

  // Validate indices
  const validIndices = indices.filter(i => i >= 0 && i < lastQuotedProducts.length);
  if (validIndices.length === 0) return null;

  const selectedProducts = validIndices.map(i => lastQuotedProducts[i]);
  const responseParts = [];

  for (const prod of selectedProducts) {
    if (!prod.productUrl) {
      responseParts.push(`• ${prod.displayText}: ${formatMoney(prod.price)} (sin link disponible)`);
      continue;
    }

    const trackedLink = await generateClickLink(psid, prod.productUrl, {
      productName: prod.productName || `Malla ${prod.displayText}`,
      productId: prod.productId
    });

    responseParts.push(`• ${prod.displayText} — ${formatMoney(prod.price)}\n  🛒 ${trackedLink}`);
  }

  await updateConversation(psid, {
    lastIntent: 'malla_complete',
    unknownCount: 0
  });

  const intro = selectedProducts.length > 1
    ? '¡Perfecto! Aquí tienes los links de compra:'
    : '¡Perfecto! Aquí tienes el link de compra:';

  return {
    type: "text",
    text: `${intro}\n\n${responseParts.join('\n\n')}\n\nLa compra se realiza a través de Mercado Libre y el envío está incluido.`
  };
}

/**
 * Check if user is asking about product features.
 * Returns a response if all feature topics are covered, null otherwise (defer to AI).
 */
function checkProductFeatureQuestions(userMessage, state, convo) {
  if (!userMessage) return null;

  const featureChecks = [
    {
      pattern: /\b(es\s+)?raschel\b/i,
      response: "sí, es malla raschel de alta densidad (HDPE)"
    },
    {
      pattern: /\b(90|noventa)\s*%?(?!\s*(m|metro|x|\d))/i,
      response: "sí, manejamos 90% de sombra"
    },
    {
      pattern: /\b(80|ochenta|70|setenta|50|cincuenta|35|treinta\s*y\s*cinco)\s*%?(?!\s*(m|metro|x|\d))/i,
      response: "la malla confeccionada solo la manejamos en 90% de sombra; para otros porcentajes la manejamos en rollo de 100m de largo"
    },
    {
      pattern: /\b(porcentaje|nivel\s*de\s*sombra)\b/i,
      response: "la confeccionada es 90% de sombra"
    },
    {
      pattern: /\b(beige|caf[eé])\b/i,
      response: "el color disponible es beige"
    },
    {
      pattern: /\b(uv|rayos|sol)\b/i,
      response: "sí, tiene protección UV"
    },
    {
      pattern: /\b(lluvia|lluvias|llueve|agua|impermeable|impermeabiliza|mojarse|mojar|repele|repelente)\b/i,
      response: "no es impermeable — es un tejido permeable que deja pasar el agua; su función es dar sombra y protección UV"
    },
    {
      pattern: /\b(ojillos?|ojales?|arillos?|argollas?)\b/i,
      response: (msg) => {
        const word = /ojillo/i.test(msg) ? 'ojillos' : /ojale/i.test(msg) ? 'ojales' : /arillo/i.test(msg) ? 'arillos' : 'argollas';
        return `sí, viene con ${word} para sujeción cada 80 cm por lado`;
      }
    },
    {
      pattern: /\b(quitar\s*y\s*poner|poner\s*y\s*quitar|quita(r|ble)|desmontable|remov(er|ible)|retir(ar|able)|temporal)\b/i,
      response: "sí, se puede quitar y poner — viene con ojillos que permiten instalarla y retirarla fácilmente"
    },
    {
      pattern: /\b(t[eé]cnico|especialista|profesional|quien\s+(la\s+)?(instale|coloque|ponga)|f[aá]cil\s+de\s+instalar|dif[ií]cil\s+de\s+instalar)\b/i,
      response: "no necesita técnico — se instala con lazo o cable por los ojillos"
    },
    {
      pattern: /\b(garant[ií]a)\b/i,
      response: "tiene una vida útil de hasta 5 años"
    },
    {
      pattern: /\b(dur[ao]|vida\s*[uú]til|cu[aá]nto\s*(dura|aguanta|resiste))\b/i,
      response: "tiene una vida útil de hasta 5 años"
    },
  ];

  const matchedFeatures = featureChecks.filter(f => f.pattern.test(userMessage));
  if (matchedFeatures.length === 0) return null;

  // Completeness check: only return if ALL significant topics are covered
  let remaining = userMessage;
  for (const f of matchedFeatures) {
    remaining = remaining.replace(f.pattern, '');
  }
  const unmatchedTopics = /\b(lluvia|lluvias|agua|impermeable|mojarse|sol|uv|rayos|ojillos?|ojales?|refuerz|porcentaje|sombra|color|beige|negro|instala|garant[ií]a|dur[ao]|vida\s*[uú]til|material|grosor|peso|medida|resiste|aguanta|viento|clima|intemperie|t[eé]cnico|especialista|quitar|poner|desmonta|remov|retir)\b/i;

  if (unmatchedTopics.test(remaining)) {
    console.log(`⚠️ Feature regex matched partially but unmatched topics remain in: "${remaining.trim()}" — deferring to AI`);
    return null;
  }

  const responses = matchedFeatures.map(f => typeof f.response === 'function' ? f.response(userMessage) : f.response);

  const alreadyHasDimensions = state.width && state.height;
  const alreadyShownProduct = convo?.lastIntent === 'malla_complete' && convo?.productSpecs?.width;
  const followUp = (!alreadyHasDimensions && !alreadyShownProduct)
    ? "\n\n¿Qué medida necesitas?"
    : "\n\n¿Necesitas algo más?";

  if (responses.length === 1) {
    const text = responses[0].charAt(0).toUpperCase() + responses[0].slice(1);
    return { type: "text", text: `${text}.${followUp}` };
  }

  // Multiple answers — bullet list
  const bulletList = responses.map(r => `• ${r.charAt(0).toUpperCase() + r.slice(1)}`).join('\n');
  return { type: "text", text: `Te contesto:\n\n${bulletList}${followUp}` };
}

/**
 * Handle malla flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // ====== PENDING ZIP CODE RESPONSE ======
  // If we asked for zip/city before handoff, process the response
  if (convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('../utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) return pendingResult;
  }

  // Get current state
  let state = getFlowState(convo);

  console.log(`🌐 Malla flow - Current state:`, state);
  console.log(`🌐 Malla flow - Intent: ${intent}, Entities:`, entities);
  console.log(`🌐 Malla flow - User message: "${userMessage}"`);

  // ====== DUPLICATE QUOTE DETECTION ======
  // If user asks a simple price question and we already shared a quote for this size,
  // confirm the previous quote instead of generating a full new one
  if (convo?.lastSharedProductId && convo?.lastSharedProductLink && state.width && state.height) {
    const hasNewDimensions = (entities.width && entities.height) || parseDimensions(userMessage);
    const isSimplePriceAsk = !hasNewDimensions && (
      intent === 'price_query' ||
      /^¿?\s*(precio|presio|costo|cu[aá]nto\s*(cuesta|sale|es|vale)?)\s*[?!.]*$/i.test(userMessage.trim())
    );

    if (isSimplePriceAsk) {
      try {
        const lastProduct = await ProductFamily.findById(convo.lastSharedProductId).lean();
        if (lastProduct && lastProduct.price) {
          const sizeDisplay = `${Math.min(state.width, state.height)}x${Math.max(state.width, state.height)}`;
          console.log(`🔁 Duplicate quote detection: confirming ${sizeDisplay}m at $${lastProduct.price}`);
          await updateConversation(psid, { lastIntent: "price_reconfirmed", unknownCount: 0 });
          return {
            type: "text",
            text: `Sí, la de ${sizeDisplay}m está a $${lastProduct.price.toLocaleString()} con envío incluido.\n\nAquí te paso el link:\n${convo.lastSharedProductLink}`
          };
        }
      } catch (err) {
        console.error("⚠️ Duplicate quote check error:", err.message);
      }
    }
  }
  // ====== END DUPLICATE QUOTE DETECTION ======

  // ====== IMMEDIATE HANDOFF: non-90% shade percentage ======
  const nonStandardShade = /\b(al\s*)?(35|50|70|80)\s*(%|porciento|por\s*ciento)\b/i.test(userMessage);

  if (nonStandardShade) {
    const shadeMatch = userMessage.match(/\b(35|50|70|80)\s*(%|porciento|por\s*ciento)/i);
    const requestedShade = shadeMatch ? shadeMatch[1] : '';
    console.log(`🚨 Malla flow - Non-90% shade (${requestedShade}%) detected: "${userMessage}"`);

    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Malla sombra: porcentaje no estándar (${requestedShade}%, no 90%) — "${userMessage}"`,
      responsePrefix: `La malla confeccionada solo la manejamos en 90% de sombra, no tenemos en ${requestedShade}%. Para malla al ${requestedShade}% la manejamos en rollo de 100m de largo.`,
      lastIntent: 'malla_specialist_handoff',
      extraState: { productInterest: "malla_sombra" },
      timingStyle: 'elaborate',
      includeVideo: true
    });
  }

  // CHECK FOR PHOTO/IMAGE REQUEST WITH COLOR
  // E.g., "foto del negro", "imagen en color negro", "ver el verde"
  const photoColorPattern = /\b(foto|imagen|ver|mostrar|ense[ñn]ar?)\b.*\b(color\s*)?(negro|verde|beige|blanco|azul|caf[eé])\b/i;
  const colorOnlyPattern = /\b(el|la|del?|en)\s*(negro|verde|beige|blanco|azul|caf[eé])\b/i;

  const photoMatch = userMessage.match(photoColorPattern);
  const colorMatch = userMessage.match(colorOnlyPattern);

  if (photoMatch || (colorMatch && /\b(foto|imagen|ver|mostrar)\b/i.test(userMessage))) {
    const requestedColor = (photoMatch?.[3] || colorMatch?.[2] || '').toLowerCase();
    console.log(`🎨 Photo/color request detected: "${userMessage}" → color: ${requestedColor}`);

    // Check if we have dimensions in context
    const hasSize = (state.width && state.height) ||
                    (convo?.productSpecs?.width && convo?.productSpecs?.height);

    if (hasSize) {
      // We have size - find product and provide link
      const w = state.width || convo?.productSpecs?.width;
      const h = state.height || convo?.productSpecs?.height;

      // Update state with color preference
      state.color = requestedColor;

      // Find product with this size (color filtering will happen in search)
      const products = await findMatchingProducts(w, h, null, requestedColor, convo?.poiRootId);

      if (products.length > 0) {
        const product = products[0];
        const productUrl = product.onlineStoreLinks?.find(link => link.isPreferred)?.url ||
                          product.onlineStoreLinks?.[0]?.url;

        if (productUrl) {
          const trackedLink = await generateClickLink(psid, productUrl, {
            productName: product.name,
            productId: product._id
          });

          await updateConversation(psid, {
            lastIntent: 'malla_photo_provided',
            productSpecs: { ...convo?.productSpecs, color: requestedColor, updatedAt: new Date() }
          });

          return {
            type: "text",
            text: `Aquí puedes ver las fotos del producto en ${w}x${h}m:\n\n${trackedLink}\n\nEn la publicación encontrarás varias imágenes del producto.`
          };
        }
      }

      // No product found with that color/size combo
      return {
        type: "text",
        text: `No tenemos malla en color ${requestedColor} para ${w}x${h}m. La malla confeccionada es color beige.\n\n¿Te interesa ver el producto en beige?`
      };
    } else {
      // No size yet - save color preference and ask for size
      await updateConversation(psid, {
        lastIntent: 'malla_awaiting_dimensions',
        productSpecs: {
          productType: 'malla',
          color: requestedColor,
          updatedAt: new Date()
        }
      });

      return {
        type: "text",
        text: `¿Qué medida te interesa para mostrarte la imagen?`
      };
    }
  }

  // CHECK FOR ACCESSORY QUESTIONS (arnés, cuerda, lazo, kit de instalación)
  const isAccessoryQuestion = /\b(arn[eé]s|cuerda|lazo|amarre|kit.*instalaci|incluye.*para\s*(colgar|instalar)|viene\s*con|dan\s*con|trae)\b/i.test(userMessage);
  if (isAccessoryQuestion) {
    console.log(`🔧 Accessory question detected: "${userMessage}"`);
    return await handleAccessoryQuestion(psid, convo, userMessage);
  }

  // CHECK FOR MULTIPLE DIMENSIONS FIRST
  // If user asks for multiple sizes like "6x5 o 5x5", handle them together
  const allDimensions = extractAllDimensions(userMessage, 'confeccionada');

  if (allDimensions.length >= 2) {
    console.log(`🌐 Malla flow - Multiple dimensions detected: ${allDimensions.map(d => d.width + 'x' + d.height).join(', ')}`);
    return await handleMultipleDimensions(allDimensions, psid, convo);
  }

  // CHECK FOR CONFIRMATION of recommended size
  // When user says "Claro", "Sí", "Ok" etc. OR asks about price/that size after we recommended
  // Patterns: "ese tamaño", "esa medida", "la que me dices", "cuánto cuesta", "qué precio"
  const isReferringToRecommendation = convo?.recommendedSize && (
    intent === INTENTS.CONFIRMATION ||
    intent === INTENTS.PRICE_QUERY ||
    /\b(es[ea]\s*(tamaño|medida)|la\s*que\s*(me\s*)?(dices|recomiendas)|cu[aá]nto\s*(cuesta|sale|es)|qu[eé]\s*precio)\b/i.test(userMessage)
  );

  if (isReferringToRecommendation && convo?.lastIntent === "malla_awaiting_confirmation") {
    console.log(`🌐 Malla flow - User accepted recommended size: ${convo.recommendedSize}`);

    // Parse the recommended size and process it
    const sizeMatch = convo.recommendedSize.match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (sizeMatch) {
      const recWidth = parseInt(sizeMatch[1]);
      const recHeight = parseInt(sizeMatch[2]);

      // Update state with confirmed dimensions
      state.width = Math.min(recWidth, recHeight);
      state.height = Math.max(recWidth, recHeight);

      // Clear the awaiting confirmation state
      await updateConversation(psid, {
        lastIntent: "malla_confirmed_size",
        recommendedSize: null
      });

      // Process as complete with confirmed dimensions
      return await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
    }
  }

  // CHECK FOR "SHOW ALTERNATIVES" CONFIRMATION
  // When bot asked "¿Te muestro las alternativas?" and user says "sí", "muéstrame", "mándame opciones", etc.
  if (convo?.lastIntent === "awaiting_alternatives_confirmation") {
    const wantsToSeeAlternatives = /\b(s[ií]|cu[aá]les|ver|dale|claro|ok|va|por\s*favor|d[ií]me|ser[ií]an|opcio|mand|maneja|tienes?|tienen|aber)\b|mu[eé]str|ens[eé][ñn]|a\s*ver/i.test(userMessage);
    const explicitNo = /\b(no\b|nel|nah|nop|negativo|mejor\s*no|dejalo|d[eé]jalo|ya\s*no)/i.test(userMessage);
    // If no dimensions in the message and not a clear "no", assume they want to see options
    const hasDimensions = entities?.width && entities?.height;

    if (wantsToSeeAlternatives || (!explicitNo && !hasDimensions)) {
      console.log(`🌐 Malla flow - User wants to see alternatives for ${convo.requestedSize}`);

      // Get available sizes and show them
      const availableSizes = await getAvailableSizes(convo);

      if (availableSizes.length > 0) {
        // Parse the original requested size
        const reqMatch = (convo.requestedSize || '').match(/(\d+)x(\d+)/);
        const reqArea = reqMatch ? parseInt(reqMatch[1]) * parseInt(reqMatch[2]) : 0;

        // Find sizes closest to what they asked for
        const sizesWithArea = availableSizes.map(s => ({
          ...s,
          area: s.width * s.height
        }));

        // Sort by how close to requested area
        sizesWithArea.sort((a, b) => Math.abs(a.area - reqArea) - Math.abs(b.area - reqArea));

        // Take top 3-5 closest options
        const options = sizesWithArea.slice(0, 4);
        const optionsList = options.map(o => `• ${o.sizeStr} → $${o.price}`).join('\n');

        await updateConversation(psid, { lastIntent: "alternatives_shown" });

        return {
          type: "text",
          text: `No manejamos esa medida de línea, te ofrecemos estas opciones cercanas:\n\n${optionsList}\n\n¿Te interesa alguna o prefieres una fabricación a la medida?`
        };
      }

      // No alternatives available - hand off
      const { executeHandoff: execHandoff2 } = require('../utils/executeHandoff');
      return await execHandoff2(psid, convo, userMessage, {
        reason: `Sin alternativas para ${convo.requestedSize}`,
        responsePrefix: 'Déjame comunicarte con un especialista para buscar opciones para tu medida. ',
        specsText: 'Déjame comunicarte con un especialista para buscar opciones para tu medida. ',
        timingStyle: 'elaborate'
      });
    }
  }

  // FIRST: Check classifier entities (AI or quick classifier already extracted)
  if (entities.width && entities.height) {
    state.width = entities.width;
    state.height = entities.height;
    state.userExpressedSize = `${entities.width} x ${entities.height}`;
    console.log(`🌐 Malla flow - Using classifier entities: ${entities.width}x${entities.height}`);
  }
  if (!state.width || !state.height) {
    if (entities.dimensions) {
      const dims = parseDimensions(entities.dimensions);
      if (dims) {
        state.width = dims.width;
        state.height = dims.height;
        state.userExpressedSize = dims.userExpressed;
        if (dims.convertedFromFeet) {
          state.convertedFromFeet = true;
          state.originalFeetStr = dims.originalFeetStr;
        }
      }
    }
  }

  // SECOND: Regex fallback on raw message (safety net)
  if (!state.width || !state.height) {
    const dimsFromMessage = parseDimensions(userMessage);
    if (dimsFromMessage) {
      console.log(`🌐 Malla flow - Regex fallback: ${dimsFromMessage.width}x${dimsFromMessage.height}`);
      state.width = dimsFromMessage.width;
      state.height = dimsFromMessage.height;
      state.userExpressedSize = dimsFromMessage.userExpressed;
      if (dimsFromMessage.convertedFromFeet) {
        state.convertedFromFeet = true;
        state.originalFeetStr = dimsFromMessage.originalFeetStr;
      }
    }
  }

  // THIRD: Try single dimension - assume square (e.g., "2 y medio" -> 3x3)
  // BUT only for reasonable confeccionada sizes (2-10m), not roll sizes like 100m
  if (!state.width || !state.height) {
    const singleDim = parseSingleDimension(userMessage);
    // Sanity check: confeccionada single dimensions should be 2-10m
    // Numbers like 100 are roll lengths, not confeccionada sizes
    if (singleDim && singleDim >= 2 && singleDim <= 10) {
      const rounded = Math.round(singleDim);
      console.log(`🌐 Malla flow - Single dimension ${singleDim}m, assuming square ${rounded}x${rounded}`);
      state.width = rounded;
      state.height = rounded;
    } else if (singleDim && singleDim > 10) {
      console.log(`⚠️ Single dimension ${singleDim}m is too large for confeccionada, ignoring`);
    }
  }

  // CHECK FOR AREA (metros cuadrados) - offer closest standard sizes
  if (!state.width || !state.height) {
    const areaMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(?:metros?\s*cuadrados?|m2|m²)/i);
    if (areaMatch) {
      const requestedArea = parseFloat(areaMatch[1]);
      console.log(`📐 Area detected: ${requestedArea}m² - finding closest standard sizes`);

      // Find standard sizes close to this area (±2m²)
      const closestSizes = await findSizesNearArea(requestedArea, convo);

      if (closestSizes.length > 0) {
        const optionsList = closestSizes.map(s =>
          `• ${s.width}x${s.height}m (${s.area}m²) → $${s.price}`
        ).join('\n');

        await updateConversation(psid, {
          lastIntent: 'malla_area_options_shown',
          requestedArea: requestedArea,
          productInterest: 'malla_sombra'
        });

        return {
          type: "text",
          text: `${requestedArea} metros cuadrados puede ser varias medidas. Te muestro las más cercanas:\n\n${optionsList}\n\n¿Quieres los enlaces para comprar?`
        };
      }
    }
  }
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.quantity) {
    // Safeguard: if "quantity" equals a dimension, it's a parsing error (e.g., "10x5" → quantity=10, width=5)
    const qtyMatchesDimension = entities.quantity === state.width || entities.quantity === state.height;
    if (!qtyMatchesDimension) {
      state.quantity = entities.quantity;
    } else {
      console.log(`⚠️ Ignoring quantity=${entities.quantity} — matches dimension ${state.width}x${state.height}`);
    }
  }
  if (entities.concerns) {
    state.concerns = entities.concerns;
  }

  // Check if user is asking about product condition (new vs used)
  const conditionRequest = /\b(nuev[oa]s?|usad[oa]s?|segunda\s*mano|de\s*segunda|reciclad[oa]s?)\b/i;
  const isAskingAboutCondition = userMessage && conditionRequest.test(userMessage);

  if (isAskingAboutCondition) {
    const response = await generateBotResponse("product_condition", {
      isNew: true,
      isManufacturer: true,
      convo
    });
    return { type: "text", text: response };
  }

  // Check if user is asking for product INFO (not trying to buy yet)
  const infoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|c[oó]mo\s*(es|son)|de\s*qu[eé]\s*(es|est[aá]|material)|qu[eé]\s*(es|son)|especificaciones?|detalles?|descripci[oó]n)\b/i;
  const isAskingForInfo = userMessage && infoRequest.test(userMessage);

  if (isAskingForInfo && !state.width) {
    // User wants to know about the product, not buy yet
    // IMPORTANT: Save context so next message stays in malla flow
    await updateConversation(psid, {
      lastIntent: 'malla_info',
      productInterest: 'malla_sombra',
      productSpecs: {
        productType: 'malla',
        updatedAt: new Date()
      }
    });
    return await handleProductInfo(userMessage, convo);
  }

  // ====== RESELLER / DISTRIBUTOR INTENT (any stage) ======
  // "para vender", "incursionar para vender", "quiero revender", "ser distribuidor", etc.
  if (userMessage && (
    /\b(para\s+vender|incursionar.*vender|quiero\s+vender|empezar\s+a\s+vender|vender\s+en\s+mi)\b/i.test(userMessage) ||
    /\b(distribuid|mayorist|revend|mayoreo|distribuc|ser\s+distribuid|hacerme\s+distribuid|busco\s+proveed)\b/i.test(userMessage) ||
    /\b(paquetes?.*para\s+vend|para\s+mi\s+(negocio|tienda|local|ferreter[ií]a|comercio))\b/i.test(userMessage) ||
    /\b(quiero\s+distribui|soy\s+(vendedor|comerciante)|tengo\s+(un\s+)?(negocio|tienda|ferreter[ií]a|local))\b/i.test(userMessage)
  )) {
    console.log(`🏪 Reseller/distributor intent detected in malla flow (any stage)`);
    const { getBusinessInfo } = require("../../businessInfoManager");
    const info = await getBusinessInfo();

    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Cliente quiere revender/distribuir: "${userMessage.substring(0, 80)}"`,
      responsePrefix: "¡Excelente! Somos fabricantes y trabajamos con distribuidores en todo México.\n\n" +
            "Un especialista te contactará para darte información sobre paquetes y precios de mayoreo.\n\n" +
            `📞 ${info?.phones?.[0] || "442 352 1646"}\n` +
            `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`,
      lastIntent: 'reseller_inquiry',
      notificationText: `Cliente quiere revender: "${userMessage.substring(0, 60)}"`,
      extraState: { isWholesaleInquiry: true, productInterest: convo?.productInterest || "wholesale" },
      timingStyle: 'none',
      includeQueretaro: false
    });
  }

  // ====== ROLL-SIZE DETECTION (any stage) ======
  // If any dimension > 12m, this is a roll request, not confeccionada.
  // Confeccionada goes up to ~7x10m. Rolls are 3x100, 4x50, etc.
  if (state.width && state.height && Math.max(state.width, state.height) > 12) {
    const rollSize = `${Math.min(state.width, state.height)}x${Math.max(state.width, state.height)}`;
    console.log(`📦 Roll-size detected in malla flow: ${rollSize}m — handing off`);

    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Rollo de malla sombra: ${rollSize}m (no confeccionada)`,
      responsePrefix: `La medida ${rollSize}m es un rollo de malla sombra. Para cotización de rollos te comunico con un especialista. `,
      specsText: `Rollo de ${rollSize}m. `,
      lastIntent: 'roll_handoff',
      notificationText: `Rollo ${rollSize}m desde flujo confeccionada`,
      extraState: { productInterest: 'rollo_malla_sombra' },
      timingStyle: 'elaborate',
      includeVideo: true
    });
  }

  // ====== PRODUCT FEATURE QUESTIONS (any stage) ======
  // Answer product questions regardless of whether dimensions are already known
  const featureResponse = checkProductFeatureQuestions(userMessage, state, convo);
  if (featureResponse) {
    await updateConversation(psid, { lastIntent: 'malla_feature_answer', unknownCount: 0 });
    return featureResponse;
  }

  // Determine current stage
  const stage = determineStage(state);

  // ====== AI FALLBACK: when we quoted products and user responds but regex can't parse ======
  if (stage === STAGES.AWAITING_DIMENSIONS &&
      convo?.lastQuotedProducts?.length > 0 &&
      userMessage) {
    const aiResult = await resolveWithAI({
      psid,
      userMessage,
      flowType: 'malla',
      stage: convo?.lastIntent || 'awaiting_dimensions',
      basket: convo?.productSpecs,
      lastQuotedProducts: convo.lastQuotedProducts
    });

    if (aiResult.confidence >= 0.7) {
      if ((aiResult.action === 'select_products' || aiResult.action === 'select_one') &&
          convo.lastQuotedProducts.length > 0) {
        const selectionResponse = await handleQuoteSelection(aiResult, convo.lastQuotedProducts, psid, convo);
        if (selectionResponse) return selectionResponse;
      }

      if (aiResult.action === 'provide_dimensions' && aiResult.dimensions) {
        state.width = aiResult.dimensions.width;
        state.height = aiResult.dimensions.height;
        return await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
      }

      if (aiResult.action === 'answer_question' && aiResult.text) {
        await updateConversation(psid, { lastIntent: 'malla_ai_answered', unknownCount: 0 });
        return { type: "text", text: aiResult.text };
      }
    }
    // If AI returned "none" or low confidence, fall through to normal flow
  }

  // Generate response based on stage
  let response;

  switch (stage) {
    case STAGES.AWAITING_DIMENSIONS:
      response = await handleAwaitingDimensions(intent, state, sourceContext, userMessage, convo, psid);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
      break;

    default:
      response = await handleStart(sourceContext, convo);
  }

  // Save updated specs (but don't overwrite if we're awaiting confirmation)
  const convoNow = await require("../../conversationManager").getConversation(psid);
  if (convoNow?.lastIntent !== "malla_awaiting_confirmation") {
    await updateConversation(psid, {
      lastIntent: `malla_${stage}`,
      productInterest: "malla_sombra",
      productSpecs: {
        productType: "malla",
        width: state.width,
        height: state.height,
        percentage: state.percentage,
        color: state.color,
        quantity: state.quantity,
        updatedAt: new Date()
      }
    });
  }

  return response;
}

/**
 * Get the standard product description + price range for malla confeccionada.
 * This should ALWAYS be sent on first contact or info requests.
 */
async function getMallaDescription() {
  // Get dynamic price range from database
  let priceMin = 350, priceMax = 3450, sizeMin = '2x2m', sizeMax = '7x10m';
  try {
    const products = await ProductFamily.find({
      sellable: true, active: true,
      size: { $regex: /^\d+\s*[xX×]\s*\d+/, $options: 'i' },
      price: { $gt: 0 },
      'dimensionUnits.width': { $ne: 'cm' }
    }).sort({ price: 1 }).lean();

    // Filter to confeccionada only (exclude rolls — any dimension >= 50m)
    const confec = products.filter(p => {
      const m = p.size?.match(/(\d+)\s*[xX×]\s*(\d+)/);
      if (!m) return false;
      return Math.max(parseInt(m[1]), parseInt(m[2])) < 50;
    });

    if (confec.length > 0) {
      priceMin = Math.round(confec[0].price);
      priceMax = Math.round(confec[confec.length - 1].price);

      // Compute actual size range from DB
      const sizes = confec.map(p => {
        const m = p.size.match(/(\d+)\s*[xX×]\s*(\d+)/);
        return { w: Math.min(parseInt(m[1]), parseInt(m[2])), h: Math.max(parseInt(m[1]), parseInt(m[2])) };
      });
      const smallestArea = sizes.reduce((min, s) => s.w * s.h < min.w * min.h ? s : min, sizes[0]);
      const largestArea = sizes.reduce((max, s) => s.w * s.h > max.w * max.h ? s : max, sizes[0]);
      sizeMin = `${smallestArea.w}x${smallestArea.h}m`;
      sizeMax = `${largestArea.w}x${largestArea.h}m`;
    }
  } catch (err) {
    console.error("❌ Error getting malla price range:", err.message);
  }

  return `Nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV.\n\n` +
    `Viene con refuerzo en las esquinas para una vida útil de hasta 5 años, y con ojillos para sujeción cada 80 cm por lado, lista para instalar. El envío está incluido.\n\n` +
    `Manejamos medidas desde ${sizeMin} hasta ${sizeMax}, con precios desde ${formatMoney(priceMin)} hasta ${formatMoney(priceMax)}.\n\n` +
    `¿Qué medida te interesa?`;
}

/**
 * Handle product info request - user asking about characteristics
 */
async function handleProductInfo(userMessage, convo) {
  const description = await getMallaDescription();
  return { type: "text", text: description };
}

/**
 * Handle start - user just mentioned malla
 * Always sends the full product description with price range
 */
async function handleStart(sourceContext, convo) {
  const description = await getMallaDescription();
  return { type: "text", text: description };
}

/**
 * Handle awaiting dimensions stage
 */
async function handleAwaitingDimensions(intent, state, sourceContext, userMessage = '', convo = null, psid = null) {
  // Check if user is asking about max/min size (e.g., "de cuantos metros es de ancha maximo")
  const maxSizePattern = /\b(m[aá]xim[oa]|m[aá]s\s+(grande|anch[oa]|larg[oa])|cu[aá]nto\s+de\s+anch|metros\s+.*\s+m[aá]xim|anch[oa]\s+m[aá]xim|larg[oa]\s+m[aá]xim)\b/i;
  if (userMessage && maxSizePattern.test(userMessage)) {
    console.log(`📏 Max size question detected in awaiting_dimensions: "${userMessage}"`);
    const availableSizes = await getAvailableSizes(convo);
    if (availableSizes.length > 0) {
      const sorted = [...availableSizes].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
      const largest = sorted[0];
      // Find max width (the smaller dimension across all products)
      const maxWidth = Math.max(...availableSizes.map(s => Math.min(s.width || 0, s.height || 0)));
      const maxLength = Math.max(...availableSizes.map(s => Math.max(s.width || 0, s.height || 0)));
      await updateConversation(psid, { lastIntent: "max_size_answered", unknownCount: 0 });
      return {
        type: "text",
        text: `La malla más ancha que manejamos es de ${maxWidth} metros, y de largo hasta ${maxLength} metros.\n\nLa medida más grande disponible es ${largest.sizeStr} a $${largest.price}.\n\n¿Te interesa esa u otra medida?`
      };
    }
  }

  // Check if user is asking about custom sizes ("hacen la medida que necesita?", "a la medida?")
  const customSizePattern = /\b(hacen|fabrican|tienen|manejan|pueden)\b.*(medida|tamaño).*(necesit|quier|pid|ocup|exact|personalizad|especial|cualquier)/i;
  const customSizeAlt = /\b(a\s+la\s+medida|sobre\s*medida|cualquier\s*(medida|tamaño)|medidas?\s+(personalizad|especial|custom))\b/i;
  if (userMessage && (customSizePattern.test(userMessage) || customSizeAlt.test(userMessage))) {
    console.log(`📐 Custom size question detected in malla flow`);
    await updateConversation(psid, { lastIntent: "custom_size_confirmed", unknownCount: 0 });
    return {
      type: "text",
      text: `¡Sí! Somos fabricantes y hacemos la malla sombra a la medida que necesites.\n\n` +
            `Tenemos medidas estándar listas para envío inmediato, y si necesitas una medida especial la fabricamos.\n\n` +
            `¿Qué medida necesitas?`
    };
  }

  // Check if user is asking about price per meter (not a standard confeccionada query)
  const perMeterPattern = /\b(cu[aá]nto|precio|vale|cuesta)\s+(?:el\s+)?metro\b/i;
  if (userMessage && perMeterPattern.test(userMessage)) {
    console.log(`📏 Price-per-meter question detected in malla flow`);
    await updateConversation(psid, { lastIntent: "price_by_meter", unknownCount: 0 });
    return {
      type: "text",
      text: "No vendemos por metro, sino por medidas específicas ya confeccionadas (2x2m, 3x4m, 4x6m, etc.).\n\n" +
            "Si necesitas comprar malla en rollo completo (por metro), vendemos rollos de:\n" +
            "• 4.20m x 100m\n" +
            "• 2.10m x 100m\n\n" +
            "¿Qué te interesa: una medida específica confeccionada o un rollo completo?"
    };
  }

  // Check if user is asking about wholesale QUALIFICATION (e.g. "3 ya es mayoreo?")
  // Answer directly with the minimum instead of handing off
  if (userMessage && /\b(mayoreo|mayorist)\b/i.test(userMessage) && convo?.lastSharedProductId) {
    const qtyMatch = userMessage.match(/\b(\d+)\s*(?:piezas?|unidades?|mallas?)?\b/i);
    try {
      const quotedProduct = await ProductFamily.findById(convo.lastSharedProductId).lean();
      if (quotedProduct?.wholesaleMinQty) {
        const minQty = quotedProduct.wholesaleMinQty;
        if (qtyMatch) {
          const requestedQty = parseInt(qtyMatch[1]);
          if (requestedQty < minQty) {
            console.log(`📦 Wholesale min clarification: ${requestedQty} < ${minQty}`);
            await updateConversation(psid, { lastIntent: "wholesale_min_clarified", unknownCount: 0 });
            return {
              type: "text",
              text: `El precio de mayoreo es a partir de ${minQty} piezas de la misma medida. Con ${requestedQty} piezas aplica el precio normal de ${formatMoney(quotedProduct.price)} cada una.\n\n¿Te gustaría ordenar las ${requestedQty} piezas al precio normal?`
            };
          }
          // Quantity meets minimum — hand off for wholesale pricing
        }
        // No quantity mentioned — just asking about wholesale, reiterate the minimum
        if (!qtyMatch) {
          console.log(`📦 Wholesale min reiteration: min is ${minQty}`);
          await updateConversation(psid, { lastIntent: "wholesale_min_clarified", unknownCount: 0 });
          return {
            type: "text",
            text: `El precio de mayoreo es a partir de ${minQty} piezas de la misma medida. ¿Cuántas piezas necesitas?`
          };
        }
      }
    } catch (err) {
      console.error("Error checking wholesale min:", err.message);
    }
  }

  // Check if user is asking about wholesale/distributor
  const distributorPattern = /\b(distribuid|mayorist|revend|mayoreo|distribuc|publicidad.*distribui)\b/i;
  if (userMessage && distributorPattern.test(userMessage)) {
    console.log(`🏪 Distributor/wholesale question detected in malla flow`);
    const info = await getBusinessInfo();

    const { executeHandoff } = require('../utils/executeHandoff');
    return await executeHandoff(psid, convo, userMessage, {
      reason: `Consulta de distribuidores/mayoreo: "${userMessage}"`,
      responsePrefix: "Somos fabricantes de malla sombra y buscamos distribuidores.\n\n" +
            "Para cotizaciones de mayoreo, comunícate con nuestro equipo:\n\n" +
            `📞 ${info?.phones?.join(" / ") || "442 595 7432"}\n` +
            `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`,
      lastIntent: 'reseller_inquiry',
      notificationText: `Consulta de distribuidores: "${userMessage}"`,
      skipChecklist: true,
      timingStyle: 'none',
      includeQueretaro: false
    });
  }

  // Check if user is frustrated about repeating info ("ya te dije", "ya te di las medidas")
  const alreadyToldPattern = /\b(ya\s+te\s+di(je)?|ya\s+lo\s+di(je)?|ya\s+mencion[eé]|te\s+dije|las?\s+medidas?\s+ya)\b/i;
  if (userMessage && alreadyToldPattern.test(userMessage)) {
    // Check if we have dimensions in conversation
    if (convo?.productSpecs?.width && convo?.productSpecs?.height) {
      const w = convo.productSpecs.width;
      const h = convo.productSpecs.height;
      const response = await generateBotResponse("frustration_recovery", {
        hasSizeContext: true,
        previousSize: `${w}x${h}m`,
        convo
      });
      return { type: "text", text: response };
    }
    // No dimensions found - apologize and ask nicely
    const response = await generateBotResponse("frustration_recovery", {
      hasProductContext: true,
      convo
    });
    return { type: "text", text: response };
  }

  // CHECK FOR LOCATION - if user is providing city/alcaldía/zipcode
  // and we already have dimensions, respond with shipping info
  const locationInfo = detectMexicanLocation(userMessage);
  const zipcodeInfo = detectZipCode(userMessage);

  if (locationInfo || zipcodeInfo) {
    // User is giving location info
    const hasDimensions = (convo?.productSpecs?.width && convo?.productSpecs?.height) ||
                          convo?.requestedSize;

    if (hasDimensions) {
      // We already have dimensions - acknowledge location and provide shipping info
      const locationName = locationInfo?.normalized || zipcodeInfo;
      const cityForDisplay = locationInfo?.type === 'alcaldia'
        ? `${locationInfo.location.charAt(0).toUpperCase() + locationInfo.location.slice(1)}, CDMX`
        : locationInfo?.normalized || locationName;

      return {
        type: "text",
        text: `¡Sí! Enviamos a ${cityForDisplay} a través de Mercado Libre.\n\n` +
              `El envío tarda entre 3-5 días hábiles. El costo lo calcula ML según tu código postal exacto.\n\n` +
              `¿Te paso el link de compra?`
      };
    }
    // If no dimensions yet but they gave location, still ask for dimensions
    // but acknowledge the location
    const cityName = locationInfo?.normalized || 'tu zona';
    return {
      type: "text",
      text: `Perfecto, sí enviamos a ${cityName}.\n\n¿Qué medida necesitas?`
    };
  }

  // Check if they're asking for info even at this stage
  const infoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|c[oó]mo\s*(es|son)|de\s*qu[eé]|especificaciones?)\b/i;
  if (userMessage && infoRequest.test(userMessage)) {
    return await handleProductInfo(userMessage, convo);
  }

  // Check if they're asking what sizes/prices are available
  // "que tamaños son", "qué medidas tienen", "cuáles medidas", "q salen", "medidas y precios"
  const sizesListRequest = /\b(qu[eé]|cu[aá]l(es)?)\s*(tamaños?|medidas?|dimensiones?)\s*(son|hay|tienen|manejan|disponibles?)?\b/i.test(userMessage) ||
                           /\b(tamaños?|medidas?)\s*(disponibles?|tienen|manejan|hay)\b/i.test(userMessage) ||
                           /\b(q|que|qué)\s+salen\b/i.test(userMessage) ||
                           /\b(medidas?|tamaños?)\s*(y|con)\s*(precios?|costos?)\b/i.test(userMessage) ||
                           /\b(precios?|costos?)\s*(y|con)\s*(medidas?|tamaños?)\b/i.test(userMessage);

  if (sizesListRequest) {
    // Send full product description with price range
    return await handleProductInfo(userMessage, convo);
  }

  // Price per square meter — answer with base price explanation
  if (/\b(metro\s*\.?\s*cuadrado|m2|m²)\b/i.test(userMessage) &&
      /\b(precio|cu[aá]nto|costo|vale|cuesta|a\s*c[oó]mo|como)\b/i.test(userMessage)) {
    return {
      type: "text",
      text: "El precio base del metro cuadrado es de 30 pesos pero varía dependiendo de la dimensión, entre más grande es, más baja el precio por metro cuadrado.\n\n¿Qué medida te interesa?"
    };
  }

  // If they're asking about prices without dimensions
  if (intent === INTENTS.PRICE_QUERY) {
    // Send full product description with price range
    return await handleProductInfo(userMessage, convo);
  }

  // Check for product feature questions (shared handler — also runs in handle() for COMPLETE stage)
  const featureResponse = checkProductFeatureQuestions(userMessage, state, convo);
  if (featureResponse) return featureResponse;

  // Check if user mentioned an object they want to cover (carro, cochera, patio, etc.)
  // Skip if user is referring to Hanlob's store (su tienda, la tienda, visito en la tienda)
  const isReferringToHanlobStore = /\b(su\s+tienda|la\s+tienda|visito?\s+(en\s+)?(su\s+|la\s+)?tienda|tienda\s+de\s+ustedes)\b/i.test(userMessage);

  const objectPatterns = [
    { pattern: /\b(carro|coche|auto|veh[ií]culo|camioneta)\b/i, object: "carro" },
    { pattern: /\b(cochera|garaje|garage)\b/i, object: "cochera" },
    { pattern: /\b(patio|jard[ií]n)\b/i, object: "patio" },
    { pattern: /\b(terraza|balc[oó]n)\b/i, object: "terraza" },
    { pattern: /\b(ventana|ventanal)\b/i, object: "ventana" },
    { pattern: /\b(puerta|entrada)\b/i, object: "puerta" },
    { pattern: /\b(estacionamiento|parking)\b/i, object: "estacionamiento" },
    { pattern: /\b(negocio|local|tienda)\b/i, object: "negocio", skipIfHanlobStore: true },
    { pattern: /\b(alberca|piscina)\b/i, object: "alberca" }
  ];

  for (const { pattern, object, skipIfHanlobStore } of objectPatterns) {
    if (pattern.test(userMessage)) {
      // Skip "tienda/negocio/local" if user is referring to Hanlob's store
      if (skipIfHanlobStore && isReferringToHanlobStore) {
        continue;
      }
      return {
        type: "text",
        text: `¿Qué dimensiones tiene tu ${object}?`
      };
    }
  }

  // DELEGATE TO GLOBAL INTENTS - FALLBACK for intents not handled by dispatcher
  // Most cross-cutting intents (color_query, shipping, frustration) are now handled
  // by the Intent Dispatcher BEFORE flows. This is kept as fallback during migration.
  // TODO: Remove this delegation once all intents are migrated to handlers
  const globalResponse = await handleGlobalIntents(userMessage, psid, convo);
  if (globalResponse) {
    console.log(`🌐 Malla flow delegated to global intents (fallback)`);
    return globalResponse;
  }

  // First contact or no dimensions yet — send full product description
  // If we've already shown the description, just ask for dimensions
  const alreadyDescribed = convo?.lastIntent?.startsWith('malla_');
  if (!alreadyDescribed) {
    return await handleProductInfo(userMessage, convo);
  }

  // ====== AI FALLBACK at end of handleAwaitingDimensions ======
  // Before giving up with static text, try AI if we have quoted products
  if (userMessage && convo?.lastQuotedProducts?.length > 0) {
    const aiResult = await resolveWithAI({
      psid,
      userMessage,
      flowType: 'malla',
      stage: 'awaiting_dimensions_end',
      basket: convo?.productSpecs,
      lastQuotedProducts: convo.lastQuotedProducts
    });

    if (aiResult.confidence >= 0.7) {
      if ((aiResult.action === 'select_products' || aiResult.action === 'select_one') &&
          convo.lastQuotedProducts.length > 0) {
        const selectionResponse = await handleQuoteSelection(aiResult, convo.lastQuotedProducts, psid, convo);
        if (selectionResponse) return selectionResponse;
      }

      if (aiResult.action === 'provide_dimensions' && aiResult.dimensions) {
        const newState = getFlowState(convo);
        newState.width = aiResult.dimensions.width;
        newState.height = aiResult.dimensions.height;
        return await handleComplete(null, newState, null, psid, convo, userMessage);
      }

      if (aiResult.action === 'answer_question' && aiResult.text) {
        await updateConversation(psid, { lastIntent: 'malla_ai_answered', unknownCount: 0 });
        return { type: "text", text: aiResult.text };
      }
    }
  }

  return {
    type: "text",
    text: "¿Qué medida necesitas?"
  };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '') {
  const { width, height, percentage, color, quantity, userExpressedSize, concerns, convertedFromFeet, originalFeetStr } = state;

  // ====== WHOLESALE MINIMUM CLARIFICATION ======
  // If customer asks about wholesale and we just quoted a product, answer with the minimum
  if (userMessage && /\b(mayoreo|mayorist)\b/i.test(userMessage) && convo?.lastSharedProductId) {
    try {
      const quotedProd = await ProductFamily.findById(convo.lastSharedProductId).lean();
      if (quotedProd?.wholesaleMinQty) {
        const minQty = quotedProd.wholesaleMinQty;
        const qtyM = userMessage.match(/\b(\d+)\s*(?:piezas?|unidades?|mallas?)?\b/i);
        if (qtyM) {
          const reqQty = parseInt(qtyM[1]);
          if (reqQty < minQty) {
            console.log(`📦 handleComplete: wholesale min clarification ${reqQty} < ${minQty}`);
            await updateConversation(psid, { lastIntent: "wholesale_min_clarified", unknownCount: 0 });
            return {
              type: "text",
              text: `El precio de mayoreo es a partir de ${minQty} piezas de la misma medida. Con ${reqQty} piezas aplica el precio normal de ${formatMoney(quotedProd.price)} cada una.\n\n¿Te gustaría ordenar las ${reqQty} piezas al precio normal?`
            };
          }
        } else {
          await updateConversation(psid, { lastIntent: "wholesale_min_clarified", unknownCount: 0 });
          return {
            type: "text",
            text: `El precio de mayoreo es a partir de ${minQty} piezas de la misma medida. ¿Cuántas piezas necesitas?`
          };
        }
      }
    } catch (err) {
      console.error("Error checking wholesale min in handleComplete:", err.message);
    }
  }

  // ====== GENERAL QUESTIONS GUARD ======
  // If the customer is asking a general question (not about dimensions/pricing),
  // answer it instead of re-quoting the same product.
  if (userMessage && convo?.lastSharedProductId) {
    const msg = userMessage.toLowerCase();

    // Does the message contain new dimensions or price-related keywords?
    const hasNewDimensions = parseDimensions(userMessage);
    const isPriceRelated = /\b(precio|presio|costo|cu[aá]nto|vale|cuesta|cotiza|descuento|oferta|mayoreo)\b/i.test(msg);
    const isConfirmation = /\b(s[ií]|ok|va|dale|lo quiero|la quiero|compro|llev[oa]|perfecto|esa|ese|mand[ae])\b/i.test(msg);
    const isNewSize = /\b(\d+\s*[xX×]\s*\d+|\d+\s*por\s*\d+)\b/.test(msg);

    // If the message has NO dimension/price/confirmation intent, check for general questions
    if (!hasNewDimensions && !isPriceRelated && !isConfirmation && !isNewSize) {
      // Ordering process questions
      const MAPS_URL = 'https://maps.app.goo.gl/WJbhpMqfUPYPSMdA7';
      if (/\b(pedido|orden|compra)\s+(se\s+)?(hace|realiza|es)\s+(por|en|a\s+trav[eé]s)/i.test(msg) ||
          /\b(por\s+(este\s+medio|aqu[ií]|mensaj|chat|facebook|messenger|inbox))\s*(se\s+)?(compra|pide|ordena|hace|realiza)?\b/i.test(msg) ||
          /\b(c[oó]mo|d[oó]nde)\s+(compro|pido|ordeno|hago\s+(el\s+)?pedido)\b/i.test(msg) ||
          /\b(se\s+puede|puedo)\s+(comprar|pedir|ordenar)\s+(por|en)\s*(aqu[ií]|este\s+medio|chat|messenger)\b/i.test(msg) ||
          /\b(pedir|comprar|ordenar)\s+(por|en|a\s+trav[eé]s\s+de)\s*(mercado|ml)\b/i.test(msg) ||
          /\b(por\s+mercado|en\s+mercado|mercado\s+(libre|pago))\b/i.test(msg) ||
          /\btengo\s+que\s+pedir\b/i.test(msg)) {
        await updateConversation(psid, { lastIntent: 'purchase_process', unknownCount: 0 });
        const link = convo.lastSharedProductLink;
        return {
          type: "text",
          text: link
            ? `Puedes comprarla en Mercado Libre a través del enlace que te compartí:\n${link}\n\nO si prefieres, puedes visitarnos en nuestra tienda física:\n${MAPS_URL}`
            : `Puedes comprarla en nuestra tienda de Mercado Libre, o visitarnos en nuestra tienda física:\n${MAPS_URL}`
        };
      }

      // Shipping / delivery questions
      if (/\b(entreg|env[ií]|llega|domicilio|paqueter[ií]a|mensajer[ií]a|recib[oi]|tarda|demora|d[ií]as\s+h[aá]biles)\b/i.test(msg)) {
        await updateConversation(psid, { lastIntent: 'shipping_question', unknownCount: 0 });
        return {
          type: "text",
          text: "La compra se realiza a través de Mercado Libre y el envío está incluido. Normalmente tarda de 3 a 5 días hábiles.\n\n¿Necesitas algo más?"
        };
      }

      // Pay on delivery — crystal clear NO
      if (/\b(contra\s*entrega|pag[oa]\s+(al\s+)?(recibir|entreg)|cuando\s+(me\s+)?lleg|al\s+recibir|cobr[ao]\s+al)\b/i.test(msg)) {
        await updateConversation(psid, { lastIntent: 'pay_on_delivery_query', unknownCount: 0 });
        return {
          type: "text",
          text: "No manejamos pago contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero."
        };
      }

      // Payment questions
      if (/\b(pag[oa]|tarjeta|efectivo|transfer|meses|oxxo|dep[oó]sito|forma\s+de\s+pago|m[eé]todo\s+de\s+pago)\b/i.test(msg)) {
        await updateConversation(psid, { lastIntent: 'payment_question', unknownCount: 0 });
        return {
          type: "text",
          text: "En compras a través de Mercado Libre el pago es 100% por adelantado al momento de ordenar (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero."
        };
      }
    }
  }

  // Parse zip code from message if provided
  const zipInfo = await parseAndLookupZipCode(userMessage);
  if (zipInfo) {
    // Save location info to conversation
    await updateConversation(psid, {
      zipCode: zipInfo.code,
      city: zipInfo.city,
      state: zipInfo.state,
      shippingZone: zipInfo.shipping?.text || '3-5 días hábiles'
    });
  }

  // Check if dimensions are fractional - offer the immediate smaller standard size
  const hasFractions = (width % 1 !== 0) || (height % 1 !== 0);

  if (hasFractions) {
    const fractionalKey = `${Math.min(width, height)}x${Math.max(width, height)}`;
    const isInsisting = convo?.lastFractionalSize === fractionalKey;

    // Customer insists on exact fractional size - hand off to human
    if (isInsisting) {
      console.log(`📏 Customer insists on ${fractionalKey}m, handing off`);

      const aiResponse = await generateBotResponse("specialist_handoff", {
        dimensions: `${width}x${height}m`,
        videoLink: "https://youtube.com/shorts/XLGydjdE7mY"
      });

      const { executeHandoff: execHandoff3 } = require('../utils/executeHandoff');
      return await execHandoff3(psid, convo, userMessage, {
        reason: `Medida con decimales: ${width}x${height}m (insiste en medida exacta)`,
        responsePrefix: aiResponse,
        specsText: `Malla de ${width}x${height}m. `,
        lastIntent: 'fractional_meters_handoff',
        notificationText: `Medida con decimales: ${width}x${height}m - cliente insiste en medida exacta`,
        timingStyle: 'none',
        includeQueretaro: false
      });
    }

    // First time - only floor the fractional dimension(s), keep whole-number dimensions as-is
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);
    const flooredW = (minDim % 1 !== 0) ? Math.floor(minDim) : minDim;
    const flooredH = (maxDim % 1 !== 0) ? Math.floor(maxDim) : maxDim;
    console.log(`📏 Fractional size ${width}x${height}m → offering ${flooredW}x${flooredH}m`);

    try {
      const sizeVariants = [
        `${flooredW}x${flooredH}`, `${flooredW}x${flooredH}m`,
        `${flooredH}x${flooredW}`, `${flooredH}x${flooredW}m`
      ];

      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: true
      });

      if (product) {
        const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
        const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

        if (productUrl) {
          const trackedLink = await generateClickLink(psid, productUrl, {
            productName: product.name,
            productId: product._id,
            city: convo?.city,
            stateMx: convo?.stateMx
          });

          const salesPitch = await formatProductResponse(product, {
            price: product.price,
            userExpressedSize: `${flooredW} x ${flooredH} m`
          });

          await updateConversation(psid, {
            lastIntent: "size_confirmed",
            lastSharedProductId: product._id?.toString(),
            lastSharedProductLink: productUrl,
            lastFractionalSize: fractionalKey,
            unknownCount: 0
          });

          // Build explanation — different for feet conversion vs. fractional meters
          let explanation;
          if (convertedFromFeet) {
            explanation = `📏 Tu medida de ${originalFeetStr} equivale a aproximadamente ${width}x${height} metros.\n\nLa medida más cercana que manejamos es ${flooredW}x${flooredH}m:`;
          } else {
            explanation = `Te ofrecemos ${flooredW}x${flooredH} ya que es necesario considerar un tamaño menor para dar espacio a los tensores o soga sujetadora.`;
          }

          return {
            type: "text",
            text: `${explanation}\n\n${salesPitch}\n🛒 Cómprala aquí:\n${trackedLink}`
          };
        }
      }
    } catch (err) {
      console.error("Error getting floored size:", err);
    }

    // No standard size found - hand off directly
    const aiResponse4 = await generateBotResponse("specialist_handoff", {
      dimensions: `${width}x${height}m`,
      videoLink: "https://youtube.com/shorts/XLGydjdE7mY"
    });

    const { executeHandoff: execHandoff4 } = require('../utils/executeHandoff');
    return await execHandoff4(psid, convo, userMessage, {
      reason: `Medida con decimales: ${width}x${height}m`,
      responsePrefix: aiResponse4,
      specsText: `Malla de ${width}x${height}m. `,
      lastIntent: 'fractional_meters_handoff',
      notificationText: `Medida con decimales: ${width}x${height}m - requiere atención`,
      timingStyle: 'none',
      includeQueretaro: false
    });
  }

  // Check if this is a custom order (both sides >= 8m)
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);

  if (minSide >= 8 && maxSide >= 8) {
    // Custom order - hand off to specialist immediately
    console.log(`🏭 Custom order detected in mallaFlow (${width}x${height}m), handing off to specialist`);

    const handoffReason = `Medida grande: ${width}x${height}m (ambos lados ≥8m)`;

    const { executeHandoff: execHandoff5 } = require('../utils/executeHandoff');
    return await execHandoff5(psid, convo, userMessage, {
      reason: handoffReason,
      responsePrefix: 'Permíteme contactarte con un especialista para cotizarte esa medida. ',
      specsText: `Malla de ${width}x${height}m. `,
      lastIntent: 'custom_order_handoff',
      extraState: { customOrderSize: `${width}x${height}m` },
      timingStyle: 'none'
    });
  }

  // ====== POI TREE CHECK ======
  // If conversation has a locked POI, check that requested variant exists in tree
  if (convo?.poiRootId) {
    const sizeQuery = `${Math.min(width, height)}x${Math.max(width, height)}`;
    const variantCheck = await checkVariantExists(convo.poiRootId, sizeQuery);

    if (!variantCheck.exists) {
      console.log(`❌ Variant ${sizeQuery} not found in POI tree (root: ${convo.poiRootName})`);

      // Get available options to suggest
      const availableInTree = await getAvailableOptions(convo.poiRootId);
      const sellableChildren = availableInTree.children.filter(c => c.sellable && c.size);

      if (sellableChildren.length > 0) {
        // Show available sizes in this tree
        const availableSizes = sellableChildren.slice(0, 5).map(p => p.size).join(', ');
        return {
          type: "text",
          text: `No tenemos malla de ${width}x${height}m en esta línea.\n\n` +
                `Las medidas disponibles incluyen: ${availableSizes}.\n\n` +
                `¿Te interesa alguna de estas?`
        };
      }

      // No sellable products in POI tree - fetch broader alternatives and show them directly
      const tempConvo = { ...convo, requestedSize: `${width}x${height}`, productSpecs: { ...convo?.productSpecs, width, height } };
      const altSizes = await getAvailableSizes(tempConvo);

      if (altSizes.length > 0) {
        const reqArea = width * height;
        const sorted = altSizes
          .map(s => ({ ...s, area: s.width * s.height }))
          .sort((a, b) => Math.abs(a.area - reqArea) - Math.abs(b.area - reqArea));

        // If the closest alternative differs by more than 2m², hand off to human
        const closestAreaDiff = Math.abs(sorted[0].area - reqArea);
        if (closestAreaDiff > 2) {
          const { executeHandoff: execHandoffAreaGap } = require('../utils/executeHandoff');
          await updateConversation(psid, {
            requestedSize: `${width}x${height}`,
            productSpecs: { ...convo?.productSpecs, width, height, updatedAt: new Date() }
          });
          return await execHandoffAreaGap(psid, convo, userMessage, {
            reason: `Medida ${width}x${height}m (${reqArea}m²) - sin alternativa cercana (más cercana: ${sorted[0].sizeStr} = ${sorted[0].area}m²)`,
            responsePrefix: `No tenemos malla de ${width}x${height}m y nuestras medidas estándar no se acercan a esa área. Déjame comunicarte con un especialista para buscar opciones. `,
            specsText: `Malla de ${width}x${height}m. `,
            notificationText: `Malla ${width}x${height}m (${reqArea}m²) - alternativa más cercana: ${sorted[0].sizeStr} (${sorted[0].area}m²)`,
            timingStyle: 'elaborate'
          });
        }

        const options = sorted.slice(0, 4);
        const optionsList = options.map(o => `• ${o.sizeStr} → $${o.price}`).join('\n');

        await updateConversation(psid, {
          lastIntent: "alternatives_shown",
          requestedSize: `${width}x${height}`,
          productSpecs: { ...convo?.productSpecs, width, height, updatedAt: new Date() }
        });

        return {
          type: "text",
          text: `No manejamos esa medida de línea, te ofrecemos estas opciones cercanas:\n\n${optionsList}\n\n¿Te interesa alguna o prefieres una fabricación a la medida?`
        };
      }

      // No alternatives at all - hand off to human
      await updateConversation(psid, {
        lastIntent: "awaiting_alternatives_confirmation",
        requestedSize: `${width}x${height}`,
        productSpecs: { ...convo?.productSpecs, width, height, updatedAt: new Date() }
      });

      const { executeHandoff: execHandoff3 } = require('../utils/executeHandoff');
      return await execHandoff3(psid, convo, userMessage, {
        reason: `Sin alternativas para ${width}x${height}m`,
        responsePrefix: `No tenemos malla de ${width}x${height}m en nuestra línea estándar. Déjame comunicarte con un especialista para buscar opciones. `,
        timingStyle: 'elaborate'
      });
    }
  }
  // ====== END POI TREE CHECK ======

  // Check if customer asked for a non-standard percentage
  const requestedInvalidPercentage = percentage && !VALID_PERCENTAGES.includes(Number(percentage));

  // Check if customer asked for an unavailable color
  const AVAILABLE_COLORS = ['beige', 'negro'];
  const requestedUnavailableColor = color && !AVAILABLE_COLORS.some(c =>
    color.toLowerCase().includes(c) || c.includes(color.toLowerCase())
  );

  // Try to find matching products (within POI tree if locked)
  const products = await findMatchingProducts(width, height, percentage, color, convo?.poiRootId);

  if (products.length > 0) {
    // Found exact matches - use the first one
    const product = products[0];

    // CHECK: Are we about to quote the same product we just shared?
    if (convo?.lastSharedProductId && product._id?.toString() === convo.lastSharedProductId) {
      console.log(`🔁 Same product detected (${product._id}), confirming instead of re-quoting`);
      const sizeDisplay = userExpressedSize || `${width}x${height}`;
      await updateConversation(psid, { lastIntent: "size_confirmed", unknownCount: 0 });

      // Wholesale context — don't use retail language
      if (convo?.isWholesaleInquiry) {
        const { executeHandoff } = require('../utils/executeHandoff');
        return await executeHandoff(psid, convo, userMessage, {
          reason: `Mayoreo: cliente confirma ${sizeDisplay}m a $${product.price} — cotizar precio de mayoreo`,
          responsePrefix: `Perfecto, ${sizeDisplay} metros. Para precio de mayoreo un especialista te dará la cotización.`,
          lastIntent: 'wholesale_handoff',
          timingStyle: 'elaborate'
        });
      }

      return {
        type: "text",
        text: `Es correcto, ${sizeDisplay} metros a $${product.price}. La compra se realiza a través de Mercado Libre y el envío está incluido. Puedes comprarla en el enlace que te compartí.`
      };
    }

    // ENRICH PRODUCT WITH TREE CONTEXT
    const enrichedProduct = await enrichProductWithContext(product);
    const displayName = await getProductDisplayName(product, 'short');
    const productInterest = await getProductInterest(product);

    // Update conversation with proper productInterest from tree
    if (productInterest) {
      await updateConversation(psid, { productInterest });
    }

    // Check for wholesale qualification
    if (quantity && product.wholesaleMinQty) {
      if (quantity >= product.wholesaleMinQty) {
        // Wholesale handoff
        const { handleWholesaleRequest } = require("../utils/wholesaleHandler");
        const wholesaleResponse = await handleWholesaleRequest(product, quantity, psid, convo);
        if (wholesaleResponse) {
          return wholesaleResponse;
        }
      }
    }

    // Wholesale context — hand off for wholesale pricing instead of retail quote
    if (convo?.isWholesaleInquiry) {
      const sizeDisplay = userExpressedSize || `${width}x${height}`;
      console.log(`🏪 Wholesale inquiry — handing off ${sizeDisplay}m for wholesale pricing`);
      const { executeHandoff: execHandoffW } = require('../utils/executeHandoff');
      return await execHandoffW(psid, convo, userMessage, {
        reason: `Mayoreo: cliente pregunta por ${sizeDisplay}m — cotizar precio de mayoreo`,
        responsePrefix: `¡Tenemos la medida ${sizeDisplay}m! Para precio de mayoreo un especialista te dará la cotización.`,
        lastIntent: 'wholesale_handoff',
        timingStyle: 'elaborate'
      });
    }

    // Get the preferred link from onlineStoreLinks
    const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
    const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

    if (!productUrl) {
      // No link available - hand off to human with video
      console.log(`⚠️ Product ${product.name} has no online store link`);

      const { executeHandoff: execHandoff6 } = require('../utils/executeHandoff');
      return await execHandoff6(psid, convo, userMessage, {
        reason: `Malla ${width}x${height}m - no link available`,
        responsePrefix: `¡Tenemos la ${displayName}! `,
        specsText: `Malla de ${width}x${height}m. `,
        notificationText: `Malla ${width}x${height}m - producto sin link`,
        timingStyle: 'elaborate',
        includeVideo: true
      });
    }

    const trackedLink = await generateClickLink(psid, productUrl, {
      productName: product.name,
      productId: product._id,
      city: convo?.city,
      stateMx: convo?.stateMx
    });

    // Build sales-style response - use user's expressed dimension order for display
    const salesPitch = await formatProductResponse(product, {
      price: product.price,
      userExpressedSize: userExpressedSize ? `${userExpressedSize} m` : null,
      concerns: concerns
    });

    // Add wholesale mention if product is eligible
    let wholesaleMention = "";
    if (product.wholesaleMinQty && !quantity) {
      wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
    }

    // Build quantity prefix if needed
    const quantityText = quantity ? `Para ${quantity} piezas:\n\n` : "";

    // Save product reference for duplicate detection and stats
    const w = Math.min(width, height);
    const h = Math.max(width, height);
    await updateConversation(psid, {
      lastSharedProductId: product._id?.toString(),
      lastSharedProductLink: productUrl,
      lastQuotedProducts: [{
        width: w, height: h,
        displayText: `${w}x${h}m`,
        price: product.price,
        productId: product._id?.toString(),
        productUrl,
        productName: product.name
      }],
      unknownCount: 0
    });

    // If customer asked for non-standard percentage or unavailable color, note the correction
    let correctionNote = '';
    if (requestedInvalidPercentage && requestedUnavailableColor) {
      correctionNote = `No manejamos ${percentage}% ni color ${color}. Solo la tenemos en ${AVAILABLE_COLORS.join(' y ')}:\n\n`;
    } else if (requestedInvalidPercentage) {
      correctionNote = `No manejamos ${percentage}%, pero tenemos esta opción:\n\n`;
    } else if (requestedUnavailableColor) {
      correctionNote = `No la manejamos en color ${color}, solo en ${AVAILABLE_COLORS.join(' y ')}:\n\n`;
    }

    return {
      type: "text",
      text: `${correctionNote}${quantityText}${salesPitch}\n` +
            `🛒 Cómprala aquí:\n${trackedLink}${wholesaleMention}`
    };
  }

  // No exact match - suggest alternatives before handing off
  const requestedArea = width * height;
  const minW = Math.min(width, height);
  const maxH = Math.max(width, height);

  // Get all available sellable products to find alternatives
  let alternatives = [];
  try {
    // Get root ID for malla sombra confeccionada
    let rootId = convo?.poiRootId;

    // If no POI locked, find Malla Sombra Raschel root (we're in malla flow)
    if (!rootId) {
      const mallaRoot = await ProductFamily.findOne({
        name: /Malla Sombra Raschel/i,
        parentId: null,
        active: { $ne: false }
      }).lean();
      if (mallaRoot) {
        rootId = mallaRoot._id;
      }
    }

    if (rootId) {
      const descendants = await getAllDescendants(rootId);
      alternatives = descendants.filter(p => p.sellable && p.size && p.price);
    } else {
      // Last resort fallback (shouldn't happen in malla flow)
      alternatives = await ProductFamily.find({
        sellable: true,
        size: { $exists: true, $ne: null },
        price: { $gt: 0 },
        active: { $ne: false },
        name: /malla.*sombra|raschel/i
      }).lean();
    }
  } catch (err) {
    console.error("Error getting alternatives:", err);
  }

  // Parse sizes and find nearest (exclude rolls - any dimension >= 50m)
  const parsedAlternatives = alternatives.map(p => {
    const match = p.size?.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const d1 = parseFloat(match[1]);
    const d2 = parseFloat(match[2]);
    // Filter out rolls (dimension >= 50m indicates a roll, not confeccionada)
    if (d1 >= 50 || d2 >= 50) return null;
    return {
      product: p,
      w: Math.min(d1, d2),
      h: Math.max(d1, d2),
      area: d1 * d2
    };
  }).filter(Boolean);

  // Find largest available size
  const sortedByArea = parsedAlternatives.sort((a, b) => b.area - a.area);
  const largest = sortedByArea[0];

  // Find nearest size that could cover (single piece)
  const couldCover = parsedAlternatives.filter(p => p.w >= minW && p.h >= maxH);
  const nearestCover = couldCover.sort((a, b) => a.area - b.area)[0]; // Smallest that covers

  // Build response with alternatives
  let response = `La medida ${width}x${height}m no la manejamos en nuestro catálogo estándar.\n\n`;
  let recommendedSize = null;

  // Check if the closest alternative (by area) is within 2m² of the requested area
  // If not, no standard size is close enough — hand off to human
  const closestByArea = parsedAlternatives
    .sort((a, b) => Math.abs(a.area - requestedArea) - Math.abs(b.area - requestedArea))[0];
  if (closestByArea && Math.abs(closestByArea.area - requestedArea) > 2) {
    const { executeHandoff: execHandoffAreaGap2 } = require('../utils/executeHandoff');
    await updateConversation(psid, {
      lastUnavailableSize: `${width}x${height}`,
      requestedSize: `${width}x${height}`,
      productSpecs: { ...convo?.productSpecs, width, height, updatedAt: new Date() }
    });
    return await execHandoffAreaGap2(psid, convo, userMessage, {
      reason: `Medida ${width}x${height}m (${requestedArea}m²) - sin alternativa cercana (más cercana: ${closestByArea.product.size} = ${closestByArea.area}m²)`,
      responsePrefix: `No tenemos malla de ${width}x${height}m y nuestras medidas estándar no se acercan a esa área. Déjame comunicarte con un especialista para buscar opciones. `,
      specsText: `Malla de ${width}x${height}m. `,
      notificationText: `Malla ${width}x${height}m (${requestedArea}m²) - alternativa más cercana: ${closestByArea.product.size} (${closestByArea.area}m²)`,
      timingStyle: 'elaborate'
    });
  }

  if (nearestCover) {
    // There's a single piece that could cover
    recommendedSize = nearestCover.product.size;
    response += `La más cercana que cubre esa área es de ${recommendedSize} por ${formatMoney(nearestCover.product.price)}.\n\n`;
    response += `¿Te interesa esa medida, o prefieres que te pase con un especialista para cotización a medida?`;
  } else if (largest) {
    // Check if the requested area is MUCH larger than the largest available
    // If so, suggest multiple pieces or hand off for custom order
    const requestedAreaSqM = width * height;
    const largestAreaSqM = largest.area;
    const piecesNeeded = Math.ceil(requestedAreaSqM / largestAreaSqM);

    if (piecesNeeded >= 3) {
      // Very large area - hand off for custom order
      const { executeHandoff: execHandoff7 } = require('../utils/executeHandoff');
      return await execHandoff7(psid, convo, userMessage, {
        reason: `Área grande: ${width}x${height}m (${requestedAreaSqM}m²) - requiere cotización especial`,
        responsePrefix: `Para cubrir ${width}x${height}m (${requestedAreaSqM}m²) necesitarías múltiples piezas o un pedido especial.\n\n`,
        specsText: `Malla de ${width}x${height}m. `,
        notificationText: `Malla ${width}x${height}m (${requestedAreaSqM}m²) - área muy grande`,
        timingStyle: 'elaborate',
        includeVideo: true
      });
    } else if (piecesNeeded === 2) {
      // Could cover with 2 pieces - suggest this option
      const totalPrice = largest.product.price * 2;
      recommendedSize = largest.product.size;
      response += `Para cubrir ${width}x${height}m necesitarías **2 piezas** de ${largest.product.size} (nuestra medida más grande).\n\n`;
      response += `• 2 x ${largest.product.size} = $${formatMoney(totalPrice).replace('$', '')} aprox.\n\n`;
      response += `¿Te interesa esta opción, o prefieres que te cotice una malla a medida exacta?`;
    } else {
      // Single piece might work, show largest available
      recommendedSize = largest.product.size;
      response += `Nuestra medida más grande en confeccionada es de ${largest.product.size} por ${formatMoney(largest.product.price)}.\n\n`;
      response += `¿Te interesa esta medida, o prefieres cotización a medida exacta?`;
    }
  }

  // Save the custom request and recommended size for follow-up
  await updateConversation(psid, {
    lastUnavailableSize: `${width}x${height}`,
    lastIntent: "malla_awaiting_confirmation",
    recommendedSize: recommendedSize
  });

  if (!nearestCover && !largest) {
    // No alternatives found - hand off with video
    const { executeHandoff: execHandoff8 } = require('../utils/executeHandoff');
    return await execHandoff8(psid, convo, userMessage, {
      reason: `Malla quote request: ${width}x${height}m - no alternatives found`,
      responsePrefix: `La medida ${width}x${height}m requiere cotización especial.\n\n`,
      specsText: `Malla de ${width}x${height}m. `,
      notificationText: `Malla ${width}x${height}m - sin alternativas disponibles`,
      timingStyle: 'elaborate',
      includeVideo: true
    });
  }

  return {
    type: "text",
    text: response
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo, userMessage = '') {
  const { product } = classification;
  const msg = (userMessage || '').toLowerCase();

  // Non-90% shade with malla/sombra keywords: accept it here so we can hand off properly
  // (If rollo flow already matched via "rollo" keyword, it runs first and handles it)
  // Without this, non-90% shade requests like "malla sombra de 70% 6x20" fall through unhandled

  // Explicitly about malla sombra (not rolls)
  if (product === "malla_sombra") return true;

  // Already in malla flow
  if (convo?.productSpecs?.productType === "malla") return true;
  if (convo?.lastIntent?.startsWith("malla_")) return true;

  // POI is locked to Malla Sombra tree
  const poiRootName = (convo?.poiRootName || '').toLowerCase();
  if (poiRootName.includes('malla') && poiRootName.includes('sombra')) {
    console.log(`🌐 Malla flow - POI locked to ${convo.poiRootName}, handling`);
    return true;
  }

  // Check productInterest - handle variations like malla_sombra_raschel, malla_sombra_raschel_agricola, etc.
  const productInterest = String(convo?.productInterest || '');
  const isMallaInterest = productInterest.startsWith('malla_sombra') || productInterest === 'confeccionada';
  if (isMallaInterest && convo?.productSpecs?.productType !== "rollo") return true;

  // Source indicates malla (also check for variations)
  const adProduct = String(sourceContext?.ad?.product || '');
  if (adProduct.startsWith('malla_sombra') || adProduct === 'confeccionada') return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  parseDimensions,
  getFlowState,
  determineStage,
  getMallaDescription
};
