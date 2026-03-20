// ai/utils/purchaseIntentScorer.js
// Purchase intent scoring system - detects how ready a customer is to buy
// Runs as a parallel layer on top of regular intent classification

const PURCHASE_INTENT = {
  HIGH: 'high',     // Ready to buy - has specific dimensions, knows what they want
  MEDIUM: 'medium', // Exploring - general questions, potential buyer
  LOW: 'low'        // Tire-kicker/competitor - too many feature questions, erratic behavior
};

// Default signal state for new conversations
const DEFAULT_SIGNALS = {
  // Positive signals (push toward HIGH)
  hasSpecificDimensions: false,
  hasSpecificLocation: false,
  askedAboutPayment: false,
  askedAboutDelivery: false,
  confirmedSize: false,
  mentionedUrgency: false,

  // Negative signals (push toward LOW) - tracked by count
  materialQuestions: 0,
  techSpecQuestions: 0,
  catalogRequests: 0,
  askingAroundQuestions: 0,
  messagesWithoutProgress: 0,

  // Typing patterns
  erraticTypingCount: 0,

  // Tracking
  totalMessages: 0,
  lastScoreUpdate: null
};

/**
 * Detect positive signals that indicate high purchase intent
 */
function detectPositiveSignals(message, convo) {
  const signals = {};
  const cleanMsg = message.toLowerCase();

  // Specific dimensions (4x5, 6x8, etc.) - strongest signal
  if (/\d+\s*[xX×]\s*\d+/.test(message)) {
    signals.hasSpecificDimensions = true;
  }

  // Specific location mentioned (city, state, zip code)
  if (/\b(cdmx|monterrey|guadalajara|quer[eé]taro|tijuana|puebla|cp\s*\d{5}|\d{5})\b/i.test(cleanMsg)) {
    signals.hasSpecificLocation = true;
  }

  // Payment questions - ready to pay
  if (/\b(c[oó]mo\s+(le\s+)?pago|forma\s+de\s+pago|aceptan\s+tarjeta|puedo\s+pagar|transferencia|efectivo|meses\s+sin\s+intereses)\b/i.test(cleanMsg)) {
    signals.askedAboutPayment = true;
  }

  // Delivery questions with specificity
  if (/\b(env[ií]an?\s+a|llega\s+a|entregan\s+en|cu[aá]nto\s+tarda\s+(en\s+llegar\s+)?a)\b/i.test(cleanMsg)) {
    signals.askedAboutDelivery = true;
  }

  // Confirms recommended size
  if (convo?.recommendedSize && /\b(s[ií]|claro|ok|esa|ese|perfecto|va|dale)\b/i.test(cleanMsg)) {
    signals.confirmedSize = true;
  }

  // Urgency signals
  if (/\b(urgente|lo\s+antes\s+posible|para\s+(hoy|ma[ñn]ana|esta\s+semana)|lo\s+necesito|cu[aá]nto\s+tardan?|r[aá]pido)\b/i.test(cleanMsg)) {
    signals.mentionedUrgency = true;
  }

  return signals;
}

/**
 * Detect negative signals that indicate low purchase intent (tire-kicker/competitor)
 */
function detectNegativeSignals(message, currentSignals) {
  const signals = {};
  const cleanMsg = message.toLowerCase();

  // Material/manufacturing questions
  if (/\b(material|de\s+qu[eé]\s+est[aá]|fabrican?|manufactura|hecho\s+de|hecha\s+de|polietileno|raschel|tejido|hilado)\b/i.test(cleanMsg)) {
    signals.materialQuestions = (currentSignals.materialQuestions || 0) + 1;
  }

  // Technical spec questions
  if (/\b(especificaciones|ficha\s+t[eé]cnica|certificaci[oó]n|norma|resistencia\s+(uv|al\s+sol)|densidad|gramaje|porcentaje\s+exacto)\b/i.test(cleanMsg)) {
    signals.techSpecQuestions = (currentSignals.techSpecQuestions || 0) + 1;
  }

  // "Send me everything" requests - catalog/price list
  if (/\b(cat[aá]logo|lista\s+de\s+precios|todos\s+(los|sus)\s+precios|todas\s+(las|sus)\s+medidas|env[ií][ea]me\s+(todo|sus\s+precios))\b/i.test(cleanMsg)) {
    signals.catalogRequests = (currentSignals.catalogRequests || 0) + 1;
  }

  // "Asking around" questions - indicates shopping around/comparing
  // "¿Dónde están ubicados?", "¿Tienen tienda?", "¿De dónde son?"
  if (/\b((?:d[oó]nde|dnd)\s+(est[aá]n|se\s+ubican|quedan)|tienen\s+tienda|de\s+d[oó]nde\s+son|en\s+qu[eé]\s+(ciudad|parte|estado))\b/i.test(cleanMsg)) {
    signals.askingAroundQuestions = (currentSignals.askingAroundQuestions || 0) + 1;
  }

  return signals;
}

