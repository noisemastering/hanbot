// ai/utils/locationStats.js
// Handles location collection for sales correlation

const { updateConversation } = require("../../conversationManager");
const { detectLocationEnhanced, detectZipCode } = require("../../mexicanLocations");
const User = require("../../models/User");
const { generateBotResponse } = require("../responseGenerator");

// Mexican states mapping for normalization
const STATE_ALIASES = {
  'cdmx': 'Ciudad de México',
  'df': 'Ciudad de México',
  'ciudad de mexico': 'Ciudad de México',
  'estado de mexico': 'Estado de México',
  'edomex': 'Estado de México',
  'nl': 'Nuevo León',
  'nuevo leon': 'Nuevo León',
  'qro': 'Querétaro',
  'queretaro': 'Querétaro',
  'jal': 'Jalisco',
  'gto': 'Guanajuato',
  'bc': 'Baja California',
  'bcs': 'Baja California Sur',
  'slp': 'San Luis Potosí',
  'ags': 'Aguascalientes',
  'chih': 'Chihuahua',
  'coah': 'Coahuila',
  // 'sin', 'son', 'ver' removed — common Spanish words (sin=without, son=are, ver=see)
  'tab': 'Tabasco',
  'tamps': 'Tamaulipas',
  'yuc': 'Yucatán',
  'qroo': 'Quintana Roo',
  'mor': 'Morelos',
  'nay': 'Nayarit',
  'mich': 'Michoacán',
  'oax': 'Oaxaca',
  'pue': 'Puebla',
  'hgo': 'Hidalgo',
  'tlax': 'Tlaxcala',
  'zac': 'Zacatecas',
  'dgo': 'Durango',
  // 'col' removed — ambiguous (common abbreviation for "colonia")
  'camp': 'Campeche',
  'chis': 'Chiapas',
  'gro': 'Guerrero'
};

// Common city-state mappings (helps when user only provides city)
const CITY_STATE_MAP = {
  'monterrey': 'Nuevo León',
  'guadalajara': 'Jalisco',
  'tijuana': 'Baja California',
  'leon': 'Guanajuato',
  'puebla': 'Puebla',
  'juarez': 'Chihuahua',
  'ciudad juarez': 'Chihuahua',
  'zapopan': 'Jalisco',
  'merida': 'Yucatán',
  'cancun': 'Quintana Roo',
  'aguascalientes': 'Aguascalientes',
  'hermosillo': 'Sonora',
  'saltillo': 'Coahuila',
  'mexicali': 'Baja California',
  'culiacan': 'Sinaloa',
  'queretaro': 'Querétaro',
  'san luis potosi': 'San Luis Potosí',
  'morelia': 'Michoacán',
  'chihuahua': 'Chihuahua',
  'toluca': 'Estado de México',
  'tuxtla gutierrez': 'Chiapas',
  'durango': 'Durango',
  'torreon': 'Coahuila',
  'reynosa': 'Tamaulipas',
  'villahermosa': 'Tabasco',
  'mazatlan': 'Sinaloa',
  'veracruz': 'Veracruz',
  'acapulco': 'Guerrero',
  'oaxaca': 'Oaxaca',
  'xalapa': 'Veracruz',
  'tampico': 'Tamaulipas',
  'cuernavaca': 'Morelos',
  'celaya': 'Guanajuato',
  'irapuato': 'Guanajuato',
  'pachuca': 'Hidalgo',
  'playa del carmen': 'Quintana Roo',
  'los cabos': 'Baja California Sur',
  'cabo san lucas': 'Baja California Sur',
  'la paz': 'Baja California Sur',
  'ensenada': 'Baja California',
  'tepic': 'Nayarit',
  'colima': 'Colima',
  'campeche': 'Campeche',
  'zacatecas': 'Zacatecas',
  'tlaxcala': 'Tlaxcala'
};

/**
 * Generate stats question to append after sending ML link
 * @param {object} convo - Conversation state for context
 * @returns {Promise<string>} AI-generated question
 */
