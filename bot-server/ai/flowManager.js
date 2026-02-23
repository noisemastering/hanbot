// ai/flowManager.js
// Central flow manager - ALL messages go through here
// Handles: scoring, flow detection, flow routing, flow transfers

const { updateConversation } = require("../conversationManager");
const { scorePurchaseIntent, isWholesaleInquiry } = require("./utils/purchaseIntentScorer");
const { parseDimensions } = require("../measureHandler");
const { INTENTS, PRODUCTS } = require("./classifier");
const { analyzeUseCaseFit, generateSuggestionMessage } = require("./utils/usoCaseMatcher");
const ProductFamily = require("../models/ProductFamily");
const { generateClickLink } = require("../tracking");
const { executeHandoff } = require("./utils/executeHandoff");
const { analyzeProductSwitch } = require("./utils/productSwitchAnalyzer");
const { matchDimensionToFlow, checkDimensionOwnership } = require("./utils/inventoryMatcher");
const Ad = require("../models/Ad");
const Campaign = require("../models/Campaign");

// Flow imports
const defaultFlow = require("./flows/defaultFlow");
const mallaFlow = require("./flows/mallaFlow");
const rolloFlow = require("./flows/rolloFlow");
const bordeFlow = require("./flows/bordeFlow");
const groundcoverFlow = require("./flows/groundcoverFlow");
const monofilamentoFlow = require("./flows/monofilamentoFlow");
const generalFlow = require("./flows/generalFlow");
const leadCaptureFlow = require("./flows/leadCaptureFlow");

/**
 * Cache for product-based flow inference
 */
let productFlowCache = {};
let productFlowCacheExpiry = 0;
const PRODUCT_FLOW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cache for product family catalog lookups
 */
let familyCatalogCache = {};
let familyCatalogCacheExpiry = 0;

/**
 * Map flow names to root product family name patterns
 */
const FLOW_TO_FAMILY_REGEX = {
  'rollo': /rollo|malla.*sombra.*raschel/i,
  'malla_sombra': /malla.*sombra.*confeccionada/i,
  'borde_separador': /borde.*separador|cinta.*pl[aá]stica/i,
  'groundcover': /ground.*cover|antimaleza/i,
  'monofilamento': /monofilamento/i
};

/**
 * Infer flow from ad product IDs by checking actual product data in the DB.
 * Rolls have sizes like "2x100m", "4x100m". Confeccionada have "4x5m", "6x8m".
 * Borde has sizes like "18m", "54m". Groundcover/monofilamento determined by name.
 */
async function inferFlowFromProductIds(productIds) {
  if (!productIds?.length) return null;

  const cacheKey = productIds.slice(0, 3).join(',');
  if (productFlowCache[cacheKey] && Date.now() < productFlowCacheExpiry) {
    return productFlowCache[cacheKey];
  }

  try {
    const products = await ProductFamily.find({
      _id: { $in: productIds },
      active: true,
      sellable: true
    }).select('name size').lean();

    if (products.length === 0) return null;

    // Check product sizes to determine type
    let rollCount = 0, confecCount = 0, bordeCount = 0, gcCount = 0, monoCount = 0;

    for (const p of products) {
      const name = (p.name || '').toLowerCase();
      const size = (p.size || '').toLowerCase();

      // Groundcover/antimaleza by name
      if (/groundcover|antimaleza|ground.*cover/.test(name)) { gcCount++; continue; }
      // Monofilamento by name
      if (/monofilamento/.test(name)) { monoCount++; continue; }
      // Borde by name or size pattern (just meters, no x)
      if (/borde|separador/.test(name) || /^\d+\s*m(ts?|etros?)?$/i.test(size)) { bordeCount++; continue; }
      // Roll: size has x100 pattern
      if (/\d+\s*x\s*100/i.test(size)) { rollCount++; continue; }
      // Confeccionada: size has NxN but not x100
      if (/\d+\s*x\s*\d+/i.test(size)) { confecCount++; continue; }
    }

    let flow = null;
    const maxCount = Math.max(rollCount, confecCount, bordeCount, gcCount, monoCount);
    if (maxCount === 0) return null;

    if (rollCount === maxCount) flow = 'rollo';
    else if (confecCount === maxCount) flow = 'malla_sombra';
    else if (bordeCount === maxCount) flow = 'borde_separador';
    else if (gcCount === maxCount) flow = 'groundcover';
    else if (monoCount === maxCount) flow = 'monofilamento';

    // Cache result
    productFlowCache[cacheKey] = flow;
    productFlowCacheExpiry = Date.now() + PRODUCT_FLOW_CACHE_TTL;
    console.log(`🔍 Inferred flow from ${products.length} ad products: ${flow} (rolls:${rollCount} confec:${confecCount} borde:${bordeCount} gc:${gcCount} mono:${monoCount})`);

    return flow;
  } catch (err) {
    console.error("Error inferring flow from products:", err.message);
    return null;
  }
}

/**
 * Flow registry - maps flow names to flow modules
 */
const FLOWS = {
  default: defaultFlow,
  malla_sombra: mallaFlow,
  rollo: rolloFlow,
  borde_separador: bordeFlow,
  groundcover: rolloFlow,       // unified: handled by rolloFlow
  monofilamento: rolloFlow,     // unified: handled by rolloFlow
  lead_capture: leadCaptureFlow
};

/**
 * Maps flowRef values (from ad hierarchy) to flow names
 */
const FLOW_REF_MAP = {
  'mallaFlow': 'malla_sombra',
  'rolloFlow': 'rollo',
  'bordeFlow': 'borde_separador',
  'groundcoverFlow': 'groundcover',
  'monofilamentoFlow': 'monofilamento',
  'malla_sombra': 'malla_sombra',
  'rollo': 'rollo',
  'borde_separador': 'borde_separador',
  'groundcover': 'groundcover',
  'monofilamento': 'monofilamento'
};

