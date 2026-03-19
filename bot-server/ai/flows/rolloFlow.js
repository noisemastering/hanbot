// ai/flows/rolloFlow.js
// State machine for roll (rollo) product flow
// Uses existing product utilities for search and tree climbing

const { updateConversation } = require("../../conversationManager");
const { checkCommonHandlers } = require("./commonHandlers");
const ProductFamily = require("../../models/ProductFamily");
const ZipCode = require("../../models/ZipCode");
const { INTENTS } = require("../classifier");
const { parseAndLookupZipCode: sharedParseAndLookupZipCode } = require("../utils/preHandoffCheck");

// AI escalation for unrecognized messages
const { OpenAI } = require("openai");
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// Dimension shape classifier — detects when dimensions suggest a different product
const { classifyDimensionShape } = require("../utils/dimensionParsers");

// Import existing utilities - USE THESE
const { getAncestors, getRootFamily } = require("../utils/productMatcher");
const {
  enrichProductWithContext,
  getProductDisplayName,
  getProductInterest
} = require("../utils/productEnricher");

/**
 * Flow stages for rollo
 */
const STAGES = {
  START: "start",
  AWAITING_TYPE: "awaiting_type",  // Ask what type of rollo (malla sombra, groundcover, monofilamento)
  AWAITING_WIDTH: "awaiting_width",
  AWAITING_PERCENTAGE: "awaiting_percentage",
  AWAITING_QUANTITY: "awaiting_quantity",
  AWAITING_ZIP: "awaiting_zip",
  COMPLETE: "complete"
};

/**
 * Rollo types
 */
const ROLLO_TYPES = {
  MALLA_SOMBRA: "malla_sombra",
  GROUNDCOVER: "groundcover",
  MONOFILAMENTO: "monofilamento"
};

/**
 * Display info per rollo type — drives display strings, percentage-stage logic, and fallbacks
 */
const TYPE_DISPLAY = {
  malla_sombra:  { name: 'malla sombra',        short: 'malla sombra',   hasPercentage: true  },
  groundcover:   { name: 'malla antimaleza',     short: 'groundcover',    hasPercentage: false },
  monofilamento: { name: 'malla monofilamento',  short: 'monofilamento',  hasPercentage: true  }
};

/**
 * Detect rollo type from user message
 * Returns the type if detected, null if ambiguous
 */
function detectRolloType(msg, convo = null) {
  if (!msg) return null;
  const m = msg.toLowerCase();

  // Check conversation context first
  if (convo?.productInterest === 'groundcover' || convo?.lastIntent?.includes('groundcover')) {
    return ROLLO_TYPES.GROUNDCOVER;
  }
  if (convo?.productInterest === 'monofilamento' || convo?.lastIntent?.includes('monofilamento')) {
    return ROLLO_TYPES.MONOFILAMENTO;
  }

  // Groundcover indicators
  if (/\b(groundcover|ground\s*cover|antimaleza|anti\s*maleza|para\s+el\s+suelo|suelo|piso|maleza|hierba|yerbas?)\b/i.test(m)) {
    return ROLLO_TYPES.GROUNDCOVER;
  }

  // Monofilamento indicators
  if (/\b(monofilamento|mono\s*filamento)\b/i.test(m)) {
    return ROLLO_TYPES.MONOFILAMENTO;
  }

  // Malla sombra indicators
  if (/\b(malla\s*sombra|raschel|sombra|sombreado|porcentaje)\b/i.test(m) ||
      /\b\d{2,3}\s*(%|porciento|por\s*ciento)/i.test(m)) {
    return ROLLO_TYPES.MALLA_SOMBRA;
  }

  // Check if they explicitly mention the roll type context
  if (convo?.productSpecs?.rolloType) {
    return convo.productSpecs.rolloType;
  }

  // Default to malla sombra — it's the main product.
  // Only groundcover/monofilamento need explicit detection.
  return ROLLO_TYPES.MALLA_SOMBRA;
}

/**
 * Per-type cache for available rollo widths (refreshed every 5 minutes)
 */
const widthsCache = {};   // { malla_sombra: [...], groundcover: [...], ... }
const widthsCacheExpiry = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build a DB query filter for the given rollo type
 */
function buildTypeFilter(rolloType) {
  switch (rolloType) {
    case ROLLO_TYPES.GROUNDCOVER:
      return {
        $or: [
          { name: /groundcover/i },
          { name: /antimaleza/i },
          { name: /ground.*cover/i },
          { aliases: { $in: [/groundcover/i, /antimaleza/i] } }
        ]
      };
    case ROLLO_TYPES.MONOFILAMENTO:
      return {
        $or: [
          { name: /monofilamento/i },
          { aliases: { $in: [/monofilamento/i] } }
        ]
      };
    default: // malla_sombra — rolls with NxN100 size, excluding gc/mono names
      return {
        size: /\d+x100/i,
        name: { $not: /groundcover|antimaleza|monofilamento/i }
      };
  }
}

/**
 * AI escalation — handles questions/messages that regex can't parse.
 * Returns { width: N } or { percentage: N } or { response: "..." } or null.
 */
