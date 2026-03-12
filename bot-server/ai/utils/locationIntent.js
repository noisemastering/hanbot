// ai/utils/locationIntent.js
// Single source of truth for distinguishing "asking for our location" vs
// "customer talking about their own location."

/**
 * Is the customer asking where WE are located?
 * e.g. "dónde están?", "dirección?", "ubicación?", "tienen tienda física?"
 */
const ASKING_OUR_LOCATION = /\b(direcci[oó]n|ubicaci[oó]n|(?:d[oó]nde|dnd)\s*(est[aá]n|quedan|se\s*encuentran|se\s*ubica)|domicilio|tienda\s*f[ií]sica|sucursal|local|mostrador|recoger|pasar\s*a\s*recoger|c[oó]mo\s+llego)\b/i;

/**
 * Is the customer talking about sending/sharing THEIR own location?
 * e.g. "le mando ubicación x wap", "te envío mi dirección", "mi ubicación"
 */
const SENDING_THEIR_LOCATION = /\b(mand[oa]r?|envi[oa]r?|compartir?|paso|le\s+mando|te\s+mando|les?\s+env[ií]o)\b.*\b(ubicaci[oó]n|direcci[oó]n)\b|\b(mi\s+ubicaci[oó]n|mi\s+direcci[oó]n)\b/i;

/**
 * Classify a message's location intent.
 * @param {string} msg
 * @returns {"asking_ours"|"sending_theirs"|null}
 */
function classifyLocationIntent(msg) {
  if (!msg) return null;
  if (SENDING_THEIR_LOCATION.test(msg)) return 'sending_theirs';
  if (ASKING_OUR_LOCATION.test(msg)) return 'asking_ours';
  return null;
}

/**
 * Quick boolean: is the customer offering to send their own location?
 */
function isSendingTheirLocation(msg) {
  return SENDING_THEIR_LOCATION.test(msg || '');
}

module.exports = { classifyLocationIntent, isSendingTheirLocation, ASKING_OUR_LOCATION, SENDING_THEIR_LOCATION };
