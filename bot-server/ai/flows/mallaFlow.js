// ai/flows/mallaFlow.js
// State machine for malla confeccionada (pre-made shade mesh) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const { INTENTS } = require("../classifier");

// Import existing utilities - USE THESE, don't reinvent
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductLineage,
  formatProductForBot,
  getProductDisplayName,
  getProductInterest
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

/**
 * Parse dimension string - handles many formats:
 * "4x3", "4 x 3", "4X3", "4×3"
 * "4mx3m", "4m x 3m", "4 m x 3 m"
 * "4mtsx3mts", "4 mts x 3 mts"
 * "4 metros x 3 metros", "4metros x 3"
 * "4 por 3", "4 metros por 3"
 * "de 4 por 3", "una de 4x3"
 *
 * Dimensions are interchangeable: 5x3 = 3x5
 */
function parseDimensions(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Convert "y medio" to .5 (e.g., "2 y medio" -> "2.5")
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Universal pattern that handles all formats:
  // Optional unit after first number, separator (x/×/por), optional unit after second number
  // Units: m, mts, metros, mt
  const pattern = /(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?\s*(?:x|×|por)\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?/i;

  const m = s.match(pattern);

  if (!m) return null;

  const dim1 = parseFloat(m[1]);
  const dim2 = parseFloat(m[2]);

  if (Number.isNaN(dim1) || Number.isNaN(dim2)) return null;
  if (dim1 <= 0 || dim2 <= 0) return null;

  // Normalize: smaller dimension first for consistent DB matching
  const width = Math.min(dim1, dim2);
  const height = Math.max(dim1, dim2);

  return {
    width,
    height,
    original: { dim1, dim2 }, // Keep original order if needed
    area: dim1 * dim2,
    normalized: `${width}x${height}`
  };
}

/**
 * Parse single dimension from message (e.g., "2 y medio", "3 metros", "de 2.5")
 */
function parseSingleDimension(str) {
  if (!str) return null;

  let s = String(str).toLowerCase();

  // Convert "y medio" to .5
  s = s.replace(/(\d+)\s*y\s*medio/gi, (_, num) => `${num}.5`);

  // Match single number with optional units
  // "2 y medio", "3 metros", "de 2.5", "como 4", "ha de 2.5"
  const pattern = /(?:de|como|ha\s*de|unos?)?\s*(\d+(?:\.\d+)?)\s*(?:m(?:ts|etros?|t)?\.?)?(?:\s|$)/i;

  const m = s.match(pattern);
  if (!m) return null;

  const dim = parseFloat(m[1]);
  if (Number.isNaN(dim) || dim <= 0 || dim > 20) return null; // Sanity check: 0-20 meters

  return dim;
}

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

    // Add percentage filter if specified (check in name or attributes)
    if (percentage) {
      query.name = new RegExp(`${percentage}\\s*%`, 'i');
    }

    let products = await ProductFamily.find(query)
      .sort({ price: 1 }) // Cheapest first
      .lean();

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
 * Handle multiple dimensions request (e.g., "6x5 o 5x5")
 */
async function handleMultipleDimensions(dimensions, psid, convo) {
  const poiRootId = convo?.poiRootId;
  const responseParts = [];

  for (const dim of dimensions) {
    const w = Math.min(dim.width, dim.height);
    const h = Math.max(dim.width, dim.height);

    // Find product for this size
    const products = await findMatchingProducts(w, h, null, null, poiRootId);

    if (products.length > 0) {
      const product = products[0];
      responseParts.push(`• ${dim.width}x${dim.height}m: ${formatMoney(product.price)}`);
    } else {
      responseParts.push(`• ${dim.width}x${dim.height}m: No disponible en esta medida`);
    }
  }

  await updateConversation(psid, {
    lastIntent: 'malla_multiple_sizes',
    productInterest: 'malla_sombra',
    productSpecs: {
      productType: 'malla',
      updatedAt: new Date()
    }
  });

  return {
    type: "text",
    text: `Aquí te van los precios:\n\n${responseParts.join('\n')}\n\n¿Cuál te interesa?`
  };
}

/**
 * Handle malla flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // Get current state
  let state = getFlowState(convo);

  console.log(`🌐 Malla flow - Current state:`, state);
  console.log(`🌐 Malla flow - Intent: ${intent}, Entities:`, entities);
  console.log(`🌐 Malla flow - User message: "${userMessage}"`);

  // CHECK FOR MULTIPLE DIMENSIONS FIRST
  // If user asks for multiple sizes like "6x5 o 5x5", handle them together
  const { extractAllDimensions } = require("../core/multipleSizes");
  const allDimensions = extractAllDimensions(userMessage);

  if (allDimensions.length >= 2) {
    console.log(`🌐 Malla flow - Multiple dimensions detected: ${allDimensions.map(d => d.width + 'x' + d.height).join(', ')}`);
    return await handleMultipleDimensions(allDimensions, psid, convo);
  }

  // CHECK FOR CONFIRMATION of recommended size
  // When user says "Claro", "Sí", "Ok" etc. after we recommended a size
  if (intent === INTENTS.CONFIRMATION && convo?.lastIntent === "malla_awaiting_confirmation" && convo?.recommendedSize) {
    console.log(`🌐 Malla flow - User confirmed recommended size: ${convo.recommendedSize}`);

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
      return await handleComplete(intent, state, sourceContext, psid, convo);
    }
  }

  // FIRST: Try to parse dimensions directly from user message
  // This is more reliable than depending on classifier entities
  const dimsFromMessage = parseDimensions(userMessage);
  if (dimsFromMessage) {
    console.log(`🌐 Malla flow - Parsed dimensions from message: ${dimsFromMessage.width}x${dimsFromMessage.height}`);
    state.width = dimsFromMessage.width;
    state.height = dimsFromMessage.height;
  }

  // SECOND: Try single dimension - assume square (e.g., "2 y medio" -> 3x3)
  if (!state.width || !state.height) {
    const singleDim = parseSingleDimension(userMessage);
    if (singleDim) {
      const rounded = Math.round(singleDim);
      console.log(`🌐 Malla flow - Single dimension ${singleDim}m, assuming square ${rounded}x${rounded}`);
      state.width = rounded;
      state.height = rounded;
    }
  }

  // THEN: Check classifier entities as backup
  if (!state.width || !state.height) {
    if (entities.dimensions) {
      const dims = parseDimensions(entities.dimensions);
      if (dims) {
        state.width = dims.width;
        state.height = dims.height;
      }
    }
    // Also check for width/height separately
    if (entities.width && entities.height) {
      state.width = entities.width;
      state.height = entities.height;
    }
  }
  if (entities.percentage) {
    state.percentage = entities.percentage;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.quantity) {
    state.quantity = entities.quantity;
  }

  // Check if user is asking about product condition (new vs used)
  const conditionRequest = /\b(nuev[oa]s?|usad[oa]s?|segunda\s*mano|de\s*segunda|reciclad[oa]s?)\b/i;
  const isAskingAboutCondition = userMessage && conditionRequest.test(userMessage);

  if (isAskingAboutCondition) {
    return {
      type: "text",
      text: "Sí, todas nuestras mallas son nuevas, somos fabricantes ¿Qué medida necesitas?"
    };
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
    return handleProductInfo(userMessage);
  }

  // Determine current stage
  const stage = determineStage(state);

  // Generate response based on stage
  let response;

  switch (stage) {
    case STAGES.AWAITING_DIMENSIONS:
      response = handleAwaitingDimensions(intent, state, sourceContext, userMessage);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo);
      break;

    default:
      response = handleStart(sourceContext);
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
 * Handle product info request - user asking about characteristics
 */
function handleProductInfo(userMessage) {
  return {
    type: "text",
    text: "La malla sombra confeccionada viene lista para instalar:\n\n" +
          "• Material: Polietileno de alta densidad (HDPE)\n" +
          "• Color: Beige\n" +
          "• Porcentajes de sombra: 35%, 50%, 70%, 80% y 90%\n" +
          "• Incluye ojillos en todo el perímetro para fácil instalación\n" +
          "• Resistente a rayos UV\n" +
          "• Durable (5+ años de vida útil)\n\n" +
          "Las medidas van desde 2x2m hasta 6x10m. Para medidas más grandes hacemos pedidos especiales.\n\n" +
          "¿Qué medida necesitas?"
  };
}

/**
 * Handle start - user just mentioned malla
 */
function handleStart(sourceContext) {
  return {
    type: "text",
    text: "¡Hola! Tenemos malla sombra confeccionada lista para instalar.\n\n" +
          "Los precios dependen de la medida.\n\n" +
          "¿Qué medida necesitas? (ej: 4x3 metros)"
  };
}

/**
 * Handle awaiting dimensions stage
 */
function handleAwaitingDimensions(intent, state, sourceContext, userMessage = '') {
  // Check if they're asking for info even at this stage
  const infoRequest = /\b(caracter[ií]sticas?|informaci[oó]n|info|c[oó]mo\s*(es|son)|de\s*qu[eé]|especificaciones?)\b/i;
  if (userMessage && infoRequest.test(userMessage)) {
    return handleProductInfo(userMessage);
  }

  // Check if they're asking what sizes/prices are available
  // "que tamaños son", "qué medidas tienen", "cuáles medidas", "q salen", "medidas y precios"
  const sizesListRequest = /\b(qu[eé]|cu[aá]l(es)?)\s*(tamaños?|medidas?|dimensiones?)\s*(son|hay|tienen|manejan|disponibles?)?\b/i.test(userMessage) ||
                           /\b(tamaños?|medidas?)\s*(disponibles?|tienen|manejan|hay)\b/i.test(userMessage) ||
                           /\b(q|que|qué)\s+salen\b/i.test(userMessage) ||
                           /\b(medidas?|tamaños?)\s*(y|con)\s*(precios?|costos?)\b/i.test(userMessage) ||
                           /\b(precios?|costos?)\s*(y|con)\s*(medidas?|tamaños?)\b/i.test(userMessage);

  if (sizesListRequest) {
    // Show range instead of full list (rule: don't dump long lists)
    return {
      type: "text",
      text: "Tenemos malla sombra confeccionada desde 2x2m hasta 6x10m.\n\n" +
            "Los precios van desde $320 hasta $1,800 dependiendo del tamaño.\n\n" +
            "¿Qué medida necesitas?"
    };
  }

  // If they're asking about prices without dimensions
  if (intent === INTENTS.PRICE_QUERY) {
    return {
      type: "text",
      text: "Los precios van desde $320 hasta $1,800 dependiendo de la medida.\n\n" +
            "¿Qué medida necesitas? (ej: 4x3 metros)"
    };
  }

  // Check if user mentioned an object they want to cover (carro, cochera, patio, etc.)
  const objectPatterns = [
    { pattern: /\b(carro|coche|auto|veh[ií]culo|camioneta)\b/i, object: "carro" },
    { pattern: /\b(cochera|garaje|garage)\b/i, object: "cochera" },
    { pattern: /\b(patio|jard[ií]n)\b/i, object: "patio" },
    { pattern: /\b(terraza|balc[oó]n)\b/i, object: "terraza" },
    { pattern: /\b(ventana|ventanal)\b/i, object: "ventana" },
    { pattern: /\b(puerta|entrada)\b/i, object: "puerta" },
    { pattern: /\b(estacionamiento|parking)\b/i, object: "estacionamiento" },
    { pattern: /\b(negocio|local|tienda)\b/i, object: "negocio" },
    { pattern: /\b(alberca|piscina)\b/i, object: "alberca" }
  ];

  for (const { pattern, object } of objectPatterns) {
    if (pattern.test(userMessage)) {
      return {
        type: "text",
        text: `¿Qué dimensiones tiene tu ${object}?`
      };
    }
  }

  // General ask for dimensions
  return {
    type: "text",
    text: "Para darte el precio necesito la medida.\n\n" +
          "¿Qué área buscas cubrir? (ej: 4x3 metros, 5x5 metros)"
  };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo) {
  const { width, height, percentage, color, quantity } = state;

  // Check if dimensions are fractional (we only do whole meters)
  const hasFractions = (width % 1 !== 0) || (height % 1 !== 0);

  if (hasFractions) {
    // Round up to suggest closest sizes
    const roundedWidth = Math.ceil(width);
    const roundedHeight = Math.ceil(height);

    // Save recommended size for when user confirms
    await updateConversation(psid, {
      lastIntent: "malla_awaiting_confirmation",
      recommendedSize: `${roundedWidth}x${roundedHeight}`,
      lastUnavailableSize: `${width}x${height}`
    });

    return {
      type: "text",
      text: `Solo manejamos medidas en metros completos.\n\n` +
            `Para ${width}x${height}m, te recomiendo ${roundedWidth}x${roundedHeight}m.\n\n` +
            `¿Te interesa esa medida?`
    };
  }

  // Check if this is a custom order (both sides >= 8m)
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);

  if (minSide >= 8 && maxSide >= 8) {
    // Custom order - needs human handoff
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Custom malla order: ${width}x${height}m${percentage ? ' @ ' + percentage + '%' : ''}`,
      handoffTimestamp: new Date()
    });

    return {
      type: "text",
      text: `La medida ${width}x${height}m es un pedido especial.\n\n` +
            `Un especialista te contactará para cotización personalizada.\n\n` +
            `¿Hay algo más que necesites?`
    };
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

      // No sellable products found - generic not available
      return {
        type: "text",
        text: getNotAvailableResponse(`${width}x${height}m`, convo.poiRootName || 'Malla Sombra')
      };
    }
  }
  // ====== END POI TREE CHECK ======

  // Try to find matching products (within POI tree if locked)
  const products = await findMatchingProducts(width, height, percentage, color, convo?.poiRootId);

  if (products.length > 0) {
    // Found exact matches - use the first one
    const product = products[0];

    // ENRICH PRODUCT WITH TREE CONTEXT
    const enrichedProduct = await enrichProductWithContext(product);
    const displayName = await getProductDisplayName(product, 'short');
    const productInterest = await getProductInterest(product);

    // Update conversation with proper productInterest from tree
    if (productInterest) {
      await updateConversation(psid, { productInterest });
    }

    // Check for wholesale qualification
    if (quantity && product.wholesaleEnabled && product.wholesaleMinQty) {
      if (quantity >= product.wholesaleMinQty) {
        // Wholesale handoff
        const { handleWholesaleRequest } = require("../utils/wholesaleHandler");
        const wholesaleResponse = await handleWholesaleRequest(product, quantity, psid, convo);
        if (wholesaleResponse) {
          return wholesaleResponse;
        }
      }
    }

    // Get the preferred link from onlineStoreLinks
    const preferredLink = product.onlineStoreLinks?.find(link => link.isPreferred);
    const productUrl = preferredLink?.url || product.onlineStoreLinks?.[0]?.url;

    if (!productUrl) {
      // No link available - hand off to human
      console.log(`⚠️ Product ${product.name} has no online store link`);
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: `Malla ${width}x${height}m - no link available`,
        handoffTimestamp: new Date()
      });

      return {
        type: "text",
        text: `¡Tenemos la ${displayName}! Un especialista te contactará con el precio y link de compra.\n\n¿Necesitas algo más?`
      };
    }

    const trackedLink = await generateClickLink(psid, productUrl, {
      productName: product.name,
      productId: product._id,
      city: convo?.city,
      stateMx: convo?.stateMx
    });

    const quantityText = quantity ? `Para ${quantity} piezas, ` : "";
    const priceText = product.price ? ` por ${formatMoney(product.price)}` : "";

    // Add wholesale mention if product is eligible
    let wholesaleMention = "";
    if (product.wholesaleEnabled && product.wholesaleMinQty && !quantity) {
      wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
    }

    return {
      type: "text",
      text: `¡Perfecto! ${quantityText}Tenemos la ${displayName}${priceText}:\n\n` +
            `${trackedLink}\n\n` +
            `Ahí puedes ver el precio y comprar. El envío está incluido.${wholesaleMention}\n\n` +
            `¿Necesitas algo más?`
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

  if (nearestCover) {
    // There's a single piece that could cover
    recommendedSize = nearestCover.product.size;
    response += `La más cercana que cubre esa área es de ${recommendedSize} por ${formatMoney(nearestCover.product.price)}.\n\n`;
    response += `¿Te interesa esa medida, o prefieres que te pase con un especialista para cotización a medida?`;
  } else if (largest) {
    // Show largest available and offer custom
    recommendedSize = largest.product.size;
    response += `Nuestra medida más grande en confeccionada es de ${largest.product.size} por ${formatMoney(largest.product.price)}.\n\n`;
    response += `Para ${width}x${height}m necesitarías una cotización a medida. ¿Te interesa la de ${largest.product.size} o te paso con un especialista?`;
  }

  // Save the custom request and recommended size for follow-up
  await updateConversation(psid, {
    lastUnavailableSize: `${width}x${height}`,
    lastIntent: "malla_awaiting_confirmation",
    recommendedSize: recommendedSize
  });

  if (!nearestCover && !largest) {
    // No alternatives found - hand off
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Malla quote request: ${width}x${height}m - no alternatives found`,
      handoffTimestamp: new Date()
    });
    response = `La medida ${width}x${height}m requiere cotización especial.\n\n`;
    response += `Un especialista te contactará con el precio. ¿Necesitas algo más?`;
  }

  return {
    type: "text",
    text: response
  };
}

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

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
  determineStage
};