async function escalateToAI(userMessage, convo) {
  try {
    const rolloType = convo?.productSpecs?.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
    const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;
    const userName = convo?.userName || null;
    const lastBotMsg = convo?.lastBotResponse || null;

    // Gather available widths and percentages for context
    let catalogInfo = '';
    try {
      const widths = await getAvailableWidths(rolloType);
      const pcts = typeInfo.hasPercentage ? await getAvailablePercentages(rolloType) : [];
      catalogInfo = `Anchos disponibles: ${widths.join(', ')}m.`;
      if (pcts.length > 0) catalogInfo += ` Porcentajes de sombra: ${pcts.join(', ')}%.`;
      catalogInfo += ' Todos los rollos son de 100 metros lineales.';
    } catch (e) { /* ignore */ }

    let contextLines = [];
    if (userName) contextLines.push(`Nombre del cliente: ${userName}`);
    if (lastBotMsg) contextLines.push(`Último mensaje del bot: "${lastBotMsg.slice(0, 150)}"`);
    if (catalogInfo) contextLines.push(catalogInfo);
    if (convo?.productSpecs?.width) contextLines.push(`Ancho seleccionado: ${convo.productSpecs.width}m`);
    if (convo?.productSpecs?.percentage) contextLines.push(`Porcentaje seleccionado: ${convo.productSpecs.percentage}%`);
    if (convo?.productSpecs?.quantity) contextLines.push(`Cantidad: ${convo.productSpecs.quantity} rollo(s)`);
    const contextBlock = contextLines.length > 0 ? `\nCONTEXTO:\n${contextLines.join('\n')}\n` : '';

    const productBlock = rolloType === ROLLO_TYPES.GROUNDCOVER
      ? `PRODUCTO: Malla antimaleza (groundcover).
- Tela tejida para control de maleza en jardines, invernaderos y cultivos
- Permite el paso del agua pero bloquea la luz solar para evitar el crecimiento de hierba
- Rollos de 100 metros lineales
- La compra es directa con nosotros (no por Mercado Libre), se requiere código postal para cotizar envío`
      : rolloType === ROLLO_TYPES.MONOFILAMENTO
      ? `PRODUCTO: Malla monofilamento.
- Malla tejida de hilo monofilamento para protección y sombreado
- Rollos de 100 metros lineales
- La compra es directa con nosotros (no por Mercado Libre), se requiere código postal para cotizar envío`
      : `PRODUCTO: Rollo de malla sombra raschel.
- Malla sombra para uso agrícola, industrial o de proyecto a gran escala
- Diferentes porcentajes de sombra según necesidad (35% a 90%)
- Protección UV, alta durabilidad
- Rollos de 100 metros lineales
- La compra es directa con nosotros (no por Mercado Libre), se requiere código postal para cotizar envío
- Somos fabricantes en Querétaro`;

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres asesora de ventas de Hanlob, empresa mexicana fabricante de malla sombra.
${contextBlock}
${productBlock}

DATOS DEL NEGOCIO:
- Somos fabricantes en Querétaro, más de 5 años en el mercado
- WhatsApp: +52 442 595 7432
- Horario: Lunes a Viernes 8am-6pm

INSTRUCCIONES:
1. Si el cliente PIDE un ancho específico (2m, 4m, etc.):
   → { "type": "width", "width": <metros> }

2. Si el cliente PIDE un porcentaje de sombra:
   → { "type": "percentage", "percentage": <número> }

3. Si el cliente quiere hablar con una persona real, un especialista, asesor, o pide atención personalizada:
   → { "type": "handoff" }

4. Para cualquier otra cosa (pregunta, duda, confirmación, etc.):
   → { "type": "response", "text": "<tu respuesta>" }
   - Usa los datos de CONTEXTO y PRODUCTO
   - Si preguntan precio: explica que necesitas saber el ancho, porcentaje y código postal para cotizar
   - Si preguntan algo que no sabes: ofrece conectar con un especialista
   - Siempre guía al siguiente paso (elegir ancho, porcentaje, dar código postal)

REGLAS:
- Español mexicano, amable y conciso (2-4 oraciones)
- NUNCA inventes precios (rollos se cotizan, no tienen precio fijo en línea)
- NUNCA incluyas URLs/links (el sistema los agrega después)
- Solo devuelve JSON`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 250,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.type === 'width' && result.width) {
      const w = parseFloat(result.width);
      if (w > 0 && w <= 20) {
        return { width: w };
      }
    }

    if (result.type === 'percentage' && result.percentage) {
      const pct = parseInt(result.percentage);
      if (pct > 0 && pct <= 100) {
        return { percentage: pct };
      }
    }

    if (result.type === 'handoff') {
      return { handoff: true };
    }

    if (result.type === 'response' && result.text) {
      return { response: result.text };
    }

    return null;
  } catch (err) {
    console.error("❌ rollo escalateToAI error:", err.message);
    return null;
  }
}

/**
 * Get available rollo widths from database, filtered by rollo type
 */
async function getAvailableWidths(rolloType = ROLLO_TYPES.MALLA_SOMBRA) {
  const cacheKey = rolloType || 'malla_sombra';
  if (widthsCache[cacheKey] && Date.now() < (widthsCacheExpiry[cacheKey] || 0)) {
    return widthsCache[cacheKey];
  }

  try {
    const query = { sellable: true, active: true, ...buildTypeFilter(rolloType) };
    const products = await ProductFamily.find(query).select('size').lean();

    // Extract unique widths from size strings like "2x100m", "4x100m"
    const widths = new Set();
    for (const p of products) {
      const match = p.size?.match(/^(\d+(?:\.\d+)?)\s*x\s*\d+/i);
      if (match) {
        widths.add(parseFloat(match[1]));
      }
    }

    const sorted = [...widths].sort((a, b) => a - b);
    if (sorted.length > 0) {
      widthsCache[cacheKey] = sorted;
      widthsCacheExpiry[cacheKey] = Date.now() + CACHE_TTL;
      console.log(`🔄 ${cacheKey} widths cache refreshed: ${sorted.join(', ')}m`);
    }
    return sorted.length > 0 ? sorted : [2, 4]; // Fallback if no products found
  } catch (err) {
    console.error(`Error fetching ${cacheKey} widths:`, err.message);
    return [2, 4]; // Fallback
  }
}

/**
 * Valid percentages — used for parsing, not for display
 */
const VALID_PERCENTAGES = [35, 50, 70, 80, 90];

/**
 * Get available percentages from database, optionally filtered by width.
 * Returns array of numbers like [35, 50, 70].
 * Groundcover has no percentages — returns [] immediately.
 */
const pctCache = {};
const pctCacheExpiry = {};

async function getAvailablePercentages(rolloType = ROLLO_TYPES.MALLA_SOMBRA, filterWidth = null) {
  // Groundcover has no shade percentages
  if (rolloType === ROLLO_TYPES.GROUNDCOVER) return [];

  const cacheKey = `${rolloType}_${filterWidth || 'all'}`;
  if (pctCache[cacheKey] && Date.now() < (pctCacheExpiry[cacheKey] || 0)) {
    return pctCache[cacheKey];
  }

  try {
    const query = { sellable: true, active: true, ...buildTypeFilter(rolloType) };
    const products = await ProductFamily.find(query).select('name size').lean();

    const percentages = new Set();
    for (const p of products) {
      // Optionally filter by width
      if (filterWidth) {
        const sizeRegex = new RegExp(`${filterWidth}.*100`, 'i');
        if (!sizeRegex.test(p.size || '')) continue;
      }
      const pctMatch = (p.name || '').match(/(\d+)\s*%/);
      if (pctMatch) {
        percentages.add(parseInt(pctMatch[1]));
      }
    }

    const sorted = [...percentages].sort((a, b) => a - b);
    if (sorted.length > 0) {
      pctCache[cacheKey] = sorted;
      pctCacheExpiry[cacheKey] = Date.now() + CACHE_TTL;
    }
    return sorted.length > 0 ? sorted : VALID_PERCENTAGES;
  } catch (err) {
    console.error(`Error fetching ${rolloType} percentages:`, err.message);
    return VALID_PERCENTAGES;
  }
}


/**
 * Normalize width to closest available for the given rollo type
 */
async function normalizeWidth(width, rolloType = ROLLO_TYPES.MALLA_SOMBRA) {
  if (!width) return null;

  const availableWidths = await getAvailableWidths(rolloType);

  // Find closest match
  let closest = null;
  let minDiff = Infinity;

  for (const w of availableWidths) {
    const diff = Math.abs(width - w);
    if (diff < minDiff && diff <= 1) { // Within 1m tolerance
      minDiff = diff;
      closest = w;
    }
  }

  return closest;
}

/**
 * Format money for Mexican pesos
 */
function formatMoney(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

// parseAndLookupZipCode is now shared — use the import from preHandoffCheck
const parseAndLookupZipCode = sharedParseAndLookupZipCode;

/**
 * Build a human-readable product description from the DB lineage.
 * e.g. "un rollo de Malla Sombra Raschel Agrícola del 70% de cobertura, con medidas de 2m x 100m"
 */
async function buildProductDescription(product, state) {
  try {
    const ancestors = await getAncestors(product._id);
    // ancestors: [immediate parent, grandparent, ..., root]
    // Root (gen 1) has the product family name, gen 2 has the percentage
    const root = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    const productFamily = root?.name || TYPE_DISPLAY[state.rolloType]?.name || 'malla sombra';

    let desc = `un rollo de ${productFamily}`;
    if (state.percentage) {
      desc += ` del ${state.percentage}% de cobertura`;
    }
    desc += `, con medidas de ${state.width}m x 100m`;

    return desc;
  } catch (err) {
    console.error('Error building product description:', err.message);
    // Fallback
    const typeInfo = TYPE_DISPLAY[state.rolloType] || TYPE_DISPLAY.malla_sombra;
    let desc = `un rollo de ${typeInfo.name}`;
    if (state.percentage) desc += ` al ${state.percentage}%`;
    desc += ` de ${state.width}m x 100m`;
    return desc;
  }
}

/**
 * Find matching sellable roll products for the given type
 */
async function findMatchingProducts(width, percentage = null, rolloType = ROLLO_TYPES.MALLA_SOMBRA) {
  try {
    const widthSearch = String(width).replace('.00', '');
    const typeLabel = TYPE_DISPLAY[rolloType]?.short || rolloType;
    console.log(`🔍 Searching for ${typeLabel} ${widthSearch}m x 100m${percentage ? ` at ${percentage}%` : ''}`);

    const typeFilter = buildTypeFilter(rolloType);

    // Use $and to avoid conflicts between $or.name and percentage name filter
    const conditions = [
      { sellable: true },
      { active: true }
    ];

    // For groundcover/monofilamento, use name-based filter; for malla_sombra, use size
    if (rolloType === ROLLO_TYPES.GROUNDCOVER || rolloType === ROLLO_TYPES.MONOFILAMENTO) {
      // Name filter from buildTypeFilter
      if (typeFilter.$or) conditions.push({ $or: typeFilter.$or });
      // Size filter for width
      const sizeRegex = new RegExp(`${widthSearch}`, 'i');
      conditions.push({ size: sizeRegex });
    } else {
      // Malla sombra — size-based + exclude gc/mono
      const sizeRegex = new RegExp(`${widthSearch}.*100`, 'i');
      conditions.push({
        $or: [
          { size: sizeRegex },
          { name: new RegExp(`${widthSearch}.*100`, 'i') }
        ]
      });
      conditions.push({ name: { $not: /groundcover|antimaleza|monofilamento/i } });
    }

    // Add percentage filter if specified
    if (percentage) {
      conditions.push({
        $or: [
          { name: new RegExp(`${percentage}\\s*%`, 'i') },
          { name: new RegExp(`${percentage}\\s*por\\s*ciento`, 'i') }
        ]
      });
    }

    const products = await ProductFamily.find({ $and: conditions })
      .sort({ price: 1 })
      .lean();

    console.log(`🔍 Found ${products.length} matching ${typeLabel} products`);

    return products;
  } catch (error) {
    console.error(`❌ Error finding ${rolloType} products:`, error);
    return [];
  }
}

/**
 * Get current flow state from conversation
 * Recognizes old productType values ('groundcover', 'monofilamento') for backward compat
 */
function getFlowState(convo) {
  const specs = convo?.productSpecs || {};
  const isRolloProduct = ['rollo', 'groundcover', 'monofilamento'].includes(specs.productType);

  // Infer rolloType from old productType if rolloType not set
  const rolloType = specs.rolloType ||
    (specs.productType === 'groundcover' ? ROLLO_TYPES.GROUNDCOVER : null) ||
    (specs.productType === 'monofilamento' ? ROLLO_TYPES.MONOFILAMENTO : null) ||
    null;

  return {
    stage: isRolloProduct ? STAGES.COMPLETE : STAGES.START,
    rolloType,
    width: specs.width || null,
    percentage: specs.percentage || null,
    percentages: specs.percentages || (specs.percentage ? [specs.percentage] : null),
    quantity: specs.quantity || null,
    color: specs.color || null,
    zipCode: convo?.zipCode || null
  };
}

/**
 * Determine what's missing and what stage we should be in
 */
function determineStage(state) {
  if (!state.rolloType) return STAGES.AWAITING_TYPE;
  if (!state.width) return STAGES.AWAITING_WIDTH;
  const typeInfo = TYPE_DISPLAY[state.rolloType];
  if (typeInfo?.hasPercentage && !state.percentage) return STAGES.AWAITING_PERCENTAGE;
  if (!state.quantity) return STAGES.AWAITING_QUANTITY;
  if (!state.zipCode) return STAGES.AWAITING_ZIP;
  return STAGES.COMPLETE;
}

/**
 * Handle rollo flow
 */
async function handle(classification, sourceContext, convo, psid, campaign = null, userMessage = '') {
  const { intent, entities } = classification;

  // ====== PENDING ZIP CODE RESPONSE ======
  if (convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('../utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) return pendingResult;
  }

  // ====== PURCHASE PROCESS QUESTION ======
  // "¿Cómo realizo una compra?", "¿Cómo compro?" — rollos are direct sale, not ML
  if (userMessage && /\b(c[oó]mo\s+(realiz[oa]|hago|hacer|compro|pido|ordeno|le\s+hago|puedo\s+comprar)|d[oó]nde\s+(compro|pido|ordeno|puedo\s+comprar)|proceso\s+de\s+compra|pasos?\s+(para|de)\s+compra)/i.test(userMessage)) {
    await updateConversation(psid, { lastIntent: 'purchase_process', unknownCount: 0 });
    return {
      type: "text",
      text: "La compra es directa con nosotros (no por Mercado Libre). Para cotizarte necesito el ancho del rollo y tu código postal. ¿Qué medida te interesa?"
    };
  }

  // ====== COMMON HANDLERS (inherited from master flow) ======
  const commonResponse = await checkCommonHandlers(userMessage, convo, psid, {
    flowType: 'rollo',
    salesChannel: 'direct',
    productName: 'rollo de malla sombra',
    installationNote: null
  });
  if (commonResponse) return commonResponse;

  let state = getFlowState(convo);

  // FIRST: Detect or confirm rollo type (before normalizing width, so we query the right type)
  if (!state.rolloType) {
    const detectedType = detectRolloType(userMessage, convo);
    if (detectedType) {
      console.log(`📦 Rollo flow - Detected type: ${detectedType}`);
      state.rolloType = detectedType;
    }
  }

  // Normalize width if set (may have been set by specExtractor without DB-aware normalization)
  if (state.width) {
    const normalizedWidth = await normalizeWidth(state.width, state.rolloType);
    if (normalizedWidth && normalizedWidth !== state.width) {
      console.log(`📦 Rollo flow - Normalizing stale width: ${state.width} → ${normalizedWidth}m`);
      state.width = normalizedWidth;
    } else if (!normalizedWidth) {
      console.log(`📦 Rollo flow - Width ${state.width}m not valid, clearing`);
      state.width = null;
    }
  }

  console.log(`📦 Rollo flow - Current state:`, state);
  console.log(`📦 Rollo flow - Intent: ${intent}, Entities:`, entities);

  // DIMENSION SHAPE CHECK — if user gives 2D dimensions both ≤10m (e.g. "3x5"),
  // that suggests confeccionada, not rollo. Ask for clarification.
  if (userMessage && !state.width) {
    const dimShape = classifyDimensionShape(userMessage);
    if (dimShape === 'confeccionada') {
      console.log(`📦 Rollo flow - Dimension shape "${userMessage.slice(0, 40)}" suggests confeccionada, asking disambiguation`);
      return {
        type: "text",
        text: "Esa medida suena a malla sombra confeccionada (cortada a la medida), no a rollo. ¿Estás buscando malla confeccionada o rollo?"
      };
    }
  }

  // SECOND: Extract width — classifier entities first, regex fallback
  if (!state.width && entities.width) {
    const normalized = await normalizeWidth(entities.width, state.rolloType);
    if (normalized) {
      state.width = normalized;
      console.log(`📦 Rollo flow - Using classifier entity: ${entities.width} → ${normalized}m`);
    }
  }
  // Regex fallback: parse width from user message
  // Patterns: "de 4 mts", "4 metros", "4.20", "el de 4", "2.10m", "2 metros"
  if (!state.width && userMessage) {
    // Guard: if message contains NxM where neither side is ~100, skip width extraction
    // These dimensions belong to a different product (e.g., 11x5 = confeccionada)
    const fullDimCheck = userMessage.match(/\b(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)\b/);
    const hasNonRollDimensions = fullDimCheck &&
      parseFloat(fullDimCheck[1].replace(',', '.')) !== 100 &&
      parseFloat(fullDimCheck[2].replace(',', '.')) !== 100;

    if (hasNonRollDimensions) {
      console.log(`📦 Rollo flow - Dimensions ${fullDimCheck[1]}x${fullDimCheck[2]} don't match roll pattern, skipping width extraction`);
    } else {
      const widthPatterns = [
        /\b(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:m(?:ts?|etros?)?)\b/i,              // "de 4 mts", "4 metros", "4.20m"
        /\b(?:el\s+)?(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:ancho)?\b(?!\s*(?:rollos?|pzas?|piezas?|unidades?))/i,  // "el de 4", "4 ancho" — NOT "1 rollo"
        /\b(\d+(?:[.,]\d+)?)\s*[xX×]\s*100\b/i                                  // "4x100", "4.20x100"
      ];

      for (const pattern of widthPatterns) {
        const match = userMessage.match(pattern);
        if (match) {
          const parsedWidth = parseFloat(match[1].replace(',', '.'));
          const normalized = await normalizeWidth(parsedWidth, state.rolloType);
          if (normalized) {
            console.log(`📦 Rollo flow - Parsed width from message: ${parsedWidth} → ${normalized}m`);
            state.width = normalized;
            break;
          }
        }
      }
    }
  }

  // Extract percentage(s) — supports single ("del 90") and multiple ("70% y 90%")
  // state.percentage = primary (first) percentage, state.percentages = array of all requested
  if (!state.percentage && entities.percentage) {
    state.percentage = entities.percentage;
    state.percentages = [entities.percentage];
    console.log(`📦 Rollo flow - Using classifier entity percentage: ${entities.percentage}%`);
  }
  // Regex fallback: parse percentage(s) from user message
  if (!state.percentage && userMessage) {
    const parsedPcts = [];

    // Extract ALL numbers that look like percentages from the message
    // "70% y 90%", "del 70 al 90", "70, 80 y 90", "de 70 a 90%"
    const allNumbers = [...userMessage.matchAll(/\b(\d{2,3})\s*(%|porciento|por\s*ciento)?\b/gi)];
    for (const m of allNumbers) {
      const pct = parseInt(m[1]);
      if (VALID_PERCENTAGES.includes(pct) && !parsedPcts.includes(pct)) {
        parsedPcts.push(pct);
      }
    }

    // Also try "del/al X" patterns without % suffix
    const delMatches = [...userMessage.matchAll(/\b(?:del|al)\s+(\d{2,3})\b/gi)];
    for (const m of delMatches) {
      const pct = parseInt(m[1]);
      if (VALID_PERCENTAGES.includes(pct) && !parsedPcts.includes(pct)) {
        parsedPcts.push(pct);
      }
    }

    if (parsedPcts.length > 0) {
      parsedPcts.sort((a, b) => a - b);
      state.percentage = parsedPcts[0];
      state.percentages = parsedPcts;
      console.log(`📦 Rollo flow - Parsed percentage(s): ${parsedPcts.map(p => p + '%').join(', ')}`);
    }

    // When awaiting percentage, accept bare numbers (e.g., "50", "35", "90")
    if (!state.percentage && convo?.lastIntent === 'roll_awaiting_percentage') {
      const bareMatch = userMessage.trim().match(/^(\d{2,3})$/);
      if (bareMatch) {
        const pct = parseInt(bareMatch[1]);
        if (pct >= 10 && pct <= 100) {
          console.log(`📦 Rollo flow - Bare number accepted as percentage (awaiting): ${pct}%`);
          state.percentage = pct;
          state.percentages = [pct];
        }
      }
    }

    // Try natural language descriptions
    if (!state.percentage) {
      // "menos sombra", "mas delgado", "menor", "poca sombra" → 35%
      if (/\b(menos\s*sombra|menor\s*sombra|poca\s*sombra|m[aá]s\s*delgad[oa]|delgad[oa]|m[aá]s\s*fin[oa]|fin[oa])\b/i.test(userMessage)) {
        console.log(`📦 Rollo flow - Natural language "menos sombra/delgado" → 35%`);
        state.percentage = 35;
        state.percentages = [35];
      }
      // "mas sombra", "mas grueso", "mayor", "mucha sombra" → 90%
      else if (/\b(m[aá]s\s*sombra|mayor\s*sombra|mucha\s*sombra|m[aá]s\s*grues[oa]|grues[oa]|m[aá]s\s*denso|denso)\b/i.test(userMessage)) {
        console.log(`📦 Rollo flow - Natural language "mas sombra/grueso" → 90%`);
        state.percentage = 90;
        state.percentages = [90];
      }
    }
  }

  // Parse quantity from user message
  // Only parse quantity when we're EXPLICITLY in the awaiting_quantity stage,
  // or when the message has clear quantity language (e.g. "5 rollos").
  // This prevents "un" (Spanish article) from being parsed as quantity=1.
  const isAwaitingQuantity = convo?.lastIntent === 'roll_awaiting_quantity';
  if (!state.quantity && userMessage) {
    // Strip dimensions, percentages, and width measurements to avoid false positives
    // e.g. "Precio de 4 x 100 al 30%" → "Precio de   al "
    const qtyMsg = userMessage.toLowerCase()
      .replace(/\b\d+(?:[.,]\d+)?\s*[xX×*]\s*\d+\b/g, '')       // Remove NxN dimensions
      .replace(/\b\d{2,3}\s*(%|porciento|por\s*ciento)\b/gi, '') // Remove percentages
      .replace(/\b(?:de\s+)?\d+(?:[.,]\d+)?\s*(?:m(?:ts?|etros?)?)\b/gi, ''); // Remove "de 4 mts"

    // "un par" = 2
    if (/\b(un\s*par|par\s+de)\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "un par" → 2`);
      state.quantity = 2;
    }
    // "uno/una" + explicit unit word: "un rollo", "una pieza" (NOT bare "un" as article)
    else if (/\b(un[oa]?)\s+(rollos?|pzas?|piezas?|unidad(?:es)?)\b/i.test(qtyMsg) || /\bocupar[ií]a\s+un[oa]?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "uno + unit" → 1`);
      state.quantity = 1;
    }
    // "dos", "2" + optional unit
    else if (/\b(dos|2)\s*(rollos?|pzas?|piezas?)?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "dos" → 2`);
      state.quantity = 2;
    }
    // "tres", "3" + optional unit
    else if (/\b(tres|3)\s*(rollos?|pzas?|piezas?)?\b/i.test(qtyMsg)) {
      console.log(`📦 Rollo flow - Parsed quantity "tres" → 3`);
      state.quantity = 3;
    }
    // Generic number only if explicitly followed by "rollos/pzas/piezas"
    else {
      const qtyMatch = qtyMsg.match(/\b(\d+)\s+(rollos?|pzas?|piezas?)\b/i);
      if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        if (qty > 0 && qty <= 100) {
          console.log(`📦 Rollo flow - Parsed quantity → ${qty}`);
          state.quantity = qty;
        }
      }
    }

    // When in AWAITING_QUANTITY stage, also accept bare numbers and "1"/"uno" without unit
    if (!state.quantity && isAwaitingQuantity) {
      if (/\b(un[oa]?|1)\b/i.test(qtyMsg)) {
        console.log(`📦 Rollo flow - Awaiting quantity, bare "uno/1" → 1`);
        state.quantity = 1;
      } else {
        const bareMatch = qtyMsg.trim().match(/^(\d+)$/);
        if (bareMatch) {
          const qty = parseInt(bareMatch[1]);
          if (qty > 0 && qty <= 100) {
            console.log(`📦 Rollo flow - Awaiting quantity, bare number → ${qty}`);
            state.quantity = qty;
          }
        }
      }
    }
  }

  if (!state.quantity && entities.quantity) {
    state.quantity = entities.quantity;
  }
  if (entities.color) {
    state.color = entities.color;
  }
  if (entities.zipCode) {
    state.zipCode = entities.zipCode;
  }
  // Also check if zip was already in convo
  if (!state.zipCode && convo?.zipCode) {
    state.zipCode = convo.zipCode;
  }
  // Try to parse zip from user message if we're expecting it
  if (!state.zipCode && userMessage) {
    const zipInfo = await parseAndLookupZipCode(userMessage);
    if (zipInfo) {
      state.zipCode = zipInfo.code;
      state.zipInfo = zipInfo; // Store full info for response
    }
  }

  let response;

  // ====== AD PRODUCTS — show all options with prices when asked ======
  const adProductIds = sourceContext?.ad?.productIds || convo?.adProductIds;
  if (adProductIds?.length && !state.width) {
    const askingOptions = [INTENTS.CATALOG_REQUEST, INTENTS.PRODUCT_INQUIRY, INTENTS.AVAILABILITY_QUERY, INTENTS.PRICE_QUERY].includes(intent);
    if (askingOptions) {
      try {
        const adProducts = await ProductFamily.find({
          _id: { $in: adProductIds },
          sellable: true,
          active: true
        }).sort({ price: 1 }).lean();

        if (adProducts.length > 0) {
          const lines = adProducts.map(p => {
            const price = p.price ? ` - ${formatMoney(p.price)}` : '';
            const size = p.size ? ` ${p.size}` : '';
            return `• ${p.name}${size}${price}`;
          });

          const adInterest = state.rolloType === ROLLO_TYPES.GROUNDCOVER ? 'groundcover'
            : state.rolloType === ROLLO_TYPES.MONOFILAMENTO ? 'monofilamento' : 'rollo';
          await updateConversation(psid, {
            lastIntent: `roll_awaiting_width`,
            currentFlow: "rollo",
            productInterest: adInterest,
            productSpecs: {
              productType: "rollo",
              rolloType: state.rolloType,
              width: state.width,
              length: 100,
              percentage: state.percentage,
              updatedAt: new Date()
            }
          });

          return {
            type: "text",
            text: `¡Claro! Estas son las opciones que manejamos:\n\n${lines.join('\n')}\n\n¿Cuál te interesa?`
          };
        }
      } catch (err) {
        console.error("Error fetching ad products:", err.message);
      }
    }
  }

  // ====== CATALOG / INFO / PRICE REQUESTS — show available sizes regardless of stage ======
  const infoIntents = [INTENTS.CATALOG_REQUEST, INTENTS.PRODUCT_INQUIRY, INTENTS.AVAILABILITY_QUERY, INTENTS.PRICE_QUERY];
  if (infoIntents.includes(intent) && !state.width) {
    response = await handleStart(sourceContext, state);

    const catInterest = state.rolloType === ROLLO_TYPES.GROUNDCOVER ? 'groundcover'
      : state.rolloType === ROLLO_TYPES.MONOFILAMENTO ? 'monofilamento' : 'rollo';
    await updateConversation(psid, {
      lastIntent: `roll_start`,
      currentFlow: "rollo",
      productInterest: catInterest,
      productSpecs: {
        productType: "rollo",
        rolloType: state.rolloType,
        width: state.width,
        length: 100,
        percentage: state.percentage,
        quantity: state.quantity,
        updatedAt: new Date()
      }
    });

    return response;
  }
  // ====== END CATALOG / INFO REQUESTS ======

  // ====== RESELLER/DISTRIBUTOR INTENT: let dispatcher handle it (sends catalog + handoff) ======
  if (userMessage && /\b(distribui[rd]|revend|quiero\s+vender|ser\s+distribuid|ampliar\s*(mi\s+)?cat[aá]logo)\b/i.test(userMessage)) {
    console.log(`🏪 Reseller intent detected in rollo flow — deferring to dispatcher`);
    return null;
  }

  // ====== WHOLESALE / BULK DISCOUNT QUESTIONS ======
  // "A partir de cuántos rollos es precio mayorista?", "Precio por mayoreo?", "Descuento por cantidad?"
  if (userMessage && /\b(mayoreo|mayorist|descuento|precio\s*especial|al\s*por\s*mayor|a\s*partir\s*de\s*cu[aá]nt)/i.test(userMessage)) {
    await updateConversation(psid, { lastIntent: 'roll_wholesale_answered', unknownCount: 0 });

    let text = "Sí manejamos precio de mayoreo en rollos. El precio que te cotizamos es directo de fábrica, y para pedidos grandes podemos mejorar el precio.";

    // If we have specs, reference them
    if (state.width && state.percentage) {
      text += `\n\nPara cotizarte el rollo de ${state.width}m x 100m al ${state.percentage}%, indícanos la cantidad y tu código postal.`;
    } else {
      text += "\n\nPara cotizarte necesitamos la medida (ancho), porcentaje de sombra, cantidad y tu código postal.";
    }

    return { type: "text", text };
  }
  // ====== END WHOLESALE QUESTIONS ======

  const stage = determineStage(state);

  // ====== AD ENTRY CONFIRMATION: customer clicked ad, says "me interesa" / "sí" ======
  // Look up the ad's main product and show price, then ask for zip code.
  // Exclude info requests ("quiero más información") — those should get product description, not a blind quote.
  if (convo?.adId && !convo?.lastQuotedProducts?.length && userMessage) {
    const isInfoRequest = /\b(informaci[oó]n|info|saber\s+m[aá]s|conocer|detalles)\b/i.test(userMessage);
    const isInterest = !isInfoRequest && /\b(quiero|lo\s*quiero|la\s*quiero|me\s*interesa|s[ií]|ok|dale|va|esa|eso|mand[ae]|compro|claro|perfecto|[oó]rale|sim[oó]n)\b/i.test(userMessage);
    if (isInterest && (convo?.lastIntent === 'ad_entry' || convo?.lastIntent === 'greeting' || convo?.lastIntent === 'roll_start')) {
      try {
        const { resolveByAdId } = require("../../utils/campaignResolver");
        const resolved = await resolveByAdId(convo.adId);
        const mainProductId = resolved?.mainProductId || resolved?.productIds?.[0];
        if (mainProductId) {
          const product = await ProductFamily.findById(mainProductId).lean();
          if (product && product.price) {
            console.log(`🎯 Rollo ad confirmation → "${product.name}" at $${product.price}`);
            // Parse product name for width/percentage to set flow state
            const widthMatch = product.name.match(/(\d+(?:\.\d+)?)\s*(?:m|mt|mts|metros?)/i);
            const pctMatch = product.name.match(/(\d{2,3})\s*%/);
            const updates = {
              lastIntent: 'roll_awaiting_zipcode',
              unknownCount: 0,
              productSpecs: {
                ...convo?.productSpecs,
                productType: 'rollo',
                quantity: 1,
                updatedAt: new Date()
              }
            };
            if (widthMatch) updates.productSpecs.width = parseFloat(widthMatch[1]);
            if (pctMatch) updates.productSpecs.percentage = parseInt(pctMatch[1]);
            await updateConversation(psid, updates);
            return {
              type: "text",
              text: `¡Con gusto! El ${product.name} tiene un precio de ${formatMoney(product.price)}. La compra es directa con nosotros.\n\n¿Me compartes tu código postal para cotizarte el envío?`
            };
          }
        }
      } catch (err) {
        console.error('❌ Error looking up rollo ad product:', err.message);
      }
    }
  }

  // ====== CONFIRMATION SHORTCUT: "si", "xfavor", "ok", "dale", "va", "por favor" ======
  let confirmationHandled = false;
  if (convo?.lastQuotedProducts?.length > 0 && userMessage) {
    const isConfirmation = /^\s*(s[ií]|ok|dale|va|xfavor|por\s*favor|x\s*favor|claro|sale|órale|orale|sim[oó]n|ándale|andale|está bien|esta bien)\s*[.!]?\s*$/i.test(userMessage);
    if (isConfirmation) {
      console.log(`📦 Rollo flow - Confirmation detected: "${userMessage}", advancing flow`);
      // Default quantity to 1 if we have width+percentage but no quantity
      if (!state.quantity) state.quantity = 1;
      // Clear quoted products so stage handler runs cleanly
      await updateConversation(psid, { lastQuotedProducts: null, unknownCount: 0 });
      confirmationHandled = true;
      // Fall through to stage handler below (don't enter AI fallback)
    }
  }

  // Trust, pay-on-delivery, phone, location, farewell — handled by commonHandlers (master flow)

  // ====== AI ESCALATION: when regex couldn't parse the message ======
  if (!confirmationHandled && userMessage) {
    const aiResult = await escalateToAI(userMessage, convo);

    if (aiResult?.handoff) {
      const { executeHandoff } = require('../utils/executeHandoff');
      return await executeHandoff(psid, convo, userMessage, {
        reason: `Cliente en flujo rollo pidió hablar con especialista: "${userMessage.substring(0, 80)}"`,
        responsePrefix: 'Con gusto te comunico con un especialista.',
        lastIntent: 'human_escalation',
        timingStyle: 'elaborate'
      });
    } else if (aiResult?.width) {
      console.log(`🔄 Rollo AI escalation parsed width: ${aiResult.width}m`);
      state.width = aiResult.width;
      // Fall through to stage handler which will ask for percentage/quantity/zip
    } else if (aiResult?.percentage) {
      console.log(`🔄 Rollo AI escalation parsed percentage: ${aiResult.percentage}%`);
      state.percentage = aiResult.percentage;
      // Fall through to stage handler
    } else if (aiResult?.response) {
      await updateConversation(psid, { lastIntent: 'roll_ai_answered', unknownCount: 0 });
      return { type: "text", text: aiResult.response };
    }
  }

  switch (stage) {
    case STAGES.AWAITING_TYPE:
      response = handleAwaitingType(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_WIDTH:
      response = await handleAwaitingWidth(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_PERCENTAGE:
      response = await handleAwaitingPercentage(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_QUANTITY:
      response = await handleAwaitingQuantity(intent, state, sourceContext);
      break;

    case STAGES.AWAITING_ZIP:
      response = await handleAwaitingZip(intent, state, sourceContext, psid, convo);
      break;

    case STAGES.COMPLETE:
      response = await handleComplete(intent, state, sourceContext, psid, convo, userMessage);
      break;

    default:
      response = await handleStart(sourceContext, state);
  }

  // Save updated specs
  // productInterest preserves original type for analytics (groundcover, monofilamento, or rollo)
  const analyticsInterest = state.rolloType === ROLLO_TYPES.GROUNDCOVER ? 'groundcover'
    : state.rolloType === ROLLO_TYPES.MONOFILAMENTO ? 'monofilamento'
    : 'rollo';
  const updateData = {
    lastIntent: `roll_${stage}`,
    currentFlow: "rollo",
    productInterest: analyticsInterest,
    productSpecs: {
      productType: "rollo",
      rolloType: state.rolloType,
      width: state.width,
      length: 100,
      percentage: state.percentage,
      percentages: state.percentages || (state.percentage ? [state.percentage] : []),
      quantity: state.quantity,
      color: state.color,
      updatedAt: new Date()
    }
  };

  // Save zip code at conversation level (not just in specs)
  if (state.zipCode) {
    updateData.zipCode = state.zipCode;
  }
  if (state.zipInfo) {
    updateData.city = state.zipInfo.city;
    updateData.stateMx = state.zipInfo.state;
  }
  // Save quoted products if any were generated during this turn
  if (state._lastQuotedProducts) {
    updateData.lastQuotedProducts = state._lastQuotedProducts;
  }

  await updateConversation(psid, updateData);

  return response;
}

/**
 * Handle awaiting type - ask what kind of rollo they need
 */
function handleAwaitingType(intent, state, sourceContext) {
  return {
    type: "text",
    text: "¿Para qué lo necesitas?\n\n" +
          "• Para dar **sombra** (malla sombra raschel)\n" +
          "• Para cubrir el **suelo** (groundcover/antimaleza)"
  };
}

/**
 * Build full rollo catalog grouped by width with prices per percentage.
 * Optionally filter to a single width. Adapts to rollo type.
 */
async function buildRolloCatalog(rolloType = ROLLO_TYPES.MALLA_SOMBRA, filterWidth = null) {
  const widths = await getAvailableWidths(rolloType);
  const typeFilter = buildTypeFilter(rolloType);
  const query = { sellable: true, active: true, ...typeFilter };
  const products = await ProductFamily.find(query)
    .select('name price size').sort({ price: 1 }).lean();

  if (products.length === 0) return null;

  const hasPercentage = TYPE_DISPLAY[rolloType]?.hasPercentage;
  const targetWidths = filterWidth ? [filterWidth] : widths;
  const sections = [];

  for (const w of targetWidths) {
    const sizeRegex = new RegExp(`${w}`, 'i');
    const widthProducts = products.filter(p => sizeRegex.test(p.size || ''));

    if (hasPercentage) {
      // Show percentage breakdown (malla sombra, monofilamento)
      const lines = [];
      for (const p of widthProducts) {
        const pctMatch = (p.name || '').match(/(\d+)\s*%/);
        if (pctMatch && p.price) {
          lines.push(`  • ${pctMatch[1]}% — ${formatMoney(p.price)}`);
        }
      }
      if (lines.length > 0) {
        sections.push(`📦 ${w}m x 100m:\n${lines.join('\n')}`);
      }
    } else {
      // No percentage (groundcover) — show single price per width
      const p = widthProducts.find(pr => pr.price);
      if (p) {
        sections.push(`• ${w}m x 100m — ${formatMoney(p.price)}`);
      } else if (widthProducts.length > 0) {
        sections.push(`• ${w}m x 100m`);
      }
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

/**
 * Handle start - user just mentioned rolls (type already known)
 * Always shows full catalog of available sizes with prices.
 */
async function handleStart(sourceContext, state = {}) {
  const rolloType = state.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
  const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;

  try {
    // If percentage already known, show prices for that percentage across widths
    if (state.percentage && typeInfo.hasPercentage) {
      const widths = await getAvailableWidths(rolloType);
      const lines = [];
      for (const w of widths) {
        const products = await findMatchingProducts(w, state.percentage, rolloType);
        if (products.length > 0 && products[0].price) {
          lines.push(`• ${w}m x 100m al ${state.percentage}% — ${formatMoney(products[0].price)}`);
        }
      }
      if (lines.length > 0) {
        return {
          type: "text",
          text: `Rollos de ${typeInfo.name} al ${state.percentage}%:\n\n${lines.join('\n')}\n\n¿Cuál te interesa?`
        };
      }
    }

    // Show full catalog
    const catalog = await buildRolloCatalog(rolloType);
    if (catalog) {
      // Groundcover gets a tagline
      const tagline = rolloType === ROLLO_TYPES.GROUNDCOVER
        ? 'Ideal para control de hierbas en cultivos y jardines.\n\n'
        : '';
      return {
        type: "text",
        text: `¡Sí manejamos ${typeInfo.name}!\n\n${tagline}Rollos disponibles:\n\n${catalog}\n\n¿Cuál te interesa?`
      };
    }
  } catch (err) {
    console.error("Error building rollo catalog:", err.message);
  }

  // Fallback without prices — still use DB data
  const widths = await getAvailableWidths(rolloType);
  const widthBullets = widths.map(w => `• ${w}m x 100m`).join('\n');
  if (typeInfo.hasPercentage) {
    const percentages = await getAvailablePercentages(rolloType);
    const pctBullets = percentages.map(p => `• ${p}%`).join('\n');
    return {
      type: "text",
      text: `Manejamos rollos de ${typeInfo.name} en los siguientes anchos:\n\n${widthBullets}\n\nPorcentajes de sombra:\n${pctBullets}\n\n¿Cuál te interesa?`
    };
  }
  return {
    type: "text",
    text: `Manejamos rollos de ${typeInfo.name} en:\n\n${widthBullets}\n\n¿Cuál te interesa?`
  };
}

/**
 * Handle awaiting width stage — show full catalog so customer can pick
 */
async function handleAwaitingWidth(intent, state, sourceContext) {
  const rolloType = state.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
  const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;

  try {
    const catalog = await buildRolloCatalog(rolloType);
    if (catalog) {
      return {
        type: "text",
        text: `Rollos de ${typeInfo.name} disponibles:\n\n${catalog}\n\n¿Cuál te interesa?`
      };
    }
  } catch (err) {
    console.error("Error building rollo catalog:", err.message);
  }

  const widths = await getAvailableWidths(rolloType);
  const widthBullets = widths.map(w => `• ${w}m x 100m`).join('\n');
  if (typeInfo.hasPercentage) {
    const percentages = await getAvailablePercentages(rolloType);
    const pctBullets = percentages.map(p => `• ${p}%`).join('\n');
    return {
      type: "text",
      text: `Manejamos rollos de ${typeInfo.name} en los siguientes anchos:\n\n${widthBullets}\n\nPorcentajes de sombra:\n${pctBullets}\n\n¿Cuál te interesa?`
    };
  }
  return {
    type: "text",
    text: `Manejamos rollos de ${typeInfo.name} en:\n\n${widthBullets}\n\n¿Cuál te interesa?`
  };
}

/**
 * Handle awaiting percentage stage — show all percentages for the selected width
 */
async function handleAwaitingPercentage(intent, state, sourceContext) {
  const rolloType = state.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
  const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;

  const sizeDisplay = `${state.width}m x 100m`;

  try {
    const catalog = await buildRolloCatalog(rolloType, state.width);
    if (catalog) {
      return {
        type: "text",
        text: `Para el rollo de ${sizeDisplay} te ofrecemos diferentes porcentajes de sombra:\n\n${catalog}\n\n¿Qué porcentaje(s) necesitas?`
      };
    }
  } catch (err) {
    console.error("Error building rollo catalog:", err.message);
  }

  const percentages = await getAvailablePercentages(rolloType, state.width);
  const pctList = percentages.map(p => `${p}%`).join(', ');
  return {
    type: "text",
    text: `Para el rollo de ${sizeDisplay} te ofrecemos diferentes porcentajes de sombra: ${pctList}.\n\n¿Qué porcentaje(s) necesitas?`
  };
}

/**
 * Handle awaiting quantity stage - show price + ask how many rolls
 * Supports multiple percentages: shows price for each and asks quantities per percentage
 */
async function handleAwaitingQuantity(intent, state, sourceContext) {
  const rolloType = state.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
  const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;

  // If we already have the zip, only ask for quantity (not both)
  const hasZip = !!state.zipCode;
  const pcts = state.percentages || (state.percentage ? [state.percentage] : []);

  // Multiple percentages — show price breakdown and ask for quantities per percentage
  if (pcts.length > 1) {
    const lines = [];
    for (const pct of pcts) {
      const products = await findMatchingProducts(state.width, pct, rolloType);
      if (products.length > 0 && products[0].price) {
        lines.push(`• ${pct}% — ${formatMoney(products[0].price)} + IVA`);
      } else {
        lines.push(`• ${pct}%`);
      }
    }

    const askSuffix = hasZip
      ? `\n\n¿Cuántos rollos necesitas de cada uno?`
      : `\n\n📍 Estamos en Querétaro, pero realizamos envíos a toda la República. 📦✈️\n\nPara cotizarte por favor indícanos cuántos rollos de cada porcentaje y tu código postal.`;

    return {
      type: "text",
      text: `Rollo de ${state.width}m x 100m:\n\n${lines.join('\n')}${askSuffix}`
    };
  }

  // Single percentage
  const askSuffix = hasZip
    ? `\n\n¿Cuántos rollos necesitas?`
    : `\n\n📍 Estamos en Querétaro, pero realizamos envíos a toda la República. 📦✈️\n\nPara cotizarte por favor indícanos cuántas unidades y tu código postal para calcular el envío.`;

  // Look up product to build description dynamically
  const products = await findMatchingProducts(state.width, state.percentage, rolloType);
  if (products.length > 0) {
    const product = products[0];

    // Build description from product lineage (root → leaf)
    const specsDesc = await buildProductDescription(product, state);

    if (product.price) {
      let priceMsg = `El precio de promoción es de ${formatMoney(product.price)} + IVA por ${specsDesc}.`;
      priceMsg += askSuffix;

      return { type: "text", text: priceMsg };
    }

    return {
      type: "text",
      text: `Tenemos ${specsDesc}.${askSuffix}`
    };
  }

  // Fallback when no product found in DB
  let fallbackDesc = `un rollo de ${typeInfo.name}`;
  if (state.percentage) fallbackDesc += ` al ${state.percentage}%`;
  fallbackDesc += ` de ${state.width}m x 100m`;

  return {
    type: "text",
    text: `Tenemos ${fallbackDesc}.${askSuffix}`
  };
}

/**
 * Handle awaiting zip code stage — ask for zip to quote shipping (direct sale)
 */
async function handleAwaitingZip(intent, state, sourceContext, psid, convo) {
  return {
    type: "text",
    text: `¿Me puedes proporcionar tu código postal para calcular el envío?`
  };
}

/**
 * Handle complete - we have all specs + zip, hand off to human
 */
async function handleComplete(intent, state, sourceContext, psid, convo, userMessage = '') {
  const rolloType = state.rolloType || ROLLO_TYPES.MALLA_SOMBRA;
  const typeInfo = TYPE_DISPLAY[rolloType] || TYPE_DISPLAY.malla_sombra;
  const locationText = state.zipInfo
    ? `${state.zipInfo.city}, ${state.zipInfo.state}`
    : (state.zipCode || 'ubicación no especificada');

  // Build specs summary for handoff
  let specsText = `rollo de ${typeInfo.name} de ${state.width}m x 100m`;
  const pcts = state.percentages || (state.percentage ? [state.percentage] : []);
  if (pcts.length > 1) {
    specsText += ` al ${pcts.map(p => p + '%').join(' y ')}`;
  } else if (pcts.length === 1) {
    specsText += ` al ${pcts[0]}%`;
  }

  const handoffLabel = typeInfo.short.charAt(0).toUpperCase() + typeInfo.short.slice(1);
  const qtyText = state.quantity > 1 ? `${state.quantity} rollos de ` : '';
  const handoffReason = `${handoffLabel}: ${qtyText}${specsText} - ${locationText}`;

  // Save wholesale info if applicable
  const products = await findMatchingProducts(state.width, state.percentage, rolloType);
  const product = products[0];
  const extraState = {};
  if (product?.wholesaleEnabled && product?.wholesaleMinQty && state.quantity >= product.wholesaleMinQty) {
    extraState.wholesaleRequest = {
      productId: product._id,
      productName: product.name,
      quantity: state.quantity,
      retailPrice: product.price
    };
  }

  // Build transparent response — don't mention handoff to human
  let responsePrefix = `¡Perfecto! En breve te tenemos la cotización para ${qtyText}${specsText}.`;
  if (state.zipInfo) {
    responsePrefix += `\n\n📍 Envío a ${state.zipInfo.city}, ${state.zipInfo.state}`;
  }

  const { executeHandoff } = require('../utils/executeHandoff');
  return await executeHandoff(psid, convo, userMessage, {
    reason: handoffReason,
    responsePrefix,
    skipChecklist: true,
    timingStyle: 'none',
    extraState: Object.keys(extraState).length > 0 ? extraState : null,
    includeQueretaro: true,
    includeVideo: rolloType === ROLLO_TYPES.MALLA_SOMBRA
  });
}

/**
 * Check if this flow should handle the message
 * Handles rollo, groundcover, and monofilamento products
 */
function shouldHandle(classification, sourceContext, convo) {
  const { product } = classification;

  // If conversation is locked into a different product flow, don't claim the message.
  // The flow manager handles switching — shouldHandle should respect the lock.
  const currentFlow = convo?.currentFlow;
  if (currentFlow && currentFlow !== 'default' &&
      currentFlow !== 'rollo' && currentFlow !== 'groundcover' && currentFlow !== 'monofilamento') {
    return false;
  }

  // Rollo signals
  if (product === "rollo") return true;
  if (convo?.productSpecs?.productType === "rollo") return true;
  if (convo?.lastIntent?.startsWith("roll_")) return true;
  if (sourceContext?.ad?.product === "rollo") return true;

  // Groundcover signals
  if (product === "groundcover") return true;
  if (convo?.productSpecs?.productType === "groundcover") return true;
  if (convo?.productInterest === "groundcover") return true;
  if (convo?.lastIntent?.startsWith("groundcover_")) return true;
  if (sourceContext?.ad?.product === "groundcover") return true;

  // Monofilamento signals
  if (product === "monofilamento") return true;
  if (convo?.productSpecs?.productType === "monofilamento") return true;
  if (convo?.productInterest === "monofilamento") return true;
  if (convo?.lastIntent?.startsWith("monofilamento_")) return true;
  if (sourceContext?.ad?.product === "monofilamento") return true;

  return false;
}

module.exports = {
  handle,
  handleStart,
  shouldHandle,
  STAGES,
  getFlowState,
  determineStage
};
