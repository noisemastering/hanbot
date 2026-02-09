// ai/flows/mallaFlow.js
// State machine for malla confeccionada (pre-made shade mesh) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");
const ZipCode = require("../../models/ZipCode");
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

// Location detection
const { detectMexicanLocation, detectZipCode } = require("../../mexicanLocations");

// Push notifications for handoffs
const { sendHandoffNotification } = require("../../services/pushNotifications");

// NOTE: Global intents are now handled by the Intent Dispatcher (ai/intentDispatcher.js)
// which runs BEFORE flows. This delegation is being phased out.
// Keeping import for backwards compatibility during migration.
const { handleGlobalIntents } = require("../global/intents");

/**
 * Parse zip code from message and look up location
 * Patterns: CP 12345, C.P. 12345, cp12345, al 12345, codigo postal 12345
 * @param {string} msg - User message
 * @returns {Promise<object|null>} { code, city, state, municipality, shipping } or null
 */
async function parseAndLookupZipCode(msg) {
  if (!msg) return null;

  const patterns = [
    /\b(?:c\.?p\.?|codigo\s*postal|cp)\s*[:\.]?\s*(\d{5})\b/i,
    /\bal\s+(\d{5})\b/i,
    /\b(\d{5})\b(?=\s*(?:$|,|\.|\s+(?:para|en|a)\b))/i
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const code = match[1];
      try {
        const location = await ZipCode.lookup(code);
        if (location) {
          console.log(`📍 Zip code ${code} → ${location.city}, ${location.state}`);
          return location;
        }
      } catch (err) {
        console.error(`❌ Zip code lookup failed:`, err.message);
      }
    }
  }

  return null;
}

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
  let response = `La malla sombra confeccionada viene lista para instalar con argollas en todo el perímetro, pero no incluye cuerda ni arnés.\n\n`;
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
  // When bot asked "¿Te muestro las alternativas?" and user says "sí", "cuáles", "muéstrame", etc.
  if (convo?.lastIntent === "awaiting_alternatives_confirmation") {
    const wantsToSeeAlternatives = /\b(s[ií]|cu[aá]les|mu[eé]str|ver|dale|claro|ok|va|por\s*favor|ens[eé][ñn]|d[ií]me|ser[ií]an)\b/i.test(userMessage);

    if (wantsToSeeAlternatives) {
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
          text: `Las medidas más cercanas que tenemos son:\n\n${optionsList}\n\n¿Te interesa alguna de estas?`
        };
      }

      // No alternatives available - hand off
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: `Sin alternativas para ${convo.requestedSize}`,
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      return {
        type: "text",
        text: "Déjame comunicarte con un especialista para buscar opciones para tu medida."
      };
    }
  }

  // FIRST: Try to parse dimensions directly from user message
  // This is more reliable than depending on classifier entities
  const dimsFromMessage = parseDimensions(userMessage);
  if (dimsFromMessage) {
    console.log(`🌐 Malla flow - Parsed dimensions from message: ${dimsFromMessage.width}x${dimsFromMessage.height}`);
    state.width = dimsFromMessage.width;
    state.height = dimsFromMessage.height;
    // Preserve user's expressed order for display (e.g., "7 x 5" not "5 x 7")
    state.userExpressedSize = dimsFromMessage.userExpressed;
  }

  // SECOND: Try single dimension - assume square (e.g., "2 y medio" -> 3x3)
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
          text: `${requestedArea} metros cuadrados puede ser varias medidas. Te muestro las más cercanas:\n\n${optionsList}\n\n¿Cuál te interesa?`
        };
      }
    }
  }

  // THEN: Check classifier entities as backup
  if (!state.width || !state.height) {
    if (entities.dimensions) {
      const dims = parseDimensions(entities.dimensions);
      if (dims) {
        state.width = dims.width;
        state.height = dims.height;
        // Preserve user's expressed order for display
        state.userExpressedSize = dims.userExpressed;
      }
    }
    // Also check for width/height separately
    if (entities.width && entities.height) {
      state.width = entities.width;
      state.height = entities.height;
      // When parsed separately, construct userExpressed from raw values
      state.userExpressedSize = `${entities.width} x ${entities.height}`;
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

  // Determine current stage
  const stage = determineStage(state);

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
 * Handle product info request - user asking about characteristics
 */
async function handleProductInfo(userMessage, convo) {
  const response = await generateBotResponse("product_info", {
    productType: "malla_sombra_confeccionada",
    material: "Polietileno de alta densidad (HDPE)",
    color: "Beige",
    shadePercentage: "90%",
    hasEyelets: true,
    hasUVProtection: true,
    lifespan: "5+ años",
    sizeRange: "2x2m hasta 6x10m",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle start - user just mentioned malla
 */
async function handleStart(sourceContext, convo) {
  const response = await generateBotResponse("malla_start", {
    productType: "malla_sombra_confeccionada",
    convo
  });

  return { type: "text", text: response };
}

/**
 * Handle awaiting dimensions stage
 */
async function handleAwaitingDimensions(intent, state, sourceContext, userMessage = '', convo = null, psid = null) {
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
    // Show range instead of full list (rule: don't dump long lists)
    const response = await generateBotResponse("catalog_request", {
      sizeRange: "2x2m hasta 6x10m",
      priceRange: "$320 hasta $1,800",
      convo
    });
    return { type: "text", text: response };
  }

  // If they're asking about prices without dimensions
  if (intent === INTENTS.PRICE_QUERY) {
    const response = await generateBotResponse("price_query_no_size", {
      priceRange: "$320 hasta $1,800",
      convo
    });
    return { type: "text", text: response };
  }

  // Check if user is asking about product features (material, percentage, color, UV)
  // Collect all matching features to give a combined response
  const featureChecks = [
    {
      pattern: /\b(es\s+)?raschel\b/i,
      response: "es malla raschel de alta densidad (HDPE)"
    },
    {
      pattern: /\b(90|noventa)\s*%?(?!\s*(m|metro|x|\d))/i,
      response: "sí manejamos 90% de sombra"
    },
    {
      pattern: /\b(80|ochenta|70|setenta|50|cincuenta|35|treinta\s*y\s*cinco)\s*%?(?!\s*(m|metro|x|\d))/i,
      response: "la malla confeccionada es 90% de sombra. Para otros porcentajes tenemos malla raschel para uso agrícola"
    },
    {
      pattern: /\b(porcentaje|nivel\s*de\s*sombra)\b/i,
      response: "la malla confeccionada es 90% de sombra"
    },
    {
      pattern: /\b(beige|caf[eé])\b/i,
      response: "el color es beige"
    },
    {
      pattern: /\b(uv|rayos|sol)\b/i,
      response: "tiene protección UV"
    },
    {
      pattern: /\b(ojillos?|ojales?|arillos?|argollas?)\b/i,
      response: "viene con argollas reforzadas en todo el perímetro, lista para instalar"
    }
  ];

  const matchedFeatures = featureChecks.filter(f => f.pattern.test(userMessage));

  if (matchedFeatures.length > 0) {
    // Capitalize first response, join with ", "
    const responses = matchedFeatures.map(f => f.response);
    responses[0] = responses[0].charAt(0).toUpperCase() + responses[0].slice(1);
    const combined = responses.length > 1
      ? responses.slice(0, -1).join(', ') + ' y ' + responses[responses.length - 1]
      : responses[0];

    // Check if we already have dimensions - don't ask again
    const alreadyHasDimensions = state.width && state.height;
    const alreadyShownProduct = convo?.lastIntent === 'malla_complete' && convo?.productSpecs?.width;

    let followUp = "";
    if (!alreadyHasDimensions && !alreadyShownProduct) {
      followUp = "\n\n¿Qué medida necesitas?";
    } else {
      followUp = "\n\n¿Necesitas algo más?";
    }

    return {
      type: "text",
      text: `Sí, ${combined}.${followUp}`
    };
  }

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

  // General ask for dimensions
  const response = await generateBotResponse("awaiting_dimensions", {
    productType: "malla_sombra_confeccionada",
    convo
  });
  return { type: "text", text: response };
}

/**
 * Handle complete - we have dimensions
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '') {
  const { width, height, percentage, color, quantity, userExpressedSize, concerns } = state;

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

  // Check if dimensions are fractional - offer standard size first before handoff
  const hasFractions = (width % 1 !== 0) || (height % 1 !== 0);

  if (hasFractions) {
    console.log(`📏 Fractional meters detected in mallaFlow (${width}x${height}m), offering standard size first`);

    const roundedW = Math.round(width);
    const roundedH = Math.round(height);

    // Find closest standard size to offer
    try {
      const sizeVariants = [
        `${roundedW}x${roundedH}`, `${roundedW}x${roundedH}m`,
        `${roundedH}x${roundedW}`, `${roundedH}x${roundedW}m`
      ];

      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: true
      });

      if (product) {
        const productLink = product.onlineStoreLinks?.mercadoLibre || product.mLink;
        if (productLink) {
          // Save state to await their choice
          await updateConversation(psid, {
            lastIntent: "fractional_awaiting_choice",
            fractionalOriginalSize: `${width}x${height}`,
            fractionalStandardSize: `${roundedW}x${roundedH}`,
            fractionalProductId: product._id.toString(),
            unknownCount: 0
          });

          return {
            type: "text",
            text: `Tenemos la medida estándar ${roundedW}x${roundedH}m por $${product.price}. ¿Te funciona o prefieres cotización exacta para ${width}x${height}m?`
          };
        }
      }
    } catch (err) {
      console.error("Error getting closest size:", err);
    }

    // No standard size found - hand off directly with video
    await updateConversation(psid, {
      lastIntent: "fractional_meters_handoff",
      handoffRequested: true,
      handoffReason: `Medida con decimales: ${width}x${height}m`,
      handoffTimestamp: new Date(),
      state: "needs_human",
      unknownCount: 0
    });

    sendHandoffNotification(psid, `Medida con decimales: ${width}x${height}m - requiere atención`).catch(err => {
      console.error("❌ Failed to send push notification:", err);
    });

    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    const response = await generateBotResponse("specialist_handoff", {
      dimensions: `${width}x${height}m`,
      videoLink: VIDEO_LINK
    });
    return { type: "text", text: response };
  }

  // Check if this is a custom order (both sides >= 8m)
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);

  if (minSide >= 8 && maxSide >= 8) {
    // Custom order - offer standard size combinations
    console.log(`🏭 Custom order detected in mallaFlow (${width}x${height}m), offering standard size combinations`);

    // Find the largest standard sizes that could be combined
    const availableSizes = await getAvailableSizes(convo);
    const largestSizes = availableSizes
      .filter(s => s.price > 0)
      .sort((a, b) => b.area - a.area)
      .slice(0, 4);

    const sizeList = largestSizes.map(s => `${s.sizeStr} ($${s.price})`).join(', ');

    await updateConversation(psid, {
      lastIntent: "custom_order_awaiting_decision",
      customOrderSize: `${width}x${height}m`,
      suggestedSizes: largestSizes.map(s => s.sizeStr),
      unknownCount: 0
    });

    return {
      type: "text",
      text: `En dimensiones tan grandes es necesaria una confección especial. ¿Deseas combinar dos medidas estándar? ${sizeList}\n\nSi quieres la medida específica que mencionas (${width}x${height}m) te puedo comunicar con un especialista.`
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

      // No sellable products found - offer to show alternatives
      await updateConversation(psid, {
        lastIntent: "awaiting_alternatives_confirmation",
        requestedSize: `${width}x${height}`,
        productSpecs: { ...convo?.productSpecs, width, height, updatedAt: new Date() }
      });

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
      // No link available - hand off to human with video
      console.log(`⚠️ Product ${product.name} has no online store link`);
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: `Malla ${width}x${height}m - no link available`,
        handoffTimestamp: new Date()
      });

      sendHandoffNotification(psid, `Malla ${width}x${height}m - producto sin link`).catch(err => {
        console.error("❌ Failed to send push notification:", err);
      });

      const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
      return {
        type: "text",
        text: `¡Tenemos la ${displayName}! Un especialista te contactará con el precio y link de compra.\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`
      };
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
    if (product.wholesaleEnabled && product.wholesaleMinQty && !quantity) {
      wholesaleMention = `\n\nA partir de ${product.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
    }

    // Build quantity prefix if needed
    const quantityText = quantity ? `Para ${quantity} piezas:\n\n` : "";

    // Ask for zip code for ML purchase attribution (ties conversation to ML order)
    const hasLocation = convo?.city || convo?.stateMx || convo?.zipCode;
    const zipAsk = hasLocation ? '' : '\n\n¿Me compartes tu código postal para calcular el envío?';

    if (!hasLocation) {
      await updateConversation(psid, {
        pendingShippingLocation: true,
        lastSharedProductId: product._id?.toString(),
        lastSharedProductLink: productUrl,
        unknownCount: 0
      });
    }

    return {
      type: "text",
      text: `${quantityText}${salesPitch}\n` +
            `🛒 Cómprala aquí:\n${trackedLink}${wholesaleMention}${zipAsk}`
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
    // Check if the requested area is MUCH larger than the largest available
    // If so, suggest multiple pieces or hand off for custom order
    const requestedAreaSqM = width * height;
    const largestAreaSqM = largest.area;
    const piecesNeeded = Math.ceil(requestedAreaSqM / largestAreaSqM);

    if (piecesNeeded >= 3) {
      // Very large area - hand off for custom order
      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: `Área grande: ${width}x${height}m (${requestedAreaSqM}m²) - requiere cotización especial`,
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      sendHandoffNotification(psid, `Malla ${width}x${height}m (${requestedAreaSqM}m²) - área muy grande`).catch(err => {
        console.error("❌ Failed to send push notification:", err);
      });

      const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
      response = `Para cubrir ${width}x${height}m (${requestedAreaSqM}m²) necesitarías múltiples piezas o un pedido especial.\n\n`;
      response += `Déjame comunicarte con un especialista para cotizarte la mejor opción.\n\n`;
      response += `📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;

      return { type: "text", text: response };
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
    await updateConversation(psid, {
      handoffRequested: true,
      handoffReason: `Malla quote request: ${width}x${height}m - no alternatives found`,
      handoffTimestamp: new Date()
    });

    sendHandoffNotification(psid, `Malla ${width}x${height}m - sin alternativas disponibles`).catch(err => {
      console.error("❌ Failed to send push notification:", err);
    });

    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    response = `La medida ${width}x${height}m requiere cotización especial.\n\n`;
    response += `Un especialista te contactará con el precio.\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;
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

  // FIRST: Check if user is asking for non-90% shade (35%, 50%, 70%, 80%)
  // These are ROLLO products, not confeccionada (which is only 90%)
  // Patterns: "al 50%", "50%", "al 50", "malla 50", "50/100" (50% shade, 100m roll)
  const nonConfeccionadaShade = /\b(al\s*)?(35|50|70|80)\s*(%|porciento|por\s*ciento)?\b|\b(35|50|70|80)\s*[\/]\s*100\b/i;
  if (nonConfeccionadaShade.test(msg)) {
    console.log(`🌐 Malla flow - Non-90% shade detected, deferring to rollo flow`);
    return false;
  }

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
