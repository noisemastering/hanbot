// ai/assetManager.js
// Context-aware company asset manager
// Intelligently selects which company features to mention based on conversation flow

/**
 * Company assets with their contexts and variations
 * Each asset defines:
 * - variations: Different ways to phrase the asset (natural language)
 * - triggers: Keywords/patterns that make this asset relevant
 * - intents: Conversation intents where this asset is relevant
 * - priority: Base priority (1-10, higher = more important)
 */
const COMPANY_ASSETS = {
  directManufacturer: {
    variations: [
      "Somos fabricantes directos",
      "Al ser fabricantes directos, te garantizamos los mejores precios",
      "Como fabricantes directos, no hay intermediarios",
      "Fabricamos directamente, sin intermediarios"
    ],
    triggers: [
      /\b(precio|costo|caro|barato|descuento|rebaja|económico|ahorro)\b/i,
      /\b(mejor precio|precio competitivo|precio justo)\b/i,
      /\b(por qu[eé]|c[oó]mo|cu[aá]nto)\b/i
    ],
    intents: [
      "specific_measure",
      "generic_measures",
      "bulk_discount_inquiry",
      "price_by_meter",
      "catalog_request"
    ],
    priority: 8,
    maxMentionsPerConvo: 2
  },

  reinforcedQuality: {
    variations: [
      "Nuestra malla es reforzada con argollas y doble costura",
      "Incluye argollas reforzadas y doble costura para mayor resistencia",
      "Viene con argollas y doble costura para instalación profesional",
      "Malla reforzada: argollas metálicas y doble costura"
    ],
    triggers: [
      /\b(calidad|resistencia|duraci[oó]n|fuerte|resistente|dura|aguanta)\b/i,
      /\b(argolla|costura|reforzad[ao]|instalaci[oó]n)\b/i,
      /\b(c[oó]mo|qu[eé] tan|es buena)\b/i,
      /\b(se rompe|se desgarra|se da[ñn]a)\b/i
    ],
    intents: [
      "specific_measure",
      "installation_query",
      "product_lifespan",
      "details_request"
    ],
    priority: 9,
    maxMentionsPerConvo: 2
  },

  uvProtection: {
    variations: [
      "Incluye protección UV para mayor durabilidad",
      "Con protección UV, resiste hasta 10 años a la intemperie",
      "Protección UV que garantiza larga vida útil",
      "Tratamiento UV que la protege del sol y clima"
    ],
    triggers: [
      /\b(duraci[oó]n|vida [uú]til|cu[aá]nto dura|tiempo|resistencia|sol|clima|lluvia|intemperie)\b/i,
      /\b(se decolora|se pone|se degrada|aguanta|resiste)\b/i,
      /\b(garant[ií]a|cu[aá]ntos a[ñn]os)\b/i
    ],
    intents: [
      "product_lifespan",
      "details_request",
      "weed_control_query"
    ],
    priority: 7,
    maxMentionsPerConvo: 1
  },

  nationalShipping: {
    variations: [
      "Enviamos a todo México",
      "Hacemos envíos a todo el país",
      "Llegamos a toda la República Mexicana",
      "Enviamos a cualquier parte de México"
    ],
    triggers: [
      /\b(env[ií]o|entrega|entregan|llega|paquete|domicilio|reparto)\b/i,
      /\b(ciudad|estado|vivo en|estoy en|soy de)\b/i,
      /\b(cu[aá]nto tarda|cuando llega|tiempo de entrega)\b/i,
      /\b(pueden enviar|env[ií]an a|llegue a)\b/i
    ],
    intents: [
      "shipping_info",
      "location_info",
      "city_provided",
      "asking_if_local",
      "delivery_time_payment"
    ],
    priority: 10,
    maxMentionsPerConvo: 2
  },

  paymentOptions: {
    variations: [
      "Aceptamos tarjeta, efectivo y meses sin intereses",
      "Puedes pagar con tarjeta, efectivo o a meses sin intereses",
      "Múltiples formas de pago: tarjeta, efectivo, MSI",
      "Aceptamos todas las formas de pago de Mercado Libre"
    ],
    triggers: [
      /\b(pago|pagar|forma de pago|m[eé]todo de pago|c[oó]mo pago)\b/i,
      /\b(tarjeta|efectivo|meses sin intereses|msi|cr[eé]dito|d[eé]bito)\b/i,
      /\b(cu[aá]ndo pago|anticipo|adelanto)\b/i,
      /\b(acepta|aceptan|puedo pagar)\b/i
    ],
    intents: [
      "delivery_time_payment",
      "purchase_process",
      "alternative_payment"
    ],
    priority: 6,
    maxMentionsPerConvo: 1
  },

  immediateStock: {
    variations: [
      "Tenemos stock disponible para entrega inmediata",
      "Contamos con inventario listo para envío inmediato",
      "Stock disponible, envío el mismo día",
      "Disponibilidad inmediata en la mayoría de medidas"
    ],
    triggers: [
      /\b(cu[aá]ndo|tiempo|tarda|demora|cu[aá]nto tarda|cuando llega)\b/i,
      /\b(disponible|hay|tienen|stock|inventario|existencia)\b/i,
      /\b(r[aá]pido|urgente|pronto|inmediato|ya)\b/i,
      /\b(cu[aá]ndo puedo|cu[aá]ndo me llega)\b/i
    ],
    intents: [
      "delivery_time_payment",
      "specific_measure",
      "generic_measures",
      "shipping_info"
    ],
    priority: 7,
    maxMentionsPerConvo: 1
  }
};

