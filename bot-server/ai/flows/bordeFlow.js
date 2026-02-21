// ai/flows/bordeFlow.js
// State machine for borde separador (garden edging) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");

// AI fallback for flow dead-ends
const { resolveWithAI } = require("../utils/flowFallback");

// Import existing utilities - USE THESE
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductDisplayName,
  getProductInterest,
  getProductLineage
} = require("../utils/productEnricher");

/**
 * Flow stages for borde
 */
const STAGES = {
  START: "start",
  AWAITING_LENGTH: "awaiting_length",
  AWAITING_QUANTITY: "awaiting_quantity",
  COMPLETE: "complete"
};

/**
 * Borde width — only one width exists. Fetched from DB on first use, fallback 13cm.
 */
let bordeWidthCm = null;
let bordeWidthCacheExpiry = 0;

async function getBordeWidth() {
  if (bordeWidthCm && Date.now() < bordeWidthCacheExpiry) return bordeWidthCm;

  try {
    // Check parent "Borde Separador" description for width
    const parent = await ProductFamily.findOne({
      name: /borde\s*separador/i,
      sellable: { $ne: true }
    }).select('description').lean();

    const widthMatch = parent?.description?.match(/(\d+)\s*cm/i);
    if (widthMatch) {
      bordeWidthCm = parseInt(widthMatch[1]);
    } else {
      // Try from child product sizes (e.g. "13x18m" → 13)
      const child = await ProductFamily.findOne({
        name: /borde|separador/i,
        sellable: true,
        active: true,
        size: /^\d+x\d+/i
      }).select('size').lean();
      const sizeMatch = child?.size?.match(/^(\d+)x/i);
      bordeWidthCm = sizeMatch ? parseInt(sizeMatch[1]) : 13;
    }

    bordeWidthCacheExpiry = Date.now() + 5 * 60 * 1000;
    return bordeWidthCm;
  } catch (err) {
    console.error("Error fetching borde width:", err.message);
    return 13; // fallback
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
 * Check if a product has an ML link (meaning shipping is included in the price)
 */
function hasMLLink(product) {
  return product?.onlineStoreLinks?.some(l => l.url?.includes('mercadolibre'));
}

/**
 * Format price (borde shipping is NOT included in price)
 */
function formatPriceWithShipping(product) {
  if (!product?.price) return '';
  return formatMoney(product.price);
}

/**
 * Extract meter lengths from product names/sizes
 * "Rollo de 18 m" → 18, "54 metros" → 54
 */
function extractLengthsFromProducts(products) {
  const lengths = new Set();
  for (const p of products) {
    const text = `${p.name || ''} ${p.size || ''}`;
    const match = text.match(/(\d+)\s*m/i);
    if (match) {
      lengths.add(parseInt(match[1]));
    }
  }
  return [...lengths].sort((a, b) => a - b);
}

/**
 * Find all sellable borde products from the Borde Separador family tree
 * Gen 1: Cinta Plástica → Gen 2: Borde Separador → Gen 3: Rollo de Xm (sellable)
 * Falls back to name-based search if tree lookup fails.
 */
async function findAllBordeProducts(adProductIds = null) {
  try {
    // Strategy 1: Tree-based lookup
    const bordeParent = await ProductFamily.findOne({
      name: /borde\s*separador/i,
      sellable: { $ne: true }
    }).lean();

    if (bordeParent) {
      const products = await ProductFamily.find({
        parentId: bordeParent._id,
        sellable: true,
        active: true
      }).sort({ price: 1 }).lean();

      if (products.length > 0) {
        console.log(`🌱 Found ${products.length} borde products under "${bordeParent.name}"`);
        return products;
      }
    }

    // Strategy 2: Name-based search (tree might be deeper or structured differently)
    const byName = await ProductFamily.find({
      name: /borde.*separador|rollo.*de.*\d+\s*m/i,
      sellable: true,
      active: true
    }).sort({ price: 1 }).lean();

    // Filter to only products that look like borde (have meter-based sizes, not NxN)
    const bordeByName = byName.filter(p => {
      const size = (p.size || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const isBorde = /borde|separador|cinta/.test(name);
      const hasMeterSize = /^\d+\s*m/i.test(size) || /\d+\s*m(ts?|etros?)?\s*$/i.test(size);
      return isBorde || hasMeterSize;
    });

    if (bordeByName.length > 0) {
      console.log(`🌱 Found ${bordeByName.length} borde products by name search`);
      return bordeByName;
    }

    // Strategy 3: Ad product IDs as last resort
    if (adProductIds?.length) {
      const adProducts = await ProductFamily.find({
        _id: { $in: adProductIds },
        sellable: true,
        active: true
      }).sort({ price: 1 }).lean();

      if (adProducts.length > 0) {
        console.log(`🌱 Found ${adProducts.length} borde products from ad IDs`);
        return adProducts;
      }
    }

    console.log('🌱 Borde Separador products not found in DB');
    return [];
  } catch (error) {
    console.error("❌ Error finding borde products:", error);
    return [];
  }
}

/**
 * Get available lengths, filtered by ad products if specified
 * Falls back to querying all sellable borde products from the database
 */
async function getAvailableLengths(sourceContext, convo) {
  // Check ad productIds from sourceContext (first message) or conversation (persisted)
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;

  if (adProductIds?.length) {
    try {
      const products = await ProductFamily.find({
        _id: { $in: adProductIds },
        sellable: true,
        active: true
      }).lean();

      const lengths = extractLengthsFromProducts(products);
      if (lengths.length > 0) {
        console.log(`🌱 Borde lengths from ad products: ${lengths.join(', ')}m`);
        return lengths;
      }
    } catch (err) {
      console.error("Error getting ad product lengths:", err.message);
    }
  }

  // Fallback: query ALL sellable borde products from database
  const allProducts = await findAllBordeProducts();
  const lengths = extractLengthsFromProducts(allProducts);

  if (lengths.length > 0) {
    console.log(`🌱 Borde lengths from database: ${lengths.join(', ')}m`);
  } else {
    console.log('🌱 No borde products found in database');
  }

  return lengths;
}

/**
 * Find matching sellable borde products
 * Optionally filter by length. Accepts ad product IDs for fallback.
 */
async function findMatchingProducts(length = null, adProductIds = null) {
  try {
    const products = await findAllBordeProducts(adProductIds);

    if (!length) return products;

    // Filter by length from product name/size — try multiple patterns
    const filtered = products.filter(p => {
      const text = `${p.name || ''} ${p.size || ''}`;
      // Match "54m", "54 m", "54 metros", "54 mts"
      if (new RegExp(`\\b${length}\\s*m`, 'i').test(text)) return true;
      // Match bare number in size field (size might just be "54")
      if (new RegExp(`^\\s*${length}\\s*$`).test(p.size || '')) return true;
      return false;
    });

    if (filtered.length > 0) {
      console.log(`🌱 Filtered by ${length}m: ${filtered.length} matches`);
      return filtered;
    }

    // Fallback: if filter returned nothing but we have products, try looser match
    const loose = products.filter(p => {
      const text = `${p.name || ''} ${p.size || ''}`;
      return new RegExp(`\\b${length}\\b`).test(text);
    });

    if (loose.length > 0) {
      console.log(`🌱 Loose filter by ${length}: ${loose.length} matches`);
      return loose;
    }

    console.log(`🌱 No borde products matching ${length}m found`);
    return [];
  } catch (error) {
    console.error("❌ Error finding borde products:", error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  return {
    stage: specs.productType === 'borde_separador' ? STAGES.AWAITING_LENGTH : STAGES.START,
    length: specs.borde_length || null,
    quantity: specs.quantity || null,
    flowCompleted: specs.flowCompleted || false
  };
}

/**
 * Determine what stage we should be in
 */
function determineStage(state) {
  if (!state.length) return STAGES.AWAITING_LENGTH;
  if (!state.quantity) return STAGES.AWAITING_QUANTITY;
  return STAGES.COMPLETE;
}

/**
 * Parse borde length from user message
 */
function parseLengthFromMessage(msg, availableLengths) {
  if (!msg) return null;

  // First try with explicit meter suffix: "54 Mts", "18m", "54 metros"
  const meterMatch = msg.match(/\b(\d+)\s*(?:m(?:ts?|etros?)?)\b/i);
  if (meterMatch) {
    const num = parseInt(meterMatch[1]);
    if (availableLengths.includes(num)) return num;
  }

  // Then try bare numbers that match valid lengths
  const numbers = msg.match(/\b(\d+)\b/g);
  if (numbers) {
    for (const numStr of numbers) {
      const num = parseInt(numStr);
      if (availableLengths.includes(num)) return num;
    }
  }

  return null;
}

/**
 * Parse quantity from user message
 */
function parseQuantityFromMessage(msg) {
  if (!msg) return null;
  const m = msg.toLowerCase();

  // "un par" = 2
  if (/\b(un\s*par|par\s+de)\b/i.test(m)) return 2;
  // "uno", "una", "1"
  if (/\b(un[oa]?|1)\s*(rollo|pza|pieza)?\b/i.test(m)) return 1;
  // "dos", "2"
  if (/\b(dos|2)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 2;
  // "tres", "3"
  if (/\b(tres|3)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 3;
  // "cuatro" through common numbers
  if (/\b(cuatro|4)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 4;
  if (/\b(cinco|5)\s*(rollos?|pzas?|piezas?)?\b/i.test(m)) return 5;

  // Generic number + rollos/piezas
  const qtyMatch = m.match(/\b(\d+)\s+(rollos?|pzas?|piezas?)\b/i);
  if (qtyMatch) {
    const qty = parseInt(qtyMatch[1]);
    if (qty > 0 && qty <= 500) return qty;
  }

  // Bare number (only when we're specifically asking for quantity - will be used contextually)
  const bareMatch = m.match(/^\s*(\d+)\s*$/);
  if (bareMatch) {
    const qty = parseInt(bareMatch[1]);
    if (qty > 0 && qty <= 500) return qty;
  }

  return null;
}

/**
 * Handle borde flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // ====== PENDING ZIP CODE RESPONSE ======
  if (convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('../utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) return pendingResult;
  }

  let state = getFlowState(convo);

  console.log(`🌱 Borde flow - Current state:`, state);
  console.log(`🌱 Borde flow - Intent: ${intent}, Entities:`, entities);

  // If flow already completed, handle gracefully
  if (state.flowCompleted) {
    const isDenial = /\b(no|nada|eso\s*es\s*todo|es\s*todo|nah?|nel|gracias|no\s*gracias)\b/i.test(userMessage);
    if (isDenial) {
      return {
        type: "text",
        text: "¡Perfecto! Cualquier cosa aquí andamos. ¡Que tengas excelente día!"
      };
    }
    // For other messages after completion, reset flow so they can start over
    state = { length: null, quantity: null, flowCompleted: false };
  }

  // Ad product IDs — used as fallback for product lookups
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds || null;

  // Get available lengths (filtered by ad if applicable)
  const availableLengths = await getAvailableLengths(sourceContext, convo);

  // WIDTH QUESTIONS — borde only comes in one width
  if (userMessage && /\b(ancho|anchura|grosor|grueso|cm|cent[ií]metros?|qu[eé]\s*(?:tan\s*)?(?:ancho|grueso))\b/i.test(userMessage)) {
    const widthCm = await getBordeWidth();
    const lengthList = availableLengths.map(l => `${l}m`).join(', ');

    // If they're asking for a specific width we don't have
    const requestedWidth = userMessage.match(/(\d+)\s*(?:cm|cent[ií]metros?)/i);
    if (requestedWidth && parseInt(requestedWidth[1]) !== widthCm) {
      return {
        type: "text",
        text: `Solo lo manejamos de ${widthCm}cm de ancho, que es la medida estándar.\n\nLo tenemos en rollos de ${lengthList}. ¿Cuál te interesa?`
      };
    }

    return {
      type: "text",
      text: `Mide ${widthCm}cm de ancho. Lo tenemos en rollos de ${lengthList}. ¿Qué largo necesitas?`
    };
  }

  // FIRST: Check classifier entities
  if (!state.length && entities.borde_length && availableLengths.includes(entities.borde_length)) {
    state.length = entities.borde_length;
    console.log(`📏 Borde flow - Using classifier entity: ${entities.borde_length}m`);
  }

  // SECOND: Regex fallback on raw message
  if (!state.length && userMessage) {
    const parsed = parseLengthFromMessage(userMessage, availableLengths);
    if (parsed) {
      console.log(`🌱 Borde flow - Regex fallback: ${parsed}m`);
      state.length = parsed;
    }
  }

  // Parse quantity from user message (only when we already have length)
  if (state.length && !state.quantity && userMessage) {
    // Don't parse quantity from the same message that provided length
    // unless it explicitly mentions quantity words
    const hasQtyWords = /\b(rollos?|pzas?|piezas?|necesito|quiero|ocupo|un\s*par)\b/i.test(userMessage);
    const isLengthOnlyMessage = parseLengthFromMessage(userMessage, availableLengths) !== null;

    if (hasQtyWords || !isLengthOnlyMessage) {
      const qty = parseQuantityFromMessage(userMessage);
      if (qty) {
        console.log(`🌱 Borde flow - Parsed quantity from message: ${qty}`);
        state.quantity = qty;
      }
    }
  }

  // Also check classifier entities for quantity
  if (!state.quantity && entities.quantity) {
    state.quantity = entities.quantity;
  }

  const stage = determineStage(state);
  let response;

  switch (stage) {
    case STAGES.AWAITING_LENGTH:
      response = await handleAwaitingLength(intent, state, sourceContext, availableLengths, userMessage, adProductIds, psid, convo);
      break;

    case STAGES.AWAITING_QUANTITY:
      response = await handleAwaitingQuantity(intent, state, sourceContext, adProductIds);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo, userMessage, adProductIds);
      break;

    default:
      response = await handleStart(sourceContext, availableLengths, adProductIds);
  }

  // Save updated specs
  await updateConversation(psid, {
    lastIntent: `borde_${stage}`,
    productInterest: "borde_separador",
    productSpecs: {
      productType: "borde_separador",
      borde_length: state.length,
      quantity: state.quantity,
      flowCompleted: stage === STAGES.COMPLETE,
      updatedAt: new Date()
    }
  });

  return response;
}

/**
 * Handle start - user just mentioned borde
 */
async function handleStart(sourceContext, availableLengths, adProductIds = null) {
  const widthCm = await getBordeWidth();

  // Try to show prices alongside lengths
  const products = await findMatchingProducts(null, adProductIds);
  const lengthsWithPrices = availableLengths.map(l => {
    const product = products.find(p => {
      const text = `${p.name || ''} ${p.size || ''}`;
      return new RegExp(`\\b${l}\\b`).test(text);
    });
    return product?.price
      ? `• ${l}m — ${formatMoney(product.price)}`
      : `• ${l}m`;
  });

  const hasPrices = products.some(p => p.price);
  if (hasPrices) {
    return {
      type: "text",
      text: `¡Hola! Sí manejamos borde separador para jardín.\n\n` +
            `Sirve para delimitar áreas de pasto, crear caminos y separar zonas. Mide ${widthCm}cm de ancho.\n\n` +
            `${lengthsWithPrices.join('\n')}\n\n` +
            `¿Qué largo te interesa?`
    };
  }

  const lengthList = availableLengths.map(l => `${l}m`).join(', ');
  return {
    type: "text",
    text: `¡Hola! Sí manejamos borde separador para jardín.\n\n` +
          `Sirve para delimitar áreas de pasto, crear caminos y separar zonas. Mide ${widthCm}cm de ancho.\n\n` +
          `Tenemos rollos de ${lengthList}.\n\n` +
          `¿Qué largo te interesa?`
  };
}

/**
 * Handle awaiting length stage
 */
async function handleAwaitingLength(intent, state, sourceContext, availableLengths, userMessage = '', adProductIds = null, psid = null, convo = null) {
  // Check if user provided area/patio dimensions (NxN) instead of a linear length
  const dimMatch = (userMessage || '').match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if (dimMatch) {
    const w = parseFloat(dimMatch[1]);
    const h = parseFloat(dimMatch[2]);
    const perimeter = Math.ceil(2 * (w + h));

    // Find the smallest available length that covers the perimeter + show price
    const sorted = [...availableLengths].sort((a, b) => a - b);
    const recommended = sorted.find(l => l >= perimeter) || sorted[sorted.length - 1];
    const products = await findMatchingProducts(recommended, adProductIds);
    const product = products[0];
    const priceText = product?.price ? ` por ${formatMoney(product.price)}` : '';

    return {
      type: "text",
      text: `Para un espacio de ${w}x${h}m necesitarías aproximadamente ${perimeter} metros lineales de borde.\n\n` +
            `Te recomiendo el rollo de ${recommended}m${priceText}. ¿Te interesa?`
    };
  }

  // Build length list with prices if available
  const products = await findMatchingProducts(null, adProductIds);
  const lengthsWithPrices = availableLengths.map(l => {
    const product = products.find(p => {
      const text = `${p.name || ''} ${p.size || ''}`;
      return new RegExp(`\\b${l}\\b`).test(text);
    });
    return product?.price
      ? `• ${l}m — ${formatMoney(product.price)}`
      : `• ${l}m`;
  });

  if (intent === INTENTS.PRICE_QUERY || products.some(p => p.price)) {
    return {
      type: "text",
      text: `¡Claro! Manejamos borde separador en las siguientes presentaciones:\n\n` +
            `${lengthsWithPrices.join('\n')}\n\n` +
            `¿Qué largo necesitas?`
    };
  }

  // ====== AI FALLBACK before static response ======
  if (userMessage && psid && convo?.lastQuotedProducts?.length > 0) {
    const aiResult = await resolveWithAI({
      psid,
      userMessage,
      flowType: 'borde',
      stage: 'awaiting_length',
      basket: convo?.productSpecs,
      lastQuotedProducts: convo.lastQuotedProducts
    });

    if (aiResult.confidence >= 0.7) {
      if (aiResult.action === 'select_one' && convo.lastQuotedProducts[aiResult.selectedIndex]) {
        const prod = convo.lastQuotedProducts[aiResult.selectedIndex];
        if (prod.productUrl) {
          const trackedLink = await generateClickLink(psid, prod.productUrl, {
            productName: prod.productName || prod.displayText,
            productId: prod.productId
          });
          await updateConversation(psid, { lastIntent: 'borde_complete', unknownCount: 0, lastQuotedProducts: null });
          return {
            type: "text",
            text: `¡Perfecto! Aquí tienes el link de compra:\n\n• ${prod.displayText} — ${formatMoney(prod.price)}\n  🛒 ${trackedLink}\n\nEl envío va incluido.`
          };
        }
      }

      if (aiResult.action === 'answer_question' && aiResult.text) {
        await updateConversation(psid, { lastIntent: 'borde_ai_answered', unknownCount: 0 });
        return { type: "text", text: aiResult.text };
      }
    }
  }

  const lengthList = availableLengths.map(l => `${l}m`).join(', ');
  return {
    type: "text",
    text: `Tenemos rollos de ${lengthList}.\n\n` +
          `¿Qué largo te interesa?`
  };
}

/**
 * Handle awaiting quantity stage - show price and ask how many
 */
async function handleAwaitingQuantity(intent, state, sourceContext, adProductIds = null) {
  // Look up product to show price
  const products = await findMatchingProducts(state.length, adProductIds);
  const product = products[0];

  if (product) {
    const displayName = await getProductDisplayName(product, 'short');
    const priceText = product.price ? ` en ${formatMoney(product.price)}` : '';
    return {
      type: "text",
      text: `Tenemos ${displayName}${priceText}. ¿Cuántos rollos necesitas?`
    };
  }

  return {
    type: "text",
    text: `Borde de ${state.length} metros. ¿Cuántos rollos necesitas?`
  };
}

/**
 * Handle complete - we have length and quantity
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '', adProductIds = null) {
  const { length, quantity } = state;

  // Try to find matching product in inventory
  const products = await findMatchingProducts(length, adProductIds);

  if (products.length > 0) {
    const product = products[0];

    // ENRICH WITH TREE CONTEXT
    const displayName = await getProductDisplayName(product, 'short');
    const productInterest = await getProductInterest(product);

    if (productInterest) {
      await updateConversation(psid, { productInterest });
    }

    // Check for wholesale
    if (quantity && product.wholesaleEnabled && product.wholesaleMinQty) {
      if (quantity >= product.wholesaleMinQty) {
        const { handleWholesaleRequest } = require("../utils/wholesaleHandler");
        const wholesaleResponse = await handleWholesaleRequest(product, quantity, psid, convo);
        if (wholesaleResponse) return wholesaleResponse;
      }
    }

    // Get preferred link
    const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
    const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

    if (productUrl) {
      const trackedLink = await generateClickLink(psid, productUrl, {
        productName: product.name,
        productId: product._id,
        city: convo?.city,
        stateMx: convo?.stateMx
      });

      // Clarify "c/u" when asking for multiple items
      const priceText = product.price
        ? ` por ${formatMoney(product.price)}${quantity > 1 ? ' c/u' : ''}`
        : "";
      const quantityText = `Para ${quantity} rollo${quantity > 1 ? 's' : ''}, `;

      let wholesaleMention = "";
      if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo.`;
      }

      // Save quoted product for AI fallback on next message
      await updateConversation(psid, {
        lastQuotedProducts: [{
          displayText: `Borde ${length}m`,
          price: product.price,
          productId: product._id?.toString(),
          productUrl,
          productName: product.name
        }]
      });

      return {
        type: "text",
        text: `¡Claro! ${quantityText}tenemos el ${displayName}${priceText}. El envío está incluido.\n\n` +
              `🛒 Cómpralo aquí:\n${trackedLink}${wholesaleMention}\n\n` +
              `¿Necesitas algo más?`
      };
    }

    // Product found but no ML link — show price + ask zip
    if (product.price) {
      const specsDesc = displayName || `borde separador de ${length}m`;
      const qtyText = quantity > 1 ? ` c/u` : '';
      let priceMsg = `Tenemos ${specsDesc} en ${formatMoney(product.price)}${qtyText} + envío`;

      if (product.wholesaleEnabled && product.wholesaleMinQty && product.wholesalePrice) {
        priceMsg += `\n\nPor mayoreo (mínimo ${product.wholesaleMinQty} rollos) a ${formatMoney(product.wholesalePrice)} por rollo + envío`;
      } else if (product.wholesaleEnabled && product.wholesaleMinQty && quantity < product.wholesaleMinQty) {
        priceMsg += `\n\nA partir de ${product.wholesaleMinQty} rollos manejamos precio de mayoreo`;
      }

      priceMsg += `\n\n¿Me puedes proporcionar tu código postal para calcular el envío?`;

      const specsText = `${quantity} rollo${quantity > 1 ? 's' : ''} de borde de ${length}m`;
      await updateConversation(psid, {
        pendingHandoff: true,
        pendingHandoffInfo: {
          reason: `Borde: ${specsText}`,
          specsText: ''
        }
      });

      return { type: "text", text: priceMsg };
    }
  }

  // No product found or no price — hand off with full specs
  const specsText = `${quantity} rollo${quantity > 1 ? 's' : ''} de borde de ${length}m`;

  const { executeHandoff } = require('../utils/executeHandoff');
  return await executeHandoff(psid, convo, userMessage, {
    reason: `Borde: ${specsText}`,
    responsePrefix: `${specsText}.\n\n`,
    specsText: `${specsText}. `,
    timingStyle: 'elaborate'
  });
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  if (product === "borde_separador") return true;
  if (convo?.productSpecs?.productType === "borde_separador") return true;
  if (convo?.lastIntent?.startsWith("borde_")) return true;
  if (convo?.productInterest === "borde_separador") return true;
  if (sourceContext?.ad?.product === "borde_separador") return true;

  return false;
}

module.exports = {
  handle,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage,
  getBordeWidth,
  getAvailableLengths
};
