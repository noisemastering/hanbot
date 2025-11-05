// mexicanLocations.js
// Mexican states and major cities for location detection

const MEXICAN_STATES = [
  'aguascalientes', 'baja california', 'baja california sur', 'campeche',
  'chiapas', 'chihuahua', 'coahuila', 'colima', 'durango', 'guanajuato',
  'guerrero', 'hidalgo', 'jalisco', 'méxico', 'edo. de méxico', 'estado de méxico',
  'michoacán', 'morelos', 'nayarit', 'nuevo león', 'oaxaca', 'puebla',
  'querétaro', 'quintana roo', 'san luis potosí', 'sinaloa', 'sonora',
  'tabasco', 'tamaulipas', 'tlaxcala', 'veracruz', 'yucatán', 'zacatecas',
  'cdmx', 'ciudad de méxico'
];

const MAJOR_CITIES = [
  // Major cities (100k+ population)
  'guadalajara', 'monterrey', 'puebla', 'tijuana', 'león', 'juárez',
  'zapopan', 'mérida', 'san luis potosí', 'aguascalientes', 'hermosillo',
  'saltillo', 'mexicali', 'culiacán', 'guadalupe', 'acapulco', 'tlalnepantla',
  'cancún', 'querétaro', 'chihuahua', 'morelia', 'toluca', 'tuxtla gutiérrez',
  'reynosa', 'tlaquepaque', 'durango', 'chimalhuacán', 'torreón', 'naucalpan',
  'san nicolás de los garza', 'victoria', 'celaya', 'pachuca', 'irapuato',
  'mazatlán', 'veracruz', 'xalapa', 'tepic', 'cuernavaca', 'campeche',
  'oaxaca', 'tampico', 'ensenada', 'matamoros', 'coatzacoalcos', 'uruapan',
  'villahermosa', 'manzanillo', 'puerto vallarta', 'poza rica', 'córdoba',
  'salamanca', 'monclova', 'nuevo laredo', 'playa del carmen', 'texcoco',
  'nezahualcóyotl', 'ecatepec', 'metepec', 'cuautitlán', 'atizapán',
  'león de los aldama', 'san juan del río', 'guanajuato', 'silao',
  'salamanca', 'celaya', 'irapuato', 'zamora', 'lázaro cárdenas',
  'apodaca', 'santa catarina', 'general escobedo', 'san pedro garza garcía',
  'los cabos', 'la paz', 'ciudad obregón', 'nogales', 'navojoa',
  'los mochis', 'guasave', 'guaymas', 'ciudad del carmen', 'chetumal',
  'othón p. blanco', 'solidaridad', 'benito juárez', 'cozumel',
  'tehuacán', 'san martín texmelucan', 'cholula', 'atlixco',
  'ciudad valles', 'rioverde', 'soledad de graciano sánchez',
  'guamúchil', 'navolato', 'ahome', 'escuinapa', 'el fuerte',
  'tulum', 'bacalar', 'isla mujeres', 'puerto morelos'
];

// Common abbreviations and variations
const LOCATION_VARIATIONS = {
  'cdmx': 'Ciudad de México',
  'df': 'Ciudad de México',
  'edomex': 'Estado de México',
  'edo mex': 'Estado de México',
  'qro': 'Querétaro',
  'slp': 'San Luis Potosí',
  'mty': 'Monterrey',
  'gdl': 'Guadalajara',
  'bc': 'Baja California',
  'bcs': 'Baja California Sur',
  'nl': 'Nuevo León',
  'jal': 'Jalisco',
  'sin': 'Sinaloa',
  'son': 'Sonora',
  'chih': 'Chihuahua',
  'coah': 'Coahuila',
  'tamps': 'Tamaulipas',
  'ver': 'Veracruz',
  'yuc': 'Yucatán',
  'qroo': 'Quintana Roo',
  'camp': 'Campeche',
  'tab': 'Tabasco',
  'chis': 'Chiapas',
  'oax': 'Oaxaca',
  'gro': 'Guerrero',
  'mich': 'Michoacán',
  'gto': 'Guanajuato',
  'ags': 'Aguascalientes',
  'zac': 'Zacatecas',
  'dgo': 'Durango',
  'nay': 'Nayarit',
  'col': 'Colima',
  'mor': 'Morelos',
  'hgo': 'Hidalgo',
  'tlax': 'Tlaxcala',
  'pue': 'Puebla'
};

/**
 * Detects if a message contains a Mexican location (state or city)
 * @param {string} message - User's message
 * @returns {object|null} - { location: string, type: 'state'|'city', normalized: string } or null
 */
function detectMexicanLocation(message) {
  const cleaned = message.toLowerCase().trim();

  // Check for abbreviations first
  for (const [abbr, fullName] of Object.entries(LOCATION_VARIATIONS)) {
    if (new RegExp(`\\b${abbr}\\b`, 'i').test(cleaned)) {
      return {
        location: fullName,
        type: 'state',
        normalized: fullName,
        original: message.trim()
      };
    }
  }

  // Check for states (exact match or partial)
  for (const state of MEXICAN_STATES) {
    if (cleaned === state || cleaned.includes(state)) {
      return {
        location: state,
        type: 'state',
        normalized: state.charAt(0).toUpperCase() + state.slice(1),
        original: message.trim()
      };
    }
  }

  // Check for major cities
  for (const city of MAJOR_CITIES) {
    if (cleaned === city || cleaned.includes(city)) {
      return {
        location: city,
        type: 'city',
        normalized: city.charAt(0).toUpperCase() + city.slice(1),
        original: message.trim()
      };
    }
  }

  return null;
}

/**
 * Checks if a short message is likely a location name
 * Used for context-aware city detection after shipping questions
 * @param {string} message
 * @returns {boolean}
 */
function isLikelyLocationName(message) {
  const cleaned = message.toLowerCase().trim();

  // Exclude common non-location words
  const excludedWords = /\b(precio|cuanto|cuesta|medida|tamaño|dimension|tiene|hay|vende|fabrica|color|hola|buenos|buenas|que tal|gracias|si|no|ok|bien|mal|cuando|donde|como|quien|para|por|con|sin|muy|poco|mucho)\b/i;

  if (excludedWords.test(cleaned)) {
    return false;
  }

  // Short (1-4 words), could be a city/state name
  const wordCount = cleaned.split(/\s+/).length;
  return cleaned.length > 2 && cleaned.length < 50 && wordCount <= 4;
}

module.exports = {
  detectMexicanLocation,
  isLikelyLocationName,
  MEXICAN_STATES,
  MAJOR_CITIES
};