/**
 * Product-type keywords we don't sell — used to detect "unknown product" questions
 */
const UNKNOWN_PRODUCTS = /\b(lona|polisombra|media\s*sombra|malla\s*cicl[oó]n|malla\s*electrosoldada|malla\s*galvanizada|pl[aá]stico\s*(para\s*)?invernadero|rafia|costal|tela|alambre|cerca|reja|manguera|tubo|a[lc]ochado|acolchado)\b/i;

/** Flows considered wholesale/roll context — prefer catalog over ML store link */
const WHOLESALE_FLOWS = ['rollo', 'groundcover', 'monofilamento'];

/**
 * Look up catalog URL with hierarchy: Ad → Campaign → Product Family → Global → null
 */
async function getCatalogUrl(convo, currentFlow) {
  try {
    // 1. Ad catalog
    if (convo?.adId) {
      const ad = await Ad.findOne({ fbAdId: convo.adId }).select('catalog').lean();
      if (ad?.catalog?.url) return ad.catalog.url;
    }
    // 2. Campaign catalog
    if (convo?.campaignId) {
      const campaign = await Campaign.findOne({ fbCampaignId: convo.campaignId }).select('catalog').lean();
      if (campaign?.catalog?.url) return campaign.catalog.url;
    }
    // 3. Product Family catalog (based on current flow)
    const flow = currentFlow || convo?.currentFlow;
    if (flow) {
      const familyCatalog = await getProductFamilyCatalog(flow);
      if (familyCatalog) return familyCatalog;
    }
    // 4. Global catalog (from BusinessInfo)
    const { getBusinessInfo } = require("../businessInfoManager");
    const bizInfo = await getBusinessInfo();
    if (bizInfo?.catalog?.url) return bizInfo.catalog.url;
  } catch (err) {
    console.error("Error looking up catalog:", err.message);
  }
  return null;
}

/**
 * Look up catalog URL from root product family based on flow name
 */
async function getProductFamilyCatalog(flow) {
  const regex = FLOW_TO_FAMILY_REGEX[flow];
  if (!regex) return null;

  // Check cache
  const cacheKey = flow;
  if (familyCatalogCache[cacheKey] && Date.now() < familyCatalogCacheExpiry) {
    return familyCatalogCache[cacheKey];
  }

  try {
    const family = await ProductFamily.findOne({
      name: regex,
      parentId: null,
      'catalog.url': { $exists: true, $ne: null }
    }).select('catalog name').lean();

    const url = family?.catalog?.url || null;

    // Cache result (even null to avoid repeated queries)
    familyCatalogCache[cacheKey] = url;
    familyCatalogCacheExpiry = Date.now() + PRODUCT_FLOW_CACHE_TTL;

    if (url) {
      console.log(`📄 Found catalog from ProductFamily "${family.name}": ${url}`);
    }

    return url;
  } catch (err) {
    console.error("Error looking up family catalog:", err.message);
    return null;
  }
}

/**
 * Build the response for an unknown product (something we don't sell).
 * For roll/wholesale contexts: offer catalog instead of ML store link.
 */
async function buildUnknownProductResponse(unknownProduct, psid, convo, currentFlow, campaign) {
  const isWholesaleContext = WHOLESALE_FLOWS.includes(currentFlow) ||
    convo?.isWholesaleInquiry ||
    campaign?.conversationGoal === 'cotizacion' ||
    campaign?.conversationGoal === 'lead_capture';

  // For wholesale/roll contexts, prefer sending the catalog
  if (isWholesaleContext) {
    const catalogUrl = await getCatalogUrl(convo, currentFlow) || campaign?.catalog?.url;
    if (catalogUrl) {
      console.log(`📄 Unknown product in wholesale context — sharing catalog instead of ML store`);
      return {
        type: "text",
        text: `No manejamos ${unknownProduct}, pero te comparto nuestro catálogo con todo lo que ofrecemos:\n\n📄 ${catalogUrl}\n\n¿Hay algo que te interese?`,
        handledBy: "flow:unknown_product",
        purchaseIntent: 'low'
      };
    }
  }

  // Default: ML store link
  try {
    const trackedLink = await generateClickLink(psid, 'https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob', {
      reason: 'unknown_product',
      unknownProduct,
      campaignId: convo?.campaignId,
      userName: convo?.userName
    });

    return {
      type: "text",
      text: `No manejamos ${unknownProduct}, pero te comparto nuestra tienda donde puedes ver todo lo que ofrecemos: ${trackedLink}`,
      handledBy: "flow:unknown_product",
      purchaseIntent: 'low'
    };
  } catch (err) {
    console.error(`⚠️ Error generating tracked link for unknown product:`, err.message);
    return {
      type: "text",
      text: `No manejamos ${unknownProduct}. Manejamos malla sombra, borde separador, ground cover y monofilamento. ¿Te interesa alguno?`,
      handledBy: "flow:unknown_product",
      purchaseIntent: 'low'
    };
  }
}

/**
 * Product type to flow mapping (from productInterest string)
 */
const PRODUCT_TYPE_TO_FLOW = {
  'malla_sombra': 'malla_sombra',
  'malla_sombra_raschel': 'malla_sombra',
  'rollo': 'rollo',
  'borde_separador': 'borde_separador',
  'ground_cover': 'groundcover',
  'groundcover': 'groundcover',
  'monofilamento': 'monofilamento'
};

/**
 * Check if the message contains unambiguous switching language
 * e.g., "mejor quiero antimaleza", "en vez de malla quiero rollo"
 * These are clear enough to skip AI confirmation
 */
