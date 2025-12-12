// ai/utils/typoCorrection.js
// Corrects common typos before processing messages

/**
 * Map of common typos to their correct forms
 */
const TYPO_MAP = {
  // Precio (price) typos
  'presión': 'precio',
  'presion': 'precio',
  'precion': 'precio',
  'precío': 'precio',

  // Rollo (roll) typos
  'royo': 'rollo',
  'rolo': 'rollo',
  'roio': 'rollo',

  // Malla (mesh) typos
  'maya': 'malla',
  'maia': 'malla',

  // Sombra (shade) typos
  'sonbra': 'sombra',
  'zombra': 'sombra',

  // Cuánto (how much) typos
  'cuanto': 'cuánto',
  'quanto': 'cuánto',

  // Tamaño (size) typos
  'tamaño': 'tamaño',
  'tamano': 'tamaño',
  'tamanio': 'tamaño',

  // Disponible (available) typos
  'disponible': 'disponible',
  'disponivel': 'disponible',
  'disponivle': 'disponible',

  // Envío (shipping) typos
  'envio': 'envío',
  'emvio': 'envío',
  'enbio': 'envío',

  // Metros (meters) typos
  'mts': 'metros',
  'mt': 'metros',
  'mtrs': 'metros',
  'm': 'metros'
};

/**
 * Corrects common typos in the user message
 * @param {string} message - The user's message
 * @returns {string} - Message with typos corrected
 */
function correctTypos(message) {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let correctedMessage = message;

  // Apply typo corrections (case-insensitive)
  for (const [typo, correct] of Object.entries(TYPO_MAP)) {
    // Create regex for whole word matching (case-insensitive)
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');

    // Replace while preserving the original case pattern
    correctedMessage = correctedMessage.replace(regex, (match) => {
      // If original was uppercase, return uppercase
      if (match === match.toUpperCase()) {
        return correct.toUpperCase();
      }
      // If original had capital first letter, preserve that
      if (match[0] === match[0].toUpperCase()) {
        return correct.charAt(0).toUpperCase() + correct.slice(1);
      }
      // Otherwise return lowercase
      return correct.toLowerCase();
    });
  }

  return correctedMessage;
}

/**
 * Logs typo corrections for monitoring
 */
function logTypoCorrection(original, corrected) {
  if (original !== corrected) {
    console.log(`📝 Typo corrected: "${original}" → "${corrected}"`);
  }
}

module.exports = {
  correctTypos,
  logTypoCorrection
};