async function generateStatsQuestion(convo) {
  const response = await generateBotResponse("location_stats_question", { convo });
  return response ? `\n\n${response}` : "";
}

/**
 * Check if response contains a Mercado Libre link
 */
function containsMLLink(responseText) {
  if (!responseText) return false;
  return /mercadolibre\.com\.mx|articulo\.mercadolibre|hanlob.*\/r\/|agente\.hanlob/.test(responseText);
}

/**
 * Append zip code question to the response if it contains an ML link
 * and we haven't asked yet.
 * @param {string} responseText - The bot's response
 * @param {object} convo - Conversation state
 * @param {string} psid - User's PSID
 * @returns {object} { text, askedStats: boolean }
 */
async function appendStatsQuestionToResponse(responseText, convo, psid) {
  // Don't ask if already asked
  if (convo.askedLocationStats) {
    return { text: responseText, askedStats: false };
  }

  // Don't ask if we already have their location
  if (convo.city && convo.stateMx) {
    return { text: responseText, askedStats: false };
  }

  // Only ask if response contains ML link (price quote with purchase link)
  if (!containsMLLink(responseText)) {
    return { text: responseText, askedStats: false };
  }

  // Append question and mark as asked
  await updateConversation(psid, {
    askedLocationStats: true,
    pendingLocationResponse: true,
    lastLinkSentAt: new Date()
  });

  console.log("📊 Appending zip code question to price quote response");

  return {
    text: responseText + '\n\n¿Me puedes compartir tu código postal para fines estadísticos?',
    askedStats: true
  };
}

/**
 * Check if we should ask for location stats now (user just acknowledged link)
 * @param {object} convo - Conversation state
 * @returns {boolean}
 */
function shouldAskLocationStatsNow(convo) {
  // Check if we marked to ask and haven't asked yet
  if (!convo.shouldAskLocationStats) return false;
  if (convo.askedLocationStats) return false;
  if (convo.city && convo.stateMx) return false;
  return true;
}

/**
 * Generate the location stats question as a standalone response
 * Call this when user acknowledges the link
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @returns {object|null} Response object or null
 */
async function askLocationStatsQuestion(psid, convo) {
  if (!shouldAskLocationStatsNow(convo)) {
    return null;
  }

  // Mark as asked
  await updateConversation(psid, {
    askedLocationStats: true,
    shouldAskLocationStats: false,
    pendingLocationResponse: true
  });

  console.log("📊 Asking location stats question after user acknowledgment");

  const response = await generateBotResponse("location_stats_question", { convo });

  return response ? { type: "text", text: response } : null;
}

// Keep old function name for backwards compatibility
async function appendStatsQuestionIfNeeded(responseText, convo, psid) {
  return await appendStatsQuestionToResponse(responseText, convo, psid);
}

/**
 * Parse a city/state response
 * Handles formats like:
 * - "Cuernavaca, Morelos"
 * - "Cuernavaca Morelos"
 * - "Monterrey"
 * - "CDMX"
 * - "76000" (zip code)
 * @param {string} message - User's message
 * @returns {object|null} { city, state, zipcode } or null if not a location
 */
