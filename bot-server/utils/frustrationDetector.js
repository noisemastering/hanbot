// Detects customer frustration/anger in messages.
// Returns { isFrustrated, signals[], severity: 'low'|'medium'|'high' }

const HIGH_ANGER_PATTERNS = [
  /\b(estafa|estafad|fraud|robo|robar|chinga|pendejo|idiota|imbecil|imb[ée]cil|mames|cabr[oó]n|verg[ae]|mierda|porqueria|porquer[ií]a)/i,
  /\b(no sirve|no funciona|p[eé]simo|p[eé]simo servicio|terrible|asco|horrible)/i,
  /\b(jam[aá]s|nunca m[aá]s|nunca volveria|nunca volver[eé]|no compro|no comprar[eé])/i,
  /\b(demanda|denuncia|profeco|condusef|reportar|reportare)/i,
  /\b(devuelve|devuelvan|reembols|me robaron|me enga[ñn]aron|me mintieron)/i,
];

const MEDIUM_FRUSTRATION_PATTERNS = [
  /\b(mentir|mienten|mentiroso|enga[ñn]o|enga[ñn]ar|enga[ñn]oso)/i,
  /\b(me dijeron|me dijiste|hace rato|ya te dije|ya dije|ya respondi|ya respond[ií]|ya mande|ya mand[eé]|ya envie|ya envi[eé])/i,
  /\b(me hiciste menci[oó]n|me mencionaste|me comentaste|me dijiste|t[uú] dijiste|tu mencionaste|recuerda que|antes dijiste)/i,
  /\b(precio.*equivocado|precio.*incorrecto|otro precio|distinto precio|diferente precio|precio.*diferente|precio.*cambia)/i,
  /\b(no era|no es|por qu[eé] cambia|cambias|cambiaron|cambiaste)/i,
  /\b(entonces.*ser[ií]a|entonces.*era|entonces.*ser[áa])/i,
  /\b(esto no|para qu[eé]|ya no quiero|olv[ií]dalo|ya no me interesa|ya no)/i,
  /\b(d[ée]jame|d[ée]jenme|no me|d[eé]jen|stop|alto)/i,
  /\bwtf\b/i,
];

const LOW_FRUSTRATION_PATTERNS = [
  /\b(confus|confund|no entiend|no entendi|no le entiendo)/i,
  /\b(otra vez|de nuevo|ya pregunte|ya pregunt[eé])/i,
  /\b(en serio\?|de verdad\?|c[oó]mo\?)/i,
];

// All caps as a signal — but only for messages longer than 5 chars (avoid OK, SI)
function hasShoutingCaps(text) {
  if (!text || text.length < 6) return false;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.7;
}

function hasRepeatedPunctuation(text) {
  return /[!?]{3,}|[!]{2,}|[?]{2,}/.test(text);
}

/**
 * Analyze a single message for frustration signals.
 */
function analyzeMessage(text) {
  if (!text) return { isFrustrated: false, signals: [], severity: 'none' };

  const signals = [];
  let severity = 'none';

  for (const pattern of HIGH_ANGER_PATTERNS) {
    if (pattern.test(text)) {
      signals.push({ level: 'high', match: pattern.source.slice(0, 30) });
      severity = 'high';
    }
  }

  for (const pattern of MEDIUM_FRUSTRATION_PATTERNS) {
    if (pattern.test(text)) {
      signals.push({ level: 'medium', match: pattern.source.slice(0, 30) });
      if (severity !== 'high') severity = 'medium';
    }
  }

  for (const pattern of LOW_FRUSTRATION_PATTERNS) {
    if (pattern.test(text)) {
      signals.push({ level: 'low', match: pattern.source.slice(0, 30) });
      if (severity === 'none') severity = 'low';
    }
  }

  if (hasShoutingCaps(text)) {
    signals.push({ level: 'medium', match: 'all caps' });
    if (severity === 'none' || severity === 'low') severity = 'medium';
  }

  if (hasRepeatedPunctuation(text)) {
    signals.push({ level: 'low', match: 'excessive punctuation' });
    if (severity === 'none') severity = 'low';
  }

  return {
    isFrustrated: severity !== 'none',
    signals,
    severity
  };
}

/**
 * Determine if a conversation should be flagged for no-follow-up.
 * Returns the reason string if it should, or null.
 *
 * Triggers:
 * - Single 'high' severity message → 'angry'
 * - Two or more 'medium' messages in this conversation → 'repeated_frustration'
 * - Explicit "no me molesten / no me llamen / no me contacten" → 'opt_out'
 */
function shouldFlagConversation(currentAnalysis, recentMessages = []) {
  if (currentAnalysis.severity === 'high') {
    return 'angry';
  }

  // Count recent medium-or-higher messages
  let frustrationCount = currentAnalysis.severity === 'medium' ? 1 : 0;
  for (const msg of recentMessages.slice(-5)) {
    const a = analyzeMessage(msg);
    if (a.severity === 'medium' || a.severity === 'high') frustrationCount++;
  }

  if (frustrationCount >= 2) return 'repeated_frustration';

  return null;
}

module.exports = {
  analyzeMessage,
  shouldFlagConversation
};
