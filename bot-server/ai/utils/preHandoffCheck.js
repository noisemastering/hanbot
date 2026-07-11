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
 * UNIFIED PRE-HANDOFF CHECKLIST.
 * Collects three fields before handing off to a human: name, zip code,
 * quantity. The agent then sees all of them in the buildClientBrief
 * push notification instead of starting from scratch.
 *
 * Logic per call:
 *  1. Try to extract any of (name, zip, qty) from the current message
 *  2. Save whatever was extracted
 *  3. Recompute what's still missing
 *  4. If everything is present → return null (executeHandoff completes)
 *  5. If anything is missing → ask for the missing fields, set
 *     pendingHandoff so the next message resumes
 *  6. After 2 ask cycles, give up and proceed with what we have (don't
 *     loop forever if the customer ignores or only partially answers).
 *
 * @param {string} psid
 * @param {object} convo
 * @param {string} userMessage
 * @param {object} handoffInfo - { reason, specsText }
 * @returns {object|null} response object if we need to ask, null if handoff should proceed
 */
async function checkZipBeforeHandoff(psid, convo, userMessage, handoffInfo = {}) {
  // 1. Try to extract from current message (AI for name/qty; regex+DB for zip)
  const { extractPreHandoffData } = require("./preHandoffExtractor");
  const aiExtract = await extractPreHandoffData(userMessage);
  const zipInfo = await parseAndLookupZipCode(userMessage);
  const cityInfo = !zipInfo ? detectMexicanLocation(userMessage) : null;

  const updates = {};
  if (aiExtract.name && !(convo?.customerName || convo?.extractedName || convo?.userName)) {
    updates.customerName = aiExtract.name;
  }
  if (zipInfo) {
    updates.zipCode = zipInfo.code;
    updates.city = zipInfo.city;
    updates.stateMx = zipInfo.state;
  } else if (aiExtract.zip && !convo?.zipCode) {
    updates.zipCode = aiExtract.zip;
  } else if (cityInfo) {
    updates.city = cityInfo.normalized || cityInfo.location;
    updates.stateMx = cityInfo.state;
  }
  if (aiExtract.quantity && !(convo?.customOrderQuantity || convo?.productSpecs?.quantity)) {
    updates.customOrderQuantity = aiExtract.quantity;
    const newSpecs = { ...(convo?.productSpecs || {}), quantity: aiExtract.quantity };
    updates.productSpecs = newSpecs;
  }
  if (Object.keys(updates).length > 0) {
    await updateConversation(psid, updates);
    Object.assign(convo, updates);
  }

  // 2. What's still missing?
  const hasName = !!(convo.customerName || convo.extractedName || convo.userName);
  const hasZipOrCity = !!(convo.zipCode || convo.city);
  const hasQuantity = !!(convo.customOrderQuantity || convo.productSpecs?.quantity);

  const missing = [];
  if (!hasName) missing.push('Nombre');
  if (!hasZipOrCity) missing.push('Código postal o ciudad');
  if (!hasQuantity) missing.push('Cantidad de piezas');

  // 3. All collected — proceed
  if (missing.length === 0) {
    if (convo.preHandoffAttempts) {
      await updateConversation(psid, { preHandoffAttempts: 0 });
    }
    return null;
  }

  // 4. After 2 ask cycles, give up and proceed
  const attempts = (convo.preHandoffAttempts || 0);
  if (attempts >= 2) {
    console.log(`📋 preHandoff: max attempts reached, proceeding with partial data (missing: ${missing.join(', ')})`);
    await updateConversation(psid, { preHandoffAttempts: 0, pendingHandoff: false, pendingHandoffInfo: null, pendingHandoffAt: null });
    return null;
  }

  // 5. Ask for missing fields
  await updateConversation(psid, {
    pendingHandoff: true,
    pendingHandoffInfo: handoffInfo,
    preHandoffAttempts: attempts + 1,
    pendingHandoffAt: new Date(), // 30s timeout: escalate anyway if the client goes silent
    pendingHandoffReason: handoffInfo.reason || 'Cliente requiere asesor',
  });

  const introText = attempts === 0
    ? 'Para canalizarte con el asesor adecuado y agilizar tu cotización, por favor compártenos:'
    : 'Aún me faltan estos datos para canalizarte:';
  return {
    type: "text",
    text: `${introText}\n${missing.map(m => `• ${m}`).join('\n')}`
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
  // Reuse the unified pre-handoff checker. If it returns null, all data
  // collected → proceed. If it returns a response, we're still gathering.
  const askResponse = await checkZipBeforeHandoff(psid, convo, userMessage, convo.pendingHandoffInfo || {});
  if (!askResponse) {
    // All data collected, proceed
    await updateConversation(psid, { pendingHandoff: false, pendingHandoffInfo: null, pendingHandoffAt: null });
    const zipInfo = convo.zipCode ? { code: convo.zipCode, city: convo.city, state: convo.stateMx }
      : convo.city ? { city: convo.city, state: convo.stateMx } : null;
    return { proceed: true, zipInfo };
  }

  // Still gathering — return the ask back to convoFlow
  return { proceed: false, stillWaiting: true, response: askResponse };
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
