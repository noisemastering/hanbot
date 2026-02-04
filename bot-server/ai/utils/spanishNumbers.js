// ai/utils/spanishNumbers.js
// SINGLE SOURCE OF TRUTH for Spanish number conversion
// All dimension parsers should import from here

const NUMBER_MAP = {
  'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
  'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9',
  'diez': '10', 'once': '11', 'doce': '12', 'trece': '13', 'catorce': '14',
  'quince': '15', 'dieciséis': '16', 'dieciseis': '16', 'diecisiete': '17',
  'dieciocho': '18', 'diecinueve': '19', 'veinte': '20', 'veintiuno': '21',
  'veintidós': '22', 'veintidos': '22', 'veintitrés': '23', 'veintitres': '23',
  'veinticuatro': '24', 'veinticinco': '25', 'treinta': '30', 'cuarenta': '40',
  'cincuenta': '50', 'sesenta': '60', 'setenta': '70', 'ochenta': '80', 'noventa': '90'
};

/**
 * Convert Spanish number words to digits
 * "seis por cuatro" -> "6 por 4"
 * "tres y medio" -> "3.5"
 * "nueve metros y medio" -> "9.5"
 *
 * @param {string} text - Text with Spanish number words
 * @returns {string} - Text with numbers converted to digits
 */
function convertSpanishNumbers(text) {
  if (!text) return text;

  let converted = text.toLowerCase();

  // Handle "NUMBER metros y medio" (e.g., "nueve metros y medio" → "9.5")
  converted = converted.replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+metros?\s+y\s+medio\b/gi, (match, num) => {
    const numVal = NUMBER_MAP[num.toLowerCase()];
    return numVal ? `${numVal}.5` : match;
  });

  // Handle "NUMBER y medio" (e.g., "tres y medio" -> "3.5")
  converted = converted.replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+y\s+medio\b/gi, (match, num) => {
    const numVal = NUMBER_MAP[num.toLowerCase()];
    return numVal ? `${numVal}.5` : match;
  });

  // Handle decimal patterns like "uno treinta" (1.30)
  // Small number (≤10) followed by another number = decimal
  converted = converted.replace(/\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, (match, ones, decimal) => {
    const onesVal = NUMBER_MAP[ones.toLowerCase()];
    const decimalVal = NUMBER_MAP[decimal.toLowerCase()];
    if (onesVal && decimalVal && parseInt(onesVal) <= 10) {
      return `${onesVal}.${decimalVal}`;
    }
    return match;
  });

  // Handle compound numbers like "treinta y cinco" (35)
  converted = converted.replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+y\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, (match, tens, ones) => {
    const tensVal = NUMBER_MAP[tens.toLowerCase()];
    const onesVal = NUMBER_MAP[ones.toLowerCase()];
    if (tensVal && onesVal) {
      return (parseInt(tensVal) + parseInt(onesVal)).toString();
    }
    return match;
  });

  // Replace simple number words
  for (const [word, digit] of Object.entries(NUMBER_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    converted = converted.replace(regex, digit);
  }

  return converted;
}

module.exports = { convertSpanishNumbers, NUMBER_MAP };
