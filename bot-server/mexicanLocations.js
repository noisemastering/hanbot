// mexicanLocations.js
// Mexican states and major cities for location detection

const ZipCode = require('./models/ZipCode');
const { OpenAI } = require('openai');
const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// Tiny in-memory cache so we don't pay the AI call for repeats of the same string
const _locationClassifierCache = new Map();
const _LOCATION_CACHE_MAX = 500;

const MEXICAN_STATES = [
  'aguascalientes', 'baja california', 'baja california sur', 'campeche',
  'chiapas', 'chihuahua', 'coahuila', 'colima', 'durango', 'guanajuato',
  'guerrero', 'hidalgo', 'jalisco', 'méxico', 'edo. de méxico', 'estado de méxico',
  'michoacán', 'morelos', 'nayarit', 'nuevo león', 'oaxaca', 'puebla',
  'querétaro', 'quintana roo', 'san luis potosí', 'sinaloa', 'sonora',
  'tabasco', 'tamaulipas', 'tlaxcala', 'veracruz', 'yucatán', 'zacatecas',
  'cdmx', 'ciudad de méxico'
];

// CDMX Alcaldías (formerly Delegaciones)
const CDMX_ALCALDIAS = [
  'álvaro obregón', 'alvaro obregon', 'azcapotzalco', 'benito juárez', 'benito juarez',
  'coyoacán', 'coyoacan', 'cuajimalpa', 'cuauhtémoc', 'cuauhtemoc',
  'gustavo a. madero', 'gustavo a madero', 'gustavo madero', 'gam',
  'iztacalco', 'iztapalapa', 'magdalena contreras', 'la magdalena contreras',
  'miguel hidalgo', 'milpa alta', 'tláhuac', 'tlahuac', 'tlalpan',
  'venustiano carranza', 'xochimilco'
];

const MAJOR_CITIES = [
  // CDMX Alcaldías
  ...CDMX_ALCALDIAS,
  // Major cities (100k+ population)
  'guadalajara', 'monterrey', 'puebla', 'tijuana', 'león', 'juárez',
  // Towns with "agua" in name (to avoid false positives with water questions)
  'agua prieta', 'aguascalientes', 'agua dulce', 'agua azul',
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
  'cdm': 'Ciudad de México',
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
  // 'sin', 'son', 'ver' removed — too ambiguous (Spanish words: sin=without, son=are, ver=see)
  // Users will write the full state name; these are matched in MEXICAN_STATES below
  'chih': 'Chihuahua',
  'coah': 'Coahuila',
  'tamps': 'Tamaulipas',
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
  // 'col' removed — ambiguous (common abbreviation for "colonia" in Mexican addresses)
  'mor': 'Morelos',
  'hgo': 'Hidalgo',
  'tlax': 'Tlaxcala',
  'pue': 'Puebla'
};

/**
 * Removes accents/diacritics from a string for comparison
 * @param {string} str - String to normalize
 * @returns {string} - Normalized string without accents
 */
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Detects if a message contains a Mexican location (state or city)
 * @param {string} message - User's message
 * @returns {object|null} - { location: string, type: 'state'|'city', normalized: string } or null
 */