function isUnambiguousSwitch(msg, currentFlow = null, targetFlow = null) {
  // Explicit switch language
  if (/\b(en vez de|mejor quiero|cambio a|prefiero|no quiero .+ quiero|ya no .+ sino|en lugar de|cambi[ée]|quiero cambiar a)\b/i.test(msg)) {
    return true;
  }
  // Naming a completely different product category is unambiguous
  // e.g., saying "malla sombra" while in groundcover, or "groundcover" while in malla_sombra
  if (currentFlow && targetFlow && currentFlow !== targetFlow) {
    const differentCategory = {
      'malla_sombra': ['groundcover', 'monofilamento', 'borde_separador'],
      'groundcover': ['malla_sombra', 'rollo', 'borde_separador'],
      'monofilamento': ['malla_sombra', 'groundcover', 'borde_separador'],
      'rollo': ['groundcover', 'borde_separador', 'malla_sombra'],
      'borde_separador': ['malla_sombra', 'rollo', 'groundcover', 'monofilamento']
    };
    if (differentCategory[currentFlow]?.includes(targetFlow)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect if user explicitly mentioned a different product than current flow
 * Returns the new product flow if detected, null otherwise
 */
async function detectExplicitProductSwitch(userMessage, currentFlow, classification) {
  const msg = (userMessage || '').toLowerCase();

  // Map of explicit product keywords to flows
  const explicitProductPatterns = {
    'rollo': { pattern: /\b(rollo|rollos|100\s*m(etros)?)\b/i, flow: 'rollo' },
    'borde_separador': { pattern: /\b(bordes?|separador|cinta\s*pl[aá]stica)\b/i, flow: 'borde_separador' },
    'groundcover': { pattern: /\b(ground\s*cover|antimaleza|malla\s*(para\s*)?maleza)\b/i, flow: 'groundcover' },
    'monofilamento': { pattern: /\b(monofilamento)\b/i, flow: 'monofilamento' },
    'malla_sombra': { pattern: /\b(confeccionada|malla\s*sombra)\b/i, flow: 'malla_sombra' }
  };

  // Also check classification product
  const classificationFlowMap = {
    [PRODUCTS.ROLLO]: 'rollo',
    [PRODUCTS.BORDE_SEPARADOR]: 'borde_separador',
    [PRODUCTS.GROUNDCOVER]: 'groundcover',
    [PRODUCTS.MONOFILAMENTO]: 'monofilamento',
    [PRODUCTS.MALLA_SOMBRA]: 'malla_sombra'
  };

  // Check for explicit keyword mentions
  for (const [productKey, config] of Object.entries(explicitProductPatterns)) {
    if (config.pattern.test(msg) && config.flow !== currentFlow) {
      console.log(`🔍 Explicit product mention detected: ${productKey} (current: ${currentFlow})`);
      return config.flow;
    }
  }

  // "malla" + shade percentage (35/50/70/80/90%) without "confeccionada" → rollo
  if (/\bmalla\b/i.test(msg) && /\b(35|50|70|80|90)\s*%/.test(msg) && currentFlow !== 'rollo') {
    console.log(`🔍 Malla + shade percentage detected → rollo (current: ${currentFlow})`);
    return 'rollo';
  }

  // Check dimensions against inventory — a known measure outside current flow = product switch
  const dimMatch = msg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if (dimMatch) {
    const d1 = parseFloat(dimMatch[1]);
    const d2 = parseFloat(dimMatch[2]);

    // Explicit roll dimension (one side = 100)
    if ((d1 === 100 || d2 === 100) && currentFlow !== 'rollo') {
      console.log(`🔍 Roll dimension detected: ${d1}x${d2} (current: ${currentFlow})`);
      return 'rollo';
    }

    // Data-driven: check if this dimension belongs to a different flow
    const ownership = await checkDimensionOwnership(d1, d2, currentFlow);
    if (ownership.matchedFlow && !ownership.belongsToCurrent) {
      console.log(`🔍 Dimension ${d1}x${d2} belongs to ${ownership.matchedFlow}, not ${currentFlow} (from inventory)`);
      return ownership.matchedFlow;
    }

    // Fallback: infer from dimension range when no exact inventory match
    // Roll-type flows (rollo, groundcover, monofilamento) expect one side ≈ 100m
    // If neither dimension is ≥ 50, these are confeccionada-sized dimensions
    if (!ownership.matchedFlow) {
      const maxDim = Math.max(d1, d2);
      const rollFlows = ['rollo', 'groundcover', 'monofilamento'];
      if (rollFlows.includes(currentFlow) && maxDim < 50) {
        console.log(`🔍 Dimensions ${d1}x${d2} too small for ${currentFlow} (max ${maxDim} < 50) — switching to malla_sombra`);
        return 'malla_sombra';
      }
    }
  }

  // Check classification if it detected a different product
  if (classification?.product && classification.product !== PRODUCTS.UNKNOWN) {
    const classifiedFlow = classificationFlowMap[classification.product];
    if (classifiedFlow && classifiedFlow !== currentFlow) {
      console.log(`🔍 Classification detected different product: ${classifiedFlow} (current: ${currentFlow})`);
      return classifiedFlow;
    }
  }

  return null;
}

/**
 * Detect which flow should handle this conversation
 * Priority: currentFlow > ad products > ad product interest > ad flowRef > classification > productInterest > keywords > dimensions > default
 */
async function detectFlow(classification, convo, userMessage, sourceContext) {
  const msg = (userMessage || '').toLowerCase();

  // 1. CONVERSATION CONTINUITY: Already in a product flow
  if (convo?.currentFlow && convo.currentFlow !== 'default') {
    return convo.currentFlow;
  }

  // 2. AD HIERARCHY: Products take priority over flowRef (ad→adSet→campaign)
  // The products on the ad are more specific than a campaign-level flowRef
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;
  if (adProductIds?.length) {
    const flowFromProducts = await inferFlowFromProductIds(adProductIds);
    if (flowFromProducts) {
      console.log(`🎯 Flow inferred from ad products: ${flowFromProducts}`);
      return flowFromProducts;
    }
  }

  // Fallback to productInterest resolved from ad product
  const adProduct = sourceContext?.ad?.product;
  if (adProduct) {
    const adFlow = PRODUCT_TYPE_TO_FLOW[adProduct] || PRODUCT_TYPE_TO_FLOW[adProduct.toLowerCase()];
    if (adFlow) {
      console.log(`🎯 Flow from ad product interest: ${adProduct} → ${adFlow}`);
      return adFlow;
    }
  }

  // 3. AD HIERARCHY FLOWREF: Fallback to cascaded flowRef if no product resolved
  const adFlowRef = sourceContext?.ad?.flowRef || convo?.adFlowRef;
  if (adFlowRef && FLOW_REF_MAP[adFlowRef]) {
    console.log(`🎯 Flow from ad hierarchy flowRef: ${adFlowRef} → ${FLOW_REF_MAP[adFlowRef]}`);
    return FLOW_REF_MAP[adFlowRef];
  }

  // 4. CLASSIFICATION PRODUCT: Explicit product detected in message
  // BUT: If classifier says "rollo" and message has borde-specific lengths (6/9/18/54m),
  // this is a borde separador (which comes in meter rolls), not a 100m malla sombra roll.
  if (classification.product && classification.product !== PRODUCTS.UNKNOWN) {
    let effectiveProduct = classification.product;

    // Override: "rollo" + borde length → borde_separador
    if (effectiveProduct === PRODUCTS.ROLLO && /\b(6|9|18|54)\s*(m|metros?|mts?)\b/i.test(msg) && !/\b100\s*(m|metros?)\b/i.test(msg)) {
      console.log(`🔄 Classification override: "rollo" + borde length detected → borde_separador`);
      effectiveProduct = PRODUCTS.BORDE_SEPARADOR;
    }

    // Override: classifier disagrees with ad context for borde
    if (effectiveProduct === PRODUCTS.ROLLO && convo?.productInterest === 'borde_separador') {
      console.log(`🔄 Classification override: classifier said "rollo" but ad context is borde_separador`);
      effectiveProduct = PRODUCTS.BORDE_SEPARADOR;
    }

    const flowMap = {
      [PRODUCTS.MALLA_SOMBRA]: 'malla_sombra',
      [PRODUCTS.ROLLO]: 'rollo',
      [PRODUCTS.BORDE_SEPARADOR]: 'borde_separador',
      [PRODUCTS.GROUNDCOVER]: 'groundcover',
      [PRODUCTS.MONOFILAMENTO]: 'monofilamento'
    };

    if (flowMap[effectiveProduct]) {
      return flowMap[effectiveProduct];
    }
  }

  // 5. PRODUCT INTEREST: From conversation context (ads, previous context)
  if (convo?.productInterest) {
    const pi = convo.productInterest.toLowerCase();

    if (pi.startsWith('malla_sombra') || pi === 'confeccionada') {
      return 'malla_sombra';
    }

    const interestMap = {
      'rollo': 'rollo',
      'borde_separador': 'borde_separador',
      'ground_cover': 'groundcover',
      'groundcover': 'groundcover',
      'monofilamento': 'monofilamento'
    };

    if (interestMap[pi]) {
      return interestMap[pi];
    }
  }

  // 6. KEYWORD DETECTION
  // "malla" alone (without rollo/maleza/monofilamento qualifier) → malla sombra confeccionada
  if (/\b(malla\s*sombra|confeccionada)\b/i.test(msg) && !/rollo/i.test(msg)) {
    return 'malla_sombra';
  }
  if (/\bmalla\b/i.test(msg) && !/rollo|maleza|antimaleza|ground\s*cover|monofilamento|cicl[oó]n|electrosoldada|galvanizada/i.test(msg)) {
    return 'malla_sombra';
  }
  if (/\brollo\b/i.test(msg) || /\b100\s*m(etros?)?\b/i.test(msg)) {
    // "rollo de 18 metros" = borde separador, not a 100m malla roll
    if (/\b(6|9|18|54)\s*(m|metros?|mts?)\b/i.test(msg) && !/\b100\s*(m|metros?)\b/i.test(msg)) {
      return 'borde_separador';
    }
    return 'rollo';
  }
  // "malla" + shade percentage (35/50/70/80/90%) → rollo (rolls come in percentages)
  if (/\bmalla\b/i.test(msg) && /\b(35|50|70|80|90)\s*%/.test(msg)) {
    return 'rollo';
  }
  // Roll dimension: NxN where one side is 100 (standard roll length)
  const rollDimMatch = msg.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if (rollDimMatch) {
    const d1 = parseFloat(rollDimMatch[1]);
    const d2 = parseFloat(rollDimMatch[2]);
    if (d1 === 100 || d2 === 100) {
      return 'rollo';
    }
  }
  if (/\bbordes?\b/i.test(msg) || /\bcinta\s*pl[aá]stica\b/i.test(msg)) {
    return 'borde_separador';
  }
  if (/\b(ground\s*cover|antimaleza|malla\s*(para\s*)?maleza)\b/i.test(msg)) {
    return 'groundcover';
  }
  if (/\bmonofilamento\b/i.test(msg)) {
    return 'monofilamento';
  }

  // 7. DIMENSION INFERENCE — data-driven via inventory matcher
  const dimensions = parseDimensions(userMessage);
  if (dimensions) {
    // Check if it looks like a roll (one side is 100)
    if (dimensions.width === 100 || dimensions.height === 100) {
      return 'rollo';
    }
    // Look up which flow owns this size in actual inventory
    const inventoryFlow = await matchDimensionToFlow(dimensions.width, dimensions.height);
    if (inventoryFlow) {
      console.log(`📦 Dimension ${dimensions.width}x${dimensions.height} matched to flow: ${inventoryFlow} (from inventory)`);
      return inventoryFlow;
    }
    // No inventory match but reasonable NxN dimensions — default to malla sombra
    console.log(`📦 Dimension ${dimensions.width}x${dimensions.height} not in inventory — defaulting to malla_sombra`);
    return 'malla_sombra';
  }

  // 8. DEFAULT
  return 'default';
}

/**
 * Check if flow should transfer to another flow
 * Returns new flow name or null if no transfer needed
 */
function checkFlowTransfer(currentFlow, detectedFlow, convo) {
  // Don't transfer if already in the detected flow
  if (currentFlow === detectedFlow) {
    return null;
  }

  // Transfer from default to product flow
  if (currentFlow === 'default' && detectedFlow !== 'default') {
    console.log(`🔄 Flow transfer: default → ${detectedFlow}`);
    return detectedFlow;
  }

  // Transfer between product flows (user changed mind)
  if (currentFlow !== 'default' && detectedFlow !== 'default' && currentFlow !== detectedFlow) {
    console.log(`🔄 Flow transfer: ${currentFlow} → ${detectedFlow}`);
    return detectedFlow;
  }

  return null;
}

/**
 * Main entry point - process ALL messages through flow manager
 */
async function processMessage(userMessage, psid, convo, classification, sourceContext, campaign = null) {
  console.log(`\n🎯 ===== FLOW MANAGER =====`);

  // ===== STEP 0a: CHECK FOR PENDING WHOLESALE/RETAIL CHOICE =====
  if (convo?.pendingWholesaleRetailChoice) {
    const msg = userMessage.toLowerCase();
    const isRetail = /\b(menudeo|por\s*pieza|una|pocas?|tienda|mercado\s*libre|en\s*l[ií]nea)\b/i.test(msg);
    const isWholesaleChoice = /\b(mayoreo|por\s*mayor|varias?|muchas?|cantidad|rollo|rollos|distribuidor|bulk)\b/i.test(msg);

    if (isRetail) {
      const newFlow = convo.pendingWholesaleRetailChoice;
      console.log(`🛒 Retail choice confirmed, switching to flow: ${newFlow}`);

      await updateConversation(psid, {
        currentFlow: newFlow,
        productInterest: newFlow,
        pendingWholesaleRetailChoice: null,
        flowTransferredFrom: convo.currentFlow,
        flowTransferredAt: new Date()
      });
      convo.currentFlow = newFlow;
      convo.productInterest = newFlow;

      // For roll products, delegate to the flow's handleStart for dynamic sizes
      const rollFlows = ['rollo', 'groundcover', 'monofilamento'];
      if (rollFlows.includes(newFlow)) {
        try {
          const flowModule = require(`./flows/${newFlow === 'rollo' ? 'rolloFlow' : newFlow + 'Flow'}`);
          if (flowModule.handleStart) {
            const flowResponse = await flowModule.handleStart(sourceContext);
            if (flowResponse) {
              console.log(`🎯 ===== END FLOW MANAGER (retail → ${newFlow}) =====\n`);
              return { ...flowResponse, handledBy: `flow:${newFlow}`, purchaseIntent: 'medium' };
            }
          }
        } catch (e) {
          console.error(`⚠️ Error calling ${newFlow} handleStart:`, e.message);
        }
      }

      const flowGreetings = {
        'malla_sombra': '¡Perfecto! Para la malla sombra confeccionada, ¿qué medida necesitas?',
        'borde_separador': '¡Perfecto! Para el borde separador, ¿qué largo necesitas?'
      };

      console.log(`🎯 ===== END FLOW MANAGER (retail → ${newFlow}) =====\n`);
      return {
        type: "text",
        text: flowGreetings[newFlow] || '¡Perfecto! ¿Qué medida necesitas?',
        handledBy: `flow:${newFlow}`,
        purchaseIntent: 'medium'
      };
    }

    if (isWholesaleChoice) {
      const productNames = {
        'rollo': 'rollos de malla sombra',
        'malla_sombra': 'malla sombra',
        'borde_separador': 'borde separador',
        'groundcover': 'ground cover',
        'monofilamento': 'malla monofilamento'
      };
      const productName = productNames[convo.pendingWholesaleRetailChoice] || 'producto';

      console.log(`🏭 Wholesale choice confirmed, handing off to specialist`);
      await updateConversation(psid, { pendingWholesaleRetailChoice: null });

      console.log(`🎯 ===== END FLOW MANAGER (wholesale handoff) =====\n`);
      const handoffResult = await executeHandoff(psid, convo, userMessage, {
        reason: `Mayoreo: ${productName}`,
        responsePrefix: `¡Claro! Para ${productName} al mayoreo te comunico con un especialista que te dará los mejores precios. `,
        skipChecklist: true,
        notificationText: `Cliente quiere ${productName} al mayoreo`
      });
      return {
        ...handoffResult,
        handledBy: "flow:wholesale_handoff",
        purchaseIntent: 'high'
      };
    }
    // If neither detected, clear pending and continue normal flow
    await updateConversation(psid, { pendingWholesaleRetailChoice: null });
  }
  // ===== END PENDING WHOLESALE/RETAIL CHECK =====

  // ===== STEP 0b: CHECK FOR PENDING FLOW CHANGE CONFIRMATION =====
  // If we suggested a product change and user confirms, execute the switch
  if (convo?.pendingFlowChange) {
    const msg = userMessage.toLowerCase();
    const isConfirmation = /\b(s[ií]|ok|claro|dale|va|me\s*interesa|esa|ese|la\s*quiero|lo\s*quiero)\b/i.test(msg);
    const isRejection = /\b(no|mejor\s*no|as[ií]\s*est[aá]|el\s*que\s*te\s*dije|la\s*que\s*te\s*dije|la\s*confeccionada|el\s*original)\b/i.test(msg);

    if (isConfirmation) {
      const newFlow = convo.pendingFlowChange;
      console.log(`✅ User confirmed flow change to: ${newFlow}`);

      // Check if this product type has both wholesale and retail options
      try {
        const productTypeMap = {
          'malla_sombra': /malla.*sombra/i,
          'rollo': /rollo/i,
          'borde_separador': /borde.*separador|cinta.*pl[aá]stica/i,
          'groundcover': /ground.*cover|antimaleza/i,
          'monofilamento': /monofilamento/i
        };
        const typeRegex = productTypeMap[newFlow];

        if (typeRegex) {
          const matchingProducts = await ProductFamily.find({
            name: typeRegex,
            sellable: true,
            active: true
          }).lean();

          const hasRetail = matchingProducts.some(p => p.onlineStoreLinks?.length > 0);
          const hasWholesale = matchingProducts.some(p => p.wholesaleEnabled || p.wholesaleMinQty > 0);

          if (hasRetail && hasWholesale) {
            // Both modes available — ask the customer
            const productNames = {
              'rollo': 'rollos de malla sombra',
              'malla_sombra': 'malla sombra',
              'borde_separador': 'borde separador',
              'groundcover': 'ground cover',
              'monofilamento': 'malla monofilamento'
            };
            const productName = productNames[newFlow] || newFlow;

            await updateConversation(psid, {
              pendingFlowChange: null,
              pendingUseCaseProducts: null,
              pendingWholesaleRetailChoice: newFlow
            });

            console.log(`🎯 ===== END FLOW MANAGER (wholesale/retail choice) =====\n`);
            return {
              type: "text",
              text: `Tenemos ${productName}. ¿Lo quieres al menudeo (por pieza) o al mayoreo?`,
              handledBy: "flow:wholesale_retail_choice",
              purchaseIntent: 'medium'
            };
          }

          if (!hasRetail && hasWholesale) {
            // Wholesale only — handoff to specialist
            const productNames = {
              'rollo': 'rollos de malla sombra',
              'malla_sombra': 'malla sombra',
              'borde_separador': 'borde separador',
              'groundcover': 'ground cover',
              'monofilamento': 'malla monofilamento'
            };
            const productName = productNames[newFlow] || newFlow;

            await updateConversation(psid, {
              pendingFlowChange: null,
              pendingUseCaseProducts: null
            });

            console.log(`🎯 ===== END FLOW MANAGER (wholesale-only handoff) =====\n`);
            const wholesaleResult = await executeHandoff(psid, convo, userMessage, {
              reason: `Mayoreo: ${productName}`,
              responsePrefix: `Para ${productName} te comunico con un especialista. `,
              skipChecklist: true,
              notificationText: `Cliente quiere ${productName} (solo mayoreo disponible)`
            });
            return {
              ...wholesaleResult,
              handledBy: "flow:wholesale_handoff",
              purchaseIntent: 'high'
            };
          }
        }
      } catch (err) {
        console.error(`⚠️ Error checking wholesale/retail for ${newFlow}:`, err.message);
        // Continue with normal flow switch on error
      }

      // Clear pending and switch flow (retail only, or no wholesale/retail distinction found)
      await updateConversation(psid, {
        currentFlow: newFlow,
        productInterest: newFlow,
        pendingFlowChange: null,
        pendingUseCaseProducts: null,
        flowTransferredFrom: convo.currentFlow,
        flowTransferredAt: new Date()
      });

      convo.currentFlow = newFlow;
      convo.productInterest = newFlow;

      // For roll products, delegate to the flow's handleStart for dynamic sizes
      const rollFlows2 = ['rollo', 'groundcover', 'monofilamento'];
      if (rollFlows2.includes(newFlow)) {
        try {
          const flowModule = require(`./flows/${newFlow === 'rollo' ? 'rolloFlow' : newFlow + 'Flow'}`);
          if (flowModule.handleStart) {
            const flowResponse = await flowModule.handleStart(sourceContext);
            if (flowResponse) {
              console.log(`🎯 ===== END FLOW MANAGER (flow changed to ${newFlow}) =====\n`);
              return { ...flowResponse, handledBy: `flow:${newFlow}`, purchaseIntent: 'medium' };
            }
          }
        } catch (e) {
          console.error(`⚠️ Error calling ${newFlow} handleStart:`, e.message);
        }
      }

      // Route to new flow with a greeting
      const flowGreetings = {
        'malla_sombra': '¡Perfecto! Para la malla sombra confeccionada, ¿qué medida necesitas?',
        'borde_separador': '¡Perfecto! Para el borde separador, ¿qué largo necesitas?'
      };

      console.log(`🎯 ===== END FLOW MANAGER (flow changed to ${newFlow}) =====\n`);
      return {
        type: "text",
        text: flowGreetings[newFlow] || `¡Perfecto! ¿Qué medida necesitas?`,
        handledBy: `flow:${newFlow}`,
        purchaseIntent: 'medium'
      };
    }

    if (isRejection) {
      console.log(`❌ User rejected flow change, staying in: ${convo.currentFlow}`);

      // Clear pending change
      await updateConversation(psid, {
        pendingFlowChange: null,
        pendingFlowChangeReason: null,
        pendingUseCaseProducts: null
      });

      // Confirm staying with current product
      const currentProductNames = {
        'rollo': 'rollo de malla sombra',
        'malla_sombra': 'malla sombra confeccionada',
        'borde_separador': 'borde separador',
        'groundcover': 'ground cover',
        'monofilamento': 'malla monofilamento'
      };
      const currentName = currentProductNames[convo.currentFlow] || 'producto actual';

      console.log(`🎯 ===== END FLOW MANAGER (staying in ${convo.currentFlow}) =====\n`);
      return {
        type: "text",
        text: `Perfecto, seguimos con el ${currentName}. ¿En qué te puedo ayudar?`,
        handledBy: `flow:${convo.currentFlow}`,
        purchaseIntent: 'medium'
      };
    }
  }
  // ===== END PENDING FLOW CHANGE CHECK =====

  // ===== STEP 0.5: CHECK FOR EXPLICIT PRODUCT SWITCH =====
  // If user is in a product flow and explicitly asks for a different product we sell, switch directly
  const currentFlow = convo?.currentFlow || 'default';
  if (currentFlow !== 'default' && !convo?.pendingFlowChange) {
    const switchToFlow = await detectExplicitProductSwitch(userMessage, currentFlow, classification);

    if (switchToFlow) {
      // Determine if this is an unambiguous switch or needs AI confirmation
      const unambiguous = isUnambiguousSwitch(userMessage, currentFlow, switchToFlow);
      let confirmed = unambiguous;

      if (!unambiguous) {
        // Ambiguous keyword match — ask AI to confirm
        console.log(`🔍 Ambiguous product switch detected: ${currentFlow} → ${switchToFlow}, verifying with AI...`);
        const aiResult = await analyzeProductSwitch(userMessage, currentFlow, convo, sourceContext);
        confirmed = aiResult.shouldSwitch;

        if (!confirmed) {
          console.log(`🤖 AI says NO switch (staying in ${currentFlow}): ${userMessage}`);
        }
      }

      if (confirmed) {
        console.log(`🔄 Product switch: ${currentFlow} → ${switchToFlow} (${unambiguous ? 'unambiguous' : 'AI confirmed'})`);

        // Switch directly — confirmed by either explicit language or AI
        await updateConversation(psid, {
          currentFlow: switchToFlow,
          productInterest: switchToFlow,
          pendingFlowChange: null,
          pendingFlowChangeReason: null,
          flowTransferredFrom: currentFlow,
          flowTransferredAt: new Date(),
          // Reset product specs for the new flow
          productSpecs: { productType: switchToFlow, updatedAt: new Date() }
        });
        convo.currentFlow = switchToFlow;
        convo.productInterest = switchToFlow;
        convo.productSpecs = { productType: switchToFlow };

        // Let the message fall through to be handled by the new flow
        // (the flow detection in step 2 will pick up the new currentFlow)
      }
    }

    // Check for unknown products (things we don't sell)
    if (!switchToFlow) {
      const unknownMatch = userMessage.match(UNKNOWN_PRODUCTS);
      if (unknownMatch) {
        const unknownProduct = unknownMatch[1];
        console.log(`❓ Unknown product detected: "${unknownProduct}" (we don't sell this)`);
        console.log(`🎯 ===== END FLOW MANAGER (unknown product) =====\n`);
        return await buildUnknownProductResponse(unknownProduct, psid, convo, currentFlow, campaign);
      }
    }
  }
  // ===== END PRODUCT SWITCH CHECK =====

  // ===== STEP 0.6: CHECK FOR LEAD CAPTURE CAMPAIGN =====
  // B2B/Distributor campaigns should go through lead capture flow
  if (campaign && leadCaptureFlow.shouldHandle(classification, sourceContext, convo, userMessage, campaign)) {
    console.log(`📋 Routing to lead capture flow (campaign: ${campaign.name})`);
    const leadResponse = await leadCaptureFlow.handle(classification, sourceContext, convo, psid, campaign, userMessage);
    if (leadResponse) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by lead_capture) =====\n`);
      return {
        ...leadResponse,
        handledBy: "flow:lead_capture"
      };
    }
  } else if (convo?.lastIntent?.startsWith("lead_")) {
    // User broke out of lead capture (product query detected) — clear lead state
    console.log(`📋 Clearing lead capture state — user broke out with product query`);
    await updateConversation(psid, { lastIntent: null, leadData: null });
    convo.lastIntent = null;
  }
  // ===== END LEAD CAPTURE CHECK =====

  // ===== STEP 0.7: CHECK FOR UNKNOWN PRODUCTS (any flow) =====
  {
    const unknownMatch = userMessage.match(UNKNOWN_PRODUCTS);
    if (unknownMatch) {
      const unknownProduct = unknownMatch[1];
      console.log(`❓ Unknown product detected: "${unknownProduct}" (we don't sell this)`);
      const currentFlowForUnknown = convo?.currentFlow || 'default';
      console.log(`🎯 ===== END FLOW MANAGER (unknown product) =====\n`);
      return await buildUnknownProductResponse(unknownProduct, psid, convo, currentFlowForUnknown, campaign);
    }
  }
  // ===== END UNKNOWN PRODUCT CHECK =====

  // ===== STEP 1: ALWAYS SCORE PURCHASE INTENT =====
  const isWholesale = isWholesaleInquiry(userMessage, convo);
  const intentScore = scorePurchaseIntent(userMessage, convo);

  // Update conversation with score (non-blocking but we want it to persist)
  await updateConversation(psid, {
    purchaseIntent: intentScore.intent,
    intentSignals: intentScore.signals,
    isWholesaleInquiry: isWholesale
  });

  console.log(`📊 Purchase intent: ${intentScore.intent.toUpperCase()}`);
  // ===== END SCORING =====

  // ===== STEP 2: DETECT APPROPRIATE FLOW =====
  // Note: currentFlow already declared in step 0.5
  const detectedFlow = await detectFlow(classification, convo, userMessage, sourceContext);

  console.log(`📍 Current flow: ${currentFlow}, Detected: ${detectedFlow}`);

  // ===== STEP 3: CHECK FOR FLOW TRANSFER =====
  const transferTo = checkFlowTransfer(currentFlow, detectedFlow, convo);
  let activeFlow = transferTo || currentFlow;

  if (transferTo) {
    // Update conversation with new flow
    await updateConversation(psid, {
      currentFlow: transferTo,
      flowTransferredFrom: currentFlow,
      flowTransferredAt: new Date()
    });

    // Update local convo object
    convo.currentFlow = transferTo;
  } else if (currentFlow === 'default' && detectedFlow === 'default' && !convo?.currentFlow) {
    // Initialize default flow for new conversations
    await updateConversation(psid, { currentFlow: 'default' });
    convo.currentFlow = 'default';
  }

  // ===== STEP 3.1: VERIFY NEWLY-ESTABLISHED FLOW AGAINST USER MESSAGE =====
  // When a flow was just established (transfer from default), the user's explicit
  // message may contradict the ad context. E.g., ad says "rollo" but user asks
  // for "malla sombra de 5x6.50m" — the user's intent should win.
  if (transferTo && currentFlow === 'default' && activeFlow !== 'default') {
    const switchFromNew = await detectExplicitProductSwitch(userMessage, activeFlow, classification);
    if (switchFromNew) {
      const unambiguous = isUnambiguousSwitch(userMessage, activeFlow, switchFromNew);
      if (unambiguous) {
        console.log(`🔄 Overriding ad-established flow: ${activeFlow} → ${switchFromNew} (user's message contradicts ad context)`);
        activeFlow = switchFromNew;

        await updateConversation(psid, {
          currentFlow: switchFromNew,
          productInterest: switchFromNew,
          flowTransferredFrom: transferTo,
          flowTransferredAt: new Date(),
          productSpecs: { productType: switchFromNew, updatedAt: new Date() }
        });
        convo.currentFlow = switchFromNew;
        convo.productInterest = switchFromNew;
        convo.productSpecs = { productType: switchFromNew };
      }
    }
  }
  // ===== END FLOW DETECTION =====

  // ===== STEP 3.5: CHECK USE CASE FIT =====
  // Detect if user mentions a use case and validate product fit
  const productInterest = convo?.productInterest || activeFlow;
  const useCaseAnalysis = await analyzeUseCaseFit(userMessage, productInterest);

  if (useCaseAnalysis.detected) {
    // Store the detected use case in conversation
    await updateConversation(psid, {
      detectedUseCase: useCaseAnalysis.keywords[0],
      useCaseFits: useCaseAnalysis.fits
    });

    // If product doesn't fit the use case, suggest alternatives
    if (useCaseAnalysis.shouldSuggestChange) {
      const suggestionMsg = generateSuggestionMessage(useCaseAnalysis);

      if (suggestionMsg) {
        console.log(`🔄 Product mismatch detected - suggesting alternatives`);

        // Determine the best flow for suggested products
        let suggestedFlow = activeFlow;
        const suggestedProduct = useCaseAnalysis.suggestedProducts[0];
        if (suggestedProduct) {
          const name = suggestedProduct.name.toLowerCase();
          if (name.includes('rollo')) suggestedFlow = 'rollo';
          else if (name.includes('ground') || name.includes('antimaleza')) suggestedFlow = 'groundcover';
          else if (name.includes('monofilamento')) suggestedFlow = 'monofilamento';
          else if (name.includes('borde')) suggestedFlow = 'borde_separador';
        }

        // Store pending flow change (user needs to confirm)
        await updateConversation(psid, {
          pendingFlowChange: suggestedFlow,
          pendingUseCaseProducts: useCaseAnalysis.suggestedProducts.map(p => p._id)
        });

        console.log(`🎯 ===== END FLOW MANAGER (use case mismatch) =====\n`);
        return {
          type: "text",
          text: suggestionMsg,
          handledBy: "flow:use_case_matcher",
          purchaseIntent: intentScore.intent
        };
      }
    }
  }
  // ===== END USE CASE FIT CHECK =====

  // ===== STEP 4: ROUTE TO ACTIVE FLOW =====
  const flow = FLOWS[activeFlow];

  if (!flow) {
    console.error(`❌ Unknown flow: ${activeFlow}`);
    return null;
  }

  console.log(`✅ Routing to: ${activeFlow} flow`);

  // Pass scoring info to flow
  const flowContext = {
    intentScore,
    isWholesale,
    transferredFrom: transferTo ? currentFlow : null,
    classification,
    sourceContext,
    campaign,
    useCaseAnalysis
  };

  try {
    const response = await flow.handle(classification, sourceContext, convo, psid, campaign, userMessage, flowContext);

    if (response) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by ${activeFlow}) =====\n`);
      return {
        ...response,
        handledBy: `flow:${activeFlow}`,
        purchaseIntent: intentScore.intent
      };
    }
  } catch (error) {
    console.error(`❌ Error in ${activeFlow} flow:`, error.message);
  }

  // ===== STEP 5: FALLBACK TO GENERAL FLOW =====
  // If product flow didn't handle it, try general flow for common queries
  if (activeFlow !== 'default' && generalFlow.shouldHandle(classification, sourceContext, convo, userMessage)) {
    console.log(`🔄 Fallback to general flow for common query`);
    const generalResponse = await generalFlow.handle(classification, sourceContext, convo, psid, campaign, userMessage);

    if (generalResponse) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by general) =====\n`);
      return {
        ...generalResponse,
        handledBy: 'flow:general',
        purchaseIntent: intentScore.intent
      };
    }
  }

  console.log(`🎯 ===== END FLOW MANAGER (not handled) =====\n`);
  return null;
}

/**
 * Get current flow state for a conversation
 */
function getFlowState(convo) {
  return {
    currentFlow: convo?.currentFlow || 'default',
    purchaseIntent: convo?.purchaseIntent || null,
    intentSignals: convo?.intentSignals || {},
    isWholesale: convo?.isWholesaleInquiry || false
  };
}

module.exports = {
  processMessage,
  detectFlow,
  checkFlowTransfer,
  getFlowState,
  getCatalogUrl,
  FLOWS
};
