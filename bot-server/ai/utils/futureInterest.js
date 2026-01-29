// ai/utils/futureInterest.js
// Detects future purchase intent and extracts timeframes

/**
 * Timeframe patterns and their approximate days
 */
const TIMEFRAME_PATTERNS = [
  // Specific timeframes
  { pattern: /\b(la\s+)?pr[oó]xima\s+semana\b/i, days: 7, label: "próxima semana" },
  { pattern: /\ben\s+(una?\s+)?semana\b/i, days: 7, label: "una semana" },
  { pattern: /\ben\s+(\d+)\s+semanas?\b/i, days: null, multiplier: 7, label: "semanas" },

  { pattern: /\b(la\s+)?pr[oó]xima\s+quincena\b/i, days: 15, label: "próxima quincena" },
  { pattern: /\ben\s+(una?\s+)?quincena\b/i, days: 15, label: "una quincena" },
  { pattern: /\ben\s+(\d+)\s+quincenas?\b/i, days: null, multiplier: 15, label: "quincenas" },

  { pattern: /\b(el\s+)?pr[oó]ximo\s+mes\b/i, days: 30, label: "próximo mes" },
  { pattern: /\ben\s+un\s+mes\b/i, days: 30, label: "un mes" },
  { pattern: /\ben\s+(un\s+)?par\s+de\s+meses\b/i, days: 60, label: "par de meses" },
  { pattern: /\ben\s+(\d+)\s+meses?\b/i, days: null, multiplier: 30, label: "meses" },
  { pattern: /\ben\s+unos?\s+meses?\b/i, days: 60, label: "unos meses" },

  { pattern: /\bfin\s+de\s+mes\b/i, days: 15, label: "fin de mes" },
  { pattern: /\bfin\s+de\s+a[ñn]o\b/i, days: null, special: "end_of_year", label: "fin de año" },
  { pattern: /\bdespu[eé]s\s+de\s+navidad\b/i, days: null, special: "after_christmas", label: "después de navidad" },

  // Month names
  { pattern: /\ben\s+enero\b/i, days: null, special: "month", month: 0, label: "enero" },
  { pattern: /\ben\s+febrero\b/i, days: null, special: "month", month: 1, label: "febrero" },
  { pattern: /\ben\s+marzo\b/i, days: null, special: "month", month: 2, label: "marzo" },
  { pattern: /\ben\s+abril\b/i, days: null, special: "month", month: 3, label: "abril" },
  { pattern: /\ben\s+mayo\b/i, days: null, special: "month", month: 4, label: "mayo" },
  { pattern: /\ben\s+junio\b/i, days: null, special: "month", month: 5, label: "junio" },
  { pattern: /\ben\s+julio\b/i, days: null, special: "month", month: 6, label: "julio" },
  { pattern: /\ben\s+agosto\b/i, days: null, special: "month", month: 7, label: "agosto" },
  { pattern: /\ben\s+septiembre\b/i, days: null, special: "month", month: 8, label: "septiembre" },
  { pattern: /\ben\s+octubre\b/i, days: null, special: "month", month: 9, label: "octubre" },
  { pattern: /\ben\s+noviembre\b/i, days: null, special: "month", month: 10, label: "noviembre" },
  { pattern: /\ben\s+diciembre\b/i, days: null, special: "month", month: 11, label: "diciembre" },

  // Vague timeframes
  { pattern: /\bm[aá]s\s+adelante\b/i, days: 30, label: "más adelante" },
  { pattern: /\bdespu[eé]s\b/i, days: 30, label: "después" },
  { pattern: /\bluego\b/i, days: 14, label: "luego" },
  { pattern: /\bpor\s+ahora\s+no\b/i, days: 30, label: "por ahora no" },
  { pattern: /\btodav[ií]a\s+no\b/i, days: 30, label: "todavía no" },
  { pattern: /\bcuando\s+(tenga|junte|ahorre|me\s+paguen)\b/i, days: 30, label: "cuando tenga dinero" },
  { pattern: /\bcuando\s+pueda\b/i, days: 30, label: "cuando pueda" },
];

/**
 * Interest indicators - phrases that show the person IS interested
 */
const INTEREST_INDICATORS = [
  /\bs[ií]\s+(estoy\s+)?interesad[oa]\b/i,
  /\bme\s+interesa\b/i,
  /\bs[ií]\s+(lo\s+|la\s+)?quiero\b/i,
  /\bs[ií]\s+(lo\s+|la\s+)?necesito\b/i,
  /\bs[ií]\s+(lo\s+|la\s+)?ocupo\b/i,
  /\blo\s+voy\s+a\s+(necesitar|ocupar|comprar)\b/i,
  /\btengo\s+planes\s+de\s+(comprar|adquirir)\b/i,
  /\bpienso\s+(comprar|adquirir)\b/i,
  /\bquiero\s+(comprar|adquirir)\b/i,
  /\bvoy\s+a\s+(comprar|necesitar)\b/i,
];