/**
 * Analyze conversation context and select the most relevant asset to mention
 * @param {string} msg - Current user message
 * @param {object} convo - Conversation object with context
 * @param {object} options - Additional options
 * @returns {object|null} - Selected asset object {key, text} or null
 */
function selectRelevantAsset(msg, convo = {}, options = {}) {
  const {
    intent = convo.lastIntent,
    forceAsset = null, // Force a specific asset by key
    excludeAssets = [], // Assets to exclude
    maxAssets = 1 // Maximum number of assets to return
  } = options;

  // If asset is forced, return it
  if (forceAsset && COMPANY_ASSETS[forceAsset]) {
    return {
      key: forceAsset,
      text: getAssetVariation(forceAsset)
    };
  }

  // Track mentions in this conversation to avoid repetition
  const mentionedAssets = convo.mentionedAssets || {};

  // Score each asset based on relevance
  const scores = [];

  for (const [key, asset] of Object.entries(COMPANY_ASSETS)) {
    // Skip if explicitly excluded
    if (excludeAssets.includes(key)) continue;

    // Skip if already mentioned too many times
    const mentionCount = mentionedAssets[key] || 0;
    if (mentionCount >= asset.maxMentionsPerConvo) continue;

    let score = 0;

    // Check intent match
    if (intent && asset.intents.includes(intent)) {
      score += asset.priority * 2; // Intent match is very relevant
    }

    // Check trigger patterns in message
    const triggerMatches = asset.triggers.filter(trigger => trigger.test(msg)).length;
    if (triggerMatches > 0) {
      score += triggerMatches * asset.priority; // Multiple triggers = more relevant
    }

    // Boost score if not mentioned yet in this conversation
    if (mentionCount === 0) {
      score += 3;
    }

    // Only include assets with positive scores
    if (score > 0) {
      scores.push({ key, asset, score });
    }
  }

  // Sort by score (highest first)
  scores.sort((a, b) => b.score - a.score);

  // Return top asset(s)
  if (scores.length === 0) return null;

  if (maxAssets === 1) {
    return {
      key: scores[0].key,
      text: getAssetVariation(scores[0].key)
    };
  } else {
    return scores.slice(0, maxAssets).map(s => ({
      key: s.key,
      text: getAssetVariation(s.key)
    }));
  }
}

/**
 * Get a random variation of an asset for natural language variety
 * @param {string} assetKey - Asset key
 * @returns {string} - Asset text variation
 */
function getAssetVariation(assetKey) {
  const asset = COMPANY_ASSETS[assetKey];
  if (!asset) return null;

  const variations = asset.variations;
  const randomIndex = Math.floor(Math.random() * variations.length);
  return variations[randomIndex];
}

/**
 * Increment the mention count for an asset in the conversation
 * Used to track which assets have been mentioned to avoid repetition
 * @param {string} assetKey - Asset key that was mentioned
 * @param {object} convo - Conversation object
 * @returns {object} - Updated mentionedAssets object
 */
function trackAssetMention(assetKey, convo = {}) {
  const mentionedAssets = convo.mentionedAssets || {};
  mentionedAssets[assetKey] = (mentionedAssets[assetKey] || 0) + 1;
  return mentionedAssets;
}

/**
 * Check if an asset should be mentioned in this context
 * @param {string} assetKey - Asset key to check
 * @param {string} msg - User message
 * @param {object} convo - Conversation object
 * @returns {boolean} - True if asset is relevant and not over-mentioned
 */
function shouldMentionAsset(assetKey, msg, convo = {}) {
  const asset = COMPANY_ASSETS[assetKey];
  if (!asset) return false;

  // Check mention count
  const mentionedAssets = convo.mentionedAssets || {};
  const mentionCount = mentionedAssets[assetKey] || 0;
  if (mentionCount >= asset.maxMentionsPerConvo) return false;

  // Check if any triggers match
  return asset.triggers.some(trigger => trigger.test(msg));
}

/**
 * Intelligently insert an asset mention into response text
 * Adds the asset naturally at the end or in a suitable position
 * @param {string} responseText - Original response text
 * @param {string} assetText - Asset text to insert
 * @returns {string} - Response with asset mention
 */
function insertAssetIntoResponse(responseText, assetText) {
  if (!assetText) return responseText;

  // Remove trailing question if present, add asset, then add question back
  const trailingQuestion = responseText.match(/\n\n¿[^?]+\?$/);

  if (trailingQuestion) {
    const baseResponse = responseText.replace(trailingQuestion[0], '');
    return `${baseResponse}\n\n✨ ${assetText}.${trailingQuestion[0]}`;
  }

  // Otherwise, append at the end
  return `${responseText}\n\n✨ ${assetText}.`;
}

module.exports = {
  selectRelevantAsset,
  getAssetVariation,
  trackAssetMention,
  shouldMentionAsset,
  insertAssetIntoResponse,
  COMPANY_ASSETS
};