function detectMexicanLocation(message) {
  const cleaned = message.toLowerCase().trim();
  const cleanedNoAccents = removeAccents(cleaned);

  // Check for "Alcaldía X" or "Delegación X" patterns (CDMX)
  const alcaldiaMatch = cleaned.match(/\b(?:alcald[ií]a|delegaci[oó]n)\s+(.+)/i);
  if (alcaldiaMatch) {
    const alcaldiaName = alcaldiaMatch[1].trim();
    const alcaldiaNoAccents = removeAccents(alcaldiaName);
    // Check if it's a known alcaldía
    for (const alcaldia of CDMX_ALCALDIAS) {
      if (removeAccents(alcaldia).includes(alcaldiaNoAccents) || alcaldiaNoAccents.includes(removeAccents(alcaldia))) {
        return {
          location: alcaldiaName,
          type: 'alcaldia',
          state: 'Ciudad de México',
          normalized: `${alcaldiaName.charAt(0).toUpperCase() + alcaldiaName.slice(1)}, CDMX`,
          original: message.trim()
        };
      }
    }
    // Even if not in our list, "Alcaldía X" is clearly a CDMX location
    return {
      location: alcaldiaName,
      type: 'alcaldia',
      state: 'Ciudad de México',
      normalized: `${alcaldiaName.charAt(0).toUpperCase() + alcaldiaName.slice(1)}, CDMX`,
      original: message.trim()
    };
  }

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

  // Check for states (exact match or partial) - accent insensitive
  for (const state of MEXICAN_STATES) {
    const stateNoAccents = removeAccents(state);
    if (cleanedNoAccents === stateNoAccents || cleanedNoAccents.includes(stateNoAccents)) {
      return {
        location: state,
        type: 'state',
        normalized: state.charAt(0).toUpperCase() + state.slice(1),
        original: message.trim()
      };
    }
  }

  // Check for major cities - accent insensitive
  for (const city of MAJOR_CITIES) {
    const cityNoAccents = removeAccents(city);
    if (cleanedNoAccents === cityNoAccents || cleanedNoAccents.includes(cityNoAccents)) {
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
/**
 * AI-based check: is this customer message a Mexican location name
 * (city, town, state, neighborhood) — as opposed to a question, product
 * attribute, greeting, etc.?
 *
 * Replaces the previous regex-based heuristic that kept missing cases
 * (e.g. "Colores" matching as a location because the exclusion list was
 * incomplete). The regex couldn't scale — every new edge case meant
 * another keyword to add.
 *
 * Returns true ONLY if the message is clearly a Mexican place name.
 * Defaults to false on errors or ambiguity (safer to ask again than to
 * confidently misinterpret a product question as a location).
 *
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function isLikelyLocationName(message) {
  if (!message || typeof message !== 'string') return false;
  const cleaned = message.trim();
  if (cleaned.length < 2 || cleaned.length > 80) return false;

  // Pure numbers (zip codes) are handled by detectZipCode, not here
  if (/^\d+$/.test(cleaned)) return false;

  // Cache by lowercased text
  const key = cleaned.toLowerCase();
  if (_locationClassifierCache.has(key)) {
    return _locationClassifierCache.get(key);
  }

  try {
    const res = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un clasificador. Decide si el mensaje del usuario es ÚNICAMENTE el nombre de un lugar en México (ciudad, pueblo, colonia, estado, municipio, delegación) — no una pregunta, ni un producto, ni un saludo, ni un atributo (color, medida, etc.).

Responde JSON: {"isLocation": true|false}

Ejemplos:
- "Zapopan" → {"isLocation": true}
- "Querétaro" → {"isLocation": true}
- "CDMX" → {"isLocation": true}
- "Pueblo Nuevo" → {"isLocation": true}
- "Tlalpan" → {"isLocation": true}
- "Colores" → {"isLocation": false}
- "Color beige" → {"isLocation": false}
- "Precio" → {"isLocation": false}
- "Cuánto?" → {"isLocation": false}
- "Foto" → {"isLocation": false}
- "Necesito una" → {"isLocation": false}
- "Si gracias" → {"isLocation": false}
- "45079 Zapopan" → {"isLocation": true}
- "tengo dudas" → {"isLocation": false}
- "alguna promo?" → {"isLocation": false}`
        },
        { role: 'user', content: cleaned }
      ],
      temperature: 0,
      max_tokens: 20,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const result = parsed.isLocation === true;

    // Cache
    if (_locationClassifierCache.size >= _LOCATION_CACHE_MAX) {
      _locationClassifierCache.delete(_locationClassifierCache.keys().next().value);
    }
    _locationClassifierCache.set(key, result);
    return result;
  } catch (err) {
    console.error('❌ isLikelyLocationName AI error:', err.message);
    return false;  // Safe default: don't confidently treat as location on error
  }
}

/**
 * Detects if a message contains a Mexican zipcode (5 digits)
 * @param {string} message - User's message
 * @returns {string|null} - The zipcode if found, null otherwise
 */
function detectZipCode(message) {
  const match = message.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/**
 * Validates a location using the ZipCode database (async)
 * Works with both zipcodes and city/state names
 * @param {string} input - Zipcode or city/state name
 * @returns {Promise<object|null>} - Location info or null
 */
async function validateLocationFromDB(input) {
  try {
    return await ZipCode.validateLocation(input);
  } catch (err) {
    console.error('❌ Error validating location from DB:', err);
    return null;
  }
}

/**
 * Enhanced location detection that checks both hardcoded lists AND database
 * @param {string} message - User's message
 * @returns {Promise<object|null>} - Location info or null
 */
async function detectLocationEnhanced(message) {
  // First check for zipcode
  const zipcode = detectZipCode(message);
  if (zipcode) {
    const dbResult = await validateLocationFromDB(zipcode);
    if (dbResult) {
      return {
        location: dbResult.city,
        state: dbResult.state,
        type: 'zipcode',
        code: dbResult.code,
        normalized: `${dbResult.city}, ${dbResult.state}`,
        original: message.trim()
      };
    }
  }

  // Then check hardcoded lists (fast, sync)
  const quickMatch = detectMexicanLocation(message);
  if (quickMatch) {
    return quickMatch;
  }

  // Finally, try database lookup for city names not in hardcoded list
  const cleaned = message.toLowerCase().trim();
  if (await isLikelyLocationName(message)) {
    const dbResult = await validateLocationFromDB(cleaned);
    if (dbResult) {
      return {
        location: dbResult.city || dbResult.state,
        state: dbResult.state,
        type: dbResult.code ? 'city' : 'state',
        code: dbResult.code,
        normalized: dbResult.city ? `${dbResult.city}, ${dbResult.state}` : dbResult.state,
        original: message.trim()
      };
    }
  }

  return null;
}

module.exports = {
  detectMexicanLocation,
  detectLocationEnhanced,
  detectZipCode,
  validateLocationFromDB,
  isLikelyLocationName,
  MEXICAN_STATES,
  MAJOR_CITIES
};