/**
 * Detect erratic typing patterns
 */
function detectErraticTyping(message) {
  // Very short incomplete messages
  const isIncomplete = message.length < 5 && !/^(ok|s[ií]|no|va)$/i.test(message.trim());

  // Too many typos/gibberish (high ratio of uncommon character sequences)
  const gibberishPattern = /[qwrtpsdfghjklzxcvbnm]{4,}|(.)\1{3,}/i;
  const hasGibberish = gibberishPattern.test(message);

  // Random punctuation or symbols
  const randomPunctuation = /[!?]{3,}|\.{4,}|[^\w\s]{3,}/.test(message);

  return isIncomplete || hasGibberish || randomPunctuation;
}

/**
 * Calculate purchase intent score based on signals
 * @param {object} signals - Current signal state
 * @returns {string} - 'high', 'medium', or 'low'
 */
function calculateScore(signals) {
  let score = 50; // Start at medium (0-100 scale)

  // === POSITIVE SIGNALS (add points) ===

  // Specific dimensions is the strongest positive signal (+30)
  if (signals.hasSpecificDimensions) score += 30;

  // Location specificity (+10)
  if (signals.hasSpecificLocation) score += 10;

  // Payment questions - very high intent (+20)
  if (signals.askedAboutPayment) score += 20;

  // Delivery questions (+10)
  if (signals.askedAboutDelivery) score += 10;

  // Confirmed recommended size (+25)
  if (signals.confirmedSize) score += 25;

  // Urgency (+15)
  if (signals.mentionedUrgency) score += 15;

  // === NEGATIVE SIGNALS (subtract points) ===

  // Material questions: 1st OK, 2nd -15, 3rd+ -30
  if (signals.materialQuestions >= 3) {
    score -= 30;
  } else if (signals.materialQuestions === 2) {
    score -= 15;
  }
  // 1st question = no penalty

  // Tech spec questions: same pattern
  if (signals.techSpecQuestions >= 3) {
    score -= 30;
  } else if (signals.techSpecQuestions === 2) {
    score -= 15;
  }

  // Catalog requests: wanting everything is a low signal
  if (signals.catalogRequests >= 2) {
    score -= 25;
  } else if (signals.catalogRequests === 1) {
    score -= 10;
  }

  // "Asking around" questions (where are you located, do you have a store)
  // Indicates shopping around, not ready to buy
  if (signals.askingAroundQuestions >= 2) {
    score -= 20;
  } else if (signals.askingAroundQuestions === 1) {
    score -= 10;
  }

  // Too many messages without progress (5+ without dimensions)
  if (signals.messagesWithoutProgress >= 5 && !signals.hasSpecificDimensions) {
    score -= 20;
  }

  // Erratic typing
  if (signals.erraticTypingCount >= 3) {
    score -= 20;
  } else if (signals.erraticTypingCount >= 2) {
    score -= 10;
  }

  // === CONVERT TO LEVEL ===
  if (score >= 70) return PURCHASE_INTENT.HIGH;
  if (score <= 30) return PURCHASE_INTENT.LOW;
  return PURCHASE_INTENT.MEDIUM;
}

/**
 * Score a message and update conversation signals
 * @param {string} message - User's message
 * @param {object} convo - Conversation state
 * @returns {object} - { intent: 'high'|'medium'|'low', signals: {...}, score: number }
 */