/**
 * Rejection indicators - phrases that show they're NOT interested
 */
const REJECTION_INDICATORS = [
  /\bno\s+(me\s+)?interesa\b/i,
  /\bno\s+gracias\b/i,
  /\bya\s+no\s+(lo\s+|la\s+)?necesito\b/i,
  /\bya\s+compr[eé]\b/i,
  /\bya\s+(lo\s+|la\s+)?consegu[ií]\b/i,
];

/**
 * Calculate days until a specific month
 */
function daysUntilMonth(targetMonth) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let targetYear = currentYear;
  if (targetMonth <= currentMonth) {
    targetYear = currentYear + 1;
  }

  const targetDate = new Date(targetYear, targetMonth, 15); // Middle of target month
  const diffTime = targetDate - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate days for special timeframes
 */
function calculateSpecialDays(special, month = null) {
  const now = new Date();

  switch (special) {
    case "end_of_year": {
      const endOfYear = new Date(now.getFullYear(), 11, 31);
      if (endOfYear < now) {
        return 365; // Next year's end
      }
      return Math.ceil((endOfYear - now) / (1000 * 60 * 60 * 24));
    }
    case "after_christmas": {
      let christmas = new Date(now.getFullYear(), 11, 26);
      if (christmas < now) {
        christmas = new Date(now.getFullYear() + 1, 0, 5); // Early January next year
      }
      return Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
    }
    case "month": {
      return daysUntilMonth(month);
    }
    default:
      return 30;
  }
}

/**
 * Detect future purchase intent in a message
 * @param {string} message - The user's message
 * @param {object} conversation - Current conversation context
 * @returns {object|null} - Future interest data or null if not detected
 */
function detectFutureInterest(message, conversation = null) {
  if (!message) return null;

  const msg = message.toLowerCase().trim();

  // Check for rejection first
  for (const pattern of REJECTION_INDICATORS) {
    if (pattern.test(msg)) {
      return null; // Not interested
    }
  }

  // Check for interest indicators
  let hasInterestSignal = false;
  for (const pattern of INTEREST_INDICATORS) {
    if (pattern.test(msg)) {
      hasInterestSignal = true;
      break;
    }
  }

  // Look for timeframe
  let timeframeMatch = null;
  let timeframeDays = null;
  let timeframeLabel = null;

  for (const tf of TIMEFRAME_PATTERNS) {
    const match = msg.match(tf.pattern);
    if (match) {
      timeframeMatch = match[0];
      timeframeLabel = tf.label;

      if (tf.days !== null) {
        timeframeDays = tf.days;
      } else if (tf.multiplier && match[1]) {
        // Extract number and multiply
        const num = parseInt(match[1], 10);
        timeframeDays = num * tf.multiplier;
      } else if (tf.special) {
        timeframeDays = calculateSpecialDays(tf.special, tf.month);
      }
      break;
    }
  }

  // Need either interest signal with timeframe, or strong timeframe context
  if (!timeframeMatch) {
    return null;
  }

  // If we have a timeframe but no explicit interest, check context
  if (!hasInterestSignal) {
    // Check if conversation shows prior interest (they were asking about products)
    const hasContext = conversation && (
      conversation.productInterest ||
      conversation.requestedSize ||
      conversation.lastIntent?.includes('measure') ||
      conversation.lastIntent?.includes('price')
    );

    // Also accept messages with "pero" which implies interest
    const hasPero = /\bpero\b/i.test(msg);

    if (!hasContext && !hasPero) {
      return null;
    }
  }

  // Calculate follow-up date
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + (timeframeDays || 30));

  // Get product interest from conversation
  const productInterest = conversation?.productInterest ||
                          conversation?.requestedSize ||
                          conversation?.poiRootName ||
                          null;

  return {
    interested: true,
    timeframeRaw: timeframeMatch,
    timeframeDays: timeframeDays || 30,
    followUpDate,
    productInterest,
    originalMessage: message,
    detectedAt: new Date()
  };
}

/**
 * Format follow-up date for display
 */
function formatFollowUpDate(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

module.exports = {
  detectFutureInterest,
  formatFollowUpDate,
  TIMEFRAME_PATTERNS,
  INTEREST_INDICATORS
};