function parseLocationResponse(message) {
  if (!message) return null;

  const clean = message.trim().toLowerCase();

  // Skip if message is too long (probably not just a city)
  if (clean.length > 60) return null;

  // Check for zip code first — even if message has filler words like "si claro es 45800"
  const zipMatch = clean.match(/\b(\d{5})\b/);
  if (zipMatch) {
    return { zipcode: zipMatch[1], city: null, state: null };
  }

  // Skip if contains common non-location words
  if (/\b(precio|cuanto|cuesta|medida|tamaño|gracias|ok|si|no|hola|buenas?|quiero|necesito|tiene[ns]?|hay|envío|envio)\b/i.test(clean)) {
    return null;
  }

  // Check for "City, State" format
  const commaSplit = message.split(/[,،]/);
  if (commaSplit.length === 2) {
    const city = commaSplit[0].trim();
    const state = normalizeState(commaSplit[1].trim());
    if (city && state) {
      return { city: capitalizeWords(city), state, zipcode: null };
    }
  }

  // Check for "City State" format (2 words, second is a state)
  const words = clean.split(/\s+/);
  if (words.length >= 2) {
    // Try last word as state
    const lastWord = words[words.length - 1];
    const normalizedState = normalizeState(lastWord);
    if (normalizedState && normalizedState !== capitalizeWords(lastWord)) {
      // Last word is a state abbreviation
      const city = capitalizeWords(words.slice(0, -1).join(' '));
      return { city, state: normalizedState, zipcode: null };
    }

    // Try last two words as state (e.g., "Nuevo León", "San Luis Potosí")
    if (words.length >= 3) {
      const lastTwo = words.slice(-2).join(' ');
      const normalizedState2 = normalizeState(lastTwo);
      if (normalizedState2) {
        const city = capitalizeWords(words.slice(0, -2).join(' '));
        return { city, state: normalizedState2, zipcode: null };
      }
    }
  }

  // Single word/phrase - check if it's a known city or state
  const normalized = normalizeState(clean);
  if (normalized) {
    // It's a state
    return { city: null, state: normalized, zipcode: null };
  }

  // Check if it's a known city
  const cityLower = clean.replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]));
  const mappedState = CITY_STATE_MAP[cityLower];
  if (mappedState) {
    return { city: capitalizeWords(message.trim()), state: mappedState, zipcode: null };
  }

  // Last resort: accept as city if it looks like a proper noun (1-3 words, no numbers)
  if (words.length <= 3 && !clean.match(/\d/) && clean.length >= 3) {
    return { city: capitalizeWords(message.trim()), state: null, zipcode: null };
  }

  return null;
}

/**
 * Normalize state name/abbreviation to full name
 */
function normalizeState(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();

  // Check direct alias
  if (STATE_ALIASES[lower]) {
    return STATE_ALIASES[lower];
  }

  // Check if it's already a full state name
  const states = Object.values(STATE_ALIASES);
  const match = states.find(s => s.toLowerCase() === lower);
  if (match) return match;

  return null;
}

/**
 * Capitalize each word
 */
