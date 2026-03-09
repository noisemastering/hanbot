// ai/utils/preHandoffCheck.js
// Centralized pre-handoff interceptor for zip code / city collection
// Only triggers on human-agent handoffs (wholesale, no ML link, custom sizes, etc.)

const { updateConversation } = require("../../conversationManager");
const ZipCode = require("../../models/ZipCode");
const { detectMexicanLocation } = require("../../mexicanLocations");
const { getBusinessInfo } = require("../../businessInfoManager");

/**
 * Parse zip code from message and look up location (shared utility)
 * Patterns: CP 12345, C.P. 12345, cp12345, al 12345, codigo postal 12345
 * @param {string} msg - User message
 * @returns {Promise<object|null>} { code, city, state, municipality, shipping } or null
 */
async function parseAndLookupZipCode(msg) {
  if (!msg) return null;

  const patterns = [
    /\b(?:c\.?p\.?|codigo\s*postal|cp)\s*[:\.]?\s*(\d{5})\b/i,
    /\bal\s+(\d{5})\b/i,
    /\b(\d{5})\b(?=\s*(?:$|,|\.|\s+(?:para|en|a)\b))/i,
    /\b(\d{5})\b/  // Fallback: any 5-digit number
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const code = match[1];
      try {
        const location = await ZipCode.lookup(code);
        if (location) {
          console.log(`📍 Zip code ${code} → ${location.city}, ${location.state}`);
          return location;
        }
      } catch (err) {
        console.error(`❌ Zip code lookup failed:`, err.message);
      }
    }
  }

  return null;
}

/**
 * Check if we should ask for zip/city before handing off.
 * Call this just before setting state: "needs_human".
 *
 * @param {string} psid - User PSID
 * @param {object} convo - Conversation object
 * @param {string} userMessage - Current user message
 * @param {object} handoffInfo - { reason, specsText } context for the pending handoff
 * @returns {object|null} Response object if we need to ask for zip, null if handoff should proceed
 */
async function checkZipBeforeHandoff(psid, convo, userMessage, handoffInfo = {}) {
  // Already have location info — proceed with handoff
  if (convo?.zipCode || convo?.city) {
    return null;
  }

  // Try to extract from the current message before asking
  const zipInfo = await parseAndLookupZipCode(userMessage);
  if (zipInfo) {
    await updateConversation(psid, {
      zipCode: zipInfo.code,
      city: zipInfo.city,
      stateMx: zipInfo.state
    });
    return null; // Proceed with handoff
  }

  // Try city detection from current message
  const locationDetected = detectMexicanLocation(userMessage);
  if (locationDetected) {
    await updateConversation(psid, {
      city: locationDetected.normalized || locationDetected.location,
      stateMx: locationDetected.state
    });
    return null; // Proceed with handoff
  }

  // Note: we don't use isLikelyLocationName here because this is the FIRST check
  // — the user hasn't been asked for location yet, so a short message could be anything.
  // The fuzzy fallback is in handlePendingZipResponse (AFTER we've asked).

  // No location info — save pending handoff and ask
  await updateConversation(psid, {
    pendingHandoff: true,
    pendingHandoffInfo: handoffInfo
  });

  return {
    type: "text",
    text: "Para calcular el envío, ¿me compartes tu código postal o ciudad?"
  };
}

/**
 * Handle a response when we're waiting for zip/city info before handoff.
 * Call this at the top of flow handlers when convo.pendingHandoff === true.
 *
 * @param {string} psid - User PSID
 * @param {object} convo - Conversation object
 * @param {string} userMessage - User's response
 * @returns {object} { proceed: true, zipInfo: object|null }
 */
async function handlePendingZipResponse(psid, convo, userMessage) {
  // Try to parse zip code
  const zipInfo = await parseAndLookupZipCode(userMessage);
  if (zipInfo) {
    await updateConversation(psid, {
      zipCode: zipInfo.code,
      city: zipInfo.city,
      stateMx: zipInfo.state,
      pendingHandoff: false,
      pendingHandoffInfo: null
    });
    return { proceed: true, zipInfo };
  }

  // Try city detection
  const locationDetected = detectMexicanLocation(userMessage);
  if (locationDetected) {
    await updateConversation(psid, {
      city: locationDetected.normalized || locationDetected.location,
      stateMx: locationDetected.state,
      pendingHandoff: false,
      pendingHandoffInfo: null
    });
    return { proceed: true, zipInfo: { city: locationDetected.normalized || locationDetected.location, state: locationDetected.state } };
  }

  // Fuzzy fallback: if message looks like a location name (short, no product words),
  // accept it as-is to avoid asking for zip again in a loop
  const { isLikelyLocationName } = require("../../mexicanLocations");
  if (isLikelyLocationName(userMessage)) {
    const cityName = userMessage.trim();
    console.log(`📍 Accepting unrecognized location as-is: "${cityName}"`);
    await updateConversation(psid, {
      city: cityName,
      pendingHandoff: false,
      pendingHandoffInfo: null
    });
    return { proceed: true, zipInfo: { city: cityName } };
  }

  // Couldn't parse location — customer is probably asking something else.
  // Clear pendingHandoff so we don't loop, but DON'T proceed with handoff.
  // Let the flow handle the message normally; zip ask will recur on next handoff.
  await updateConversation(psid, {
    pendingHandoff: false,
    pendingHandoffInfo: null
  });
  return { proceed: false };
}

/**
 * Check if a location is in Queretaro (state or city)
 * @param {object|null} zipInfo - { city, state } from zip lookup
 * @param {object|null} convo - Conversation object (fallback to stateMx/city)
 * @returns {boolean}
 */
function isQueretaroLocation(zipInfo, convo) {
  const qroPattern = /quer[eé]taro/i;
  const qroCityPattern = /quer[eé]taro|santiago.*quer[eé]taro/i;

  if (zipInfo?.state && qroPattern.test(zipInfo.state)) return true;
  if (zipInfo?.city && qroCityPattern.test(zipInfo.city)) return true;
  if (convo?.stateMx && qroPattern.test(convo.stateMx)) return true;
  if (convo?.city && qroCityPattern.test(convo.city)) return true;

  return false;
}

/**
 * Get the Queretaro pickup message with business address and hours
 * @returns {Promise<string>}
 */
async function getQueretaroPickupMessage() {
  const info = await getBusinessInfo();
  let msg = "Como estás en Querétaro, también puedes recoger directamente en nuestra bodega:";
  if (info.address) msg += `\n📍 ${info.address}`;
  if (info.hours) msg += `\n🕓 ${info.hours}`;
  return msg;
}

module.exports = { parseAndLookupZipCode, checkZipBeforeHandoff, handlePendingZipResponse, isQueretaroLocation, getQueretaroPickupMessage };