function scorePurchaseIntent(message, convo = {}) {
  // Get existing signals or initialize
  const currentSignals = convo.intentSignals || { ...DEFAULT_SIGNALS };

  // Detect new signals
  const positiveSignals = detectPositiveSignals(message, convo);
  const negativeSignals = detectNegativeSignals(message, currentSignals);
  const isErratic = detectErraticTyping(message);

  // Merge signals
  const updatedSignals = {
    ...currentSignals,
    ...positiveSignals,
    ...negativeSignals,
    totalMessages: (currentSignals.totalMessages || 0) + 1,
    lastScoreUpdate: new Date().toISOString()
  };

  // Track erratic typing
  if (isErratic) {
    updatedSignals.erraticTypingCount = (currentSignals.erraticTypingCount || 0) + 1;
  }

  // Track messages without progress (no dimensions given)
  if (!updatedSignals.hasSpecificDimensions) {
    updatedSignals.messagesWithoutProgress = (currentSignals.messagesWithoutProgress || 0) + 1;
  }

  // Calculate score
  const intent = calculateScore(updatedSignals);

  // Log for debugging
  const intentEmoji = intent === 'high' ? '🟢' : intent === 'medium' ? '🟡' : '🔴';
  console.log(`${intentEmoji} Purchase intent: ${intent.toUpperCase()} | Signals:`, {
    dims: updatedSignals.hasSpecificDimensions,
    material: updatedSignals.materialQuestions,
    techSpec: updatedSignals.techSpecQuestions,
    msgs: updatedSignals.totalMessages
  });

  return {
    intent,
    signals: updatedSignals,
    isRetail: true // Flag for retail vs wholesale
  };
}

/**
 * Check if message indicates wholesale inquiry
 * (Wholesale has different scoring rules - to be implemented separately)
 */
function isWholesaleInquiry(message, convo = {}) {
  const cleanMsg = message.toLowerCase();

  // Direct wholesale indicators
  const wholesalePatterns = /\b(mayoreo|distribuidor|grandes\s+cantidades|por\s+mayor|compra\s+grande|100\s*(piezas|rollos|unidades)|volumen|reventa|negocio|tienda|ferreteria|ferreter[ií]a)\b/i;

  // Reseller intent — "quiero vender", "para vender", "empezar a vender"
  const resellerPatterns = /\b(para\s+vender|quiero\s+vender|empezar\s+a\s+vender|vender\s+en\s+mi|incursionar.*vender|ser\s+distribuid|hacerme\s+distribuid|proveed|soy\s+(vendedor|comerciante)|para\s+(ofrecer|vender)\w*\s+(a\s+)?(mis|sus)\s+clientes)\b/i;

  return wholesalePatterns.test(cleanMsg) || resellerPatterns.test(cleanMsg) || convo.isWholesaleInquiry === true;
}

/**
 * Get a summary of why the score is what it is
 * Useful for human agents and debugging
 */
function getScoreExplanation(signals) {
  const reasons = [];

  // Positive
  if (signals.hasSpecificDimensions) reasons.push('✅ Proporcionó medidas específicas');
  if (signals.hasSpecificLocation) reasons.push('✅ Mencionó ubicación específica');
  if (signals.askedAboutPayment) reasons.push('✅ Preguntó por formas de pago');
  if (signals.confirmedSize) reasons.push('✅ Confirmó medida recomendada');
  if (signals.mentionedUrgency) reasons.push('✅ Mencionó urgencia');

  // Negative
  if (signals.materialQuestions >= 2) reasons.push(`⚠️ Preguntas sobre materiales: ${signals.materialQuestions}x`);
  if (signals.techSpecQuestions >= 2) reasons.push(`⚠️ Preguntas técnicas: ${signals.techSpecQuestions}x`);
  if (signals.catalogRequests >= 1) reasons.push(`⚠️ Pidió catálogo/lista de precios`);
  if (signals.askingAroundQuestions >= 1) reasons.push(`⚠️ Preguntó por ubicación/tienda (comparando opciones)`);
  if (signals.messagesWithoutProgress >= 5) reasons.push(`⚠️ ${signals.messagesWithoutProgress} mensajes sin dar medidas`);
  if (signals.erraticTypingCount >= 2) reasons.push(`⚠️ Escritura errática detectada`);

  return reasons;
}

module.exports = {
  scorePurchaseIntent,
  isWholesaleInquiry,
  getScoreExplanation,
  calculateScore,
  PURCHASE_INTENT,
  DEFAULT_SIGNALS
};