function capitalizeWords(str) {
  if (!str) return str;
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Handle a potential location response after stats question
 * @param {string} message - User's message
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @returns {object|null} Response if handled, null to continue normal flow
 */
async function handleLocationStatsResponse(message, psid, convo) {
  // Only check if we're expecting a location response
  if (!convo.pendingLocationResponse) {
    return null;
  }

  // Try to parse as location
  const location = parseLocationResponse(message);

  // Clear pending flag regardless of result (don't insist)
  await updateConversation(psid, { pendingLocationResponse: false });

  if (!location) {
    console.log("📊 Not a location response, continuing normal flow");
    return null; // Not a location, let normal flow handle it
  }

  console.log("📊 Location parsed from stats response:", location);

  // Update conversation with location
  const convoUpdate = {};
  if (location.city) convoUpdate.city = location.city;
  if (location.state) convoUpdate.stateMx = location.state;
  if (location.zipcode) convoUpdate.zipcode = location.zipcode;

  if (Object.keys(convoUpdate).length > 0) {
    await updateConversation(psid, convoUpdate);
  }

  // Also update User model for correlation
  await syncLocationToUser(psid, location, 'stats_question');

  // Generate a nice acknowledgment
  let locationStr = '';
  if (location.city && location.state) {
    locationStr = `${location.city}, ${location.state}`;
  } else if (location.city) {
    locationStr = location.city;
  } else if (location.state) {
    locationStr = location.state;
  } else if (location.zipcode) {
    locationStr = `CP ${location.zipcode}`;
  }

  const response = await generateBotResponse("location_acknowledged", {
    location: locationStr,
    convo
  });

  return {
    type: "text",
    text: response
  };
}

/**
 * Sync location data from conversation to User model
 * @param {string} psid - User's PSID (or unifiedId)
 * @param {object} location - { city, state, zipcode }
 * @param {string} source - Where the location came from
 */
async function syncLocationToUser(psid, location, source = 'conversation') {
  try {
    // Find user by psid or unifiedId
    const user = await User.findOne({
      $or: [
        { psid: psid },
        { unifiedId: psid },
        { unifiedId: `fb:${psid}` }
      ]
    });

    if (!user) {
      console.log(`📊 User not found for psid ${psid}, skipping location sync`);
      return;
    }

    // Update location
    const locationUpdate = {
      'location.updatedAt': new Date(),
      'location.source': source
    };

    if (location.city) locationUpdate['location.city'] = location.city;
    if (location.state) locationUpdate['location.state'] = location.state;
    if (location.zipcode) locationUpdate['location.zipcode'] = location.zipcode;

    await User.updateOne({ _id: user._id }, { $set: locationUpdate });
    console.log(`📊 Synced location to User: ${JSON.stringify(location)}`);
  } catch (error) {
    console.error("Error syncing location to User:", error.message);
  }
}

/**
 * Sync location from conversation to User (called when location is collected in shipping flow, etc.)
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation with city/stateMx/zipcode
 */
async function syncConversationLocationToUser(psid, convo) {
  if (!convo.city && !convo.stateMx && !convo.zipcode) return;

  const location = {
    city: convo.city || null,
    state: convo.stateMx || null,
    zipcode: convo.zipcode || null
  };

  await syncLocationToUser(psid, location, 'conversation');
}

/**
 * Sync POI (Product of Interest) from conversation to User model
 * @param {string} psid - User's PSID
 * @param {object} poiData - { productInterest, familyId, familyName, rootId, rootName }
 */
async function syncPOIToUser(psid, poiData) {
  try {
    // Find user by psid or unifiedId
    const user = await User.findOne({
      $or: [
        { psid: psid },
        { unifiedId: psid },
        { unifiedId: `fb:${psid}` }
      ]
    });

    if (!user) {
      console.log(`📊 User not found for psid ${psid}, skipping POI sync`);
      return;
    }

    // Update POI
    const poiUpdate = {
      'poi.updatedAt': new Date()
    };

    if (poiData.productInterest) poiUpdate['poi.productInterest'] = poiData.productInterest;
    if (poiData.familyId) poiUpdate['poi.familyId'] = poiData.familyId;
    if (poiData.familyName) poiUpdate['poi.familyName'] = poiData.familyName;
    if (poiData.rootId) poiUpdate['poi.rootId'] = poiData.rootId;
    if (poiData.rootName) poiUpdate['poi.rootName'] = poiData.rootName;

    await User.updateOne({ _id: user._id }, { $set: poiUpdate });
    console.log(`📊 Synced POI to User: ${poiData.productInterest || poiData.rootName}`);
  } catch (error) {
    console.error("Error syncing POI to User:", error.message);
  }
}

/**
 * Sync POI from conversation to User (called when POI is locked)
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation with productInterest, productFamilyId, poiRootId, poiRootName
 */
async function syncConversationPOIToUser(psid, convo) {
  if (!convo.productInterest && !convo.poiRootName) return;

  const poiData = {
    productInterest: convo.productInterest || null,
    familyId: convo.productFamilyId || null,
    familyName: null, // We don't always have this
    rootId: convo.poiRootId || null,
    rootName: convo.poiRootName || null
  };

  await syncPOIToUser(psid, poiData);
}

module.exports = {
  containsMLLink,
  appendStatsQuestionIfNeeded,
  appendStatsQuestionToResponse,
  shouldAskLocationStatsNow,
  askLocationStatsQuestion,
  parseLocationResponse,
  handleLocationStatsResponse,
  syncLocationToUser,
  syncConversationLocationToUser,
  syncPOIToUser,
  syncConversationPOIToUser,
  generateStatsQuestion
};
