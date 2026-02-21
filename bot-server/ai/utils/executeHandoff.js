// ai/utils/executeHandoff.js
// Centralized pre-handoff checklist: zip collection, state update, push notification, timing message, Queretaro pickup
//
// EVERY handoff in the bot should go through executeHandoff() or resumePendingHandoff().

const { updateConversation } = require("../../conversationManager");
const { sendHandoffNotification } = require("../../services/pushNotifications");
const { getHandoffTimingMessage, isBusinessHours, getNextBusinessTimeStr } = require("./businessHours");
const { checkZipBeforeHandoff, handlePendingZipResponse, isQueretaroLocation, getQueretaroPickupMessage } = require("./preHandoffCheck");

/**
 * Centralized handoff executor.
 * Runs pre-handoff checklist (zip collection), marks handoff, sends push notification, builds response.
 *
 * @param {string} psid
 * @param {object} convo
 * @param {string} userMessage
 * @param {object} options
 * @param {string}  options.reason           - (required) Handoff reason for dashboard
 * @param {string}  [options.responsePrefix] - Text BEFORE timing message ("Tu pedido ha sido registrado.")
 * @param {string}  [options.specsText]      - Context saved for pending handoff ("Malla de 10x12m. ")
 * @param {string}  [options.followUp]       - Separate follow-up message (YouTube video)
 * @param {object}  [options.extraState]     - Additional updateConversation fields ({wholesaleRequest: ...})
 * @param {string}  [options.lastIntent]     - Override lastIntent (default: 'handoff')
 * @param {boolean} [options.skipChecklist]  - Skip zip collection (for frustration, explicit human request, etc.)
 * @param {string}  [options.notificationText] - Override push notification text
 * @param {boolean} [options.includeQueretaro] - Append pickup message if Queretaro (default: true)
 * @param {boolean} [options.includeVideo]     - Append malla sombra video (default: false)
 * @param {string}  [options.timingStyle]      - 'standard' | 'elaborate' | 'none' (default: 'standard')
 * @returns {Promise<object>} Response object { type: "text", text, followUp? }
 */
async function executeHandoff(psid, convo, userMessage, options = {}) {
  const {
    reason,
    responsePrefix = '',
    specsText = '',
    followUp = null,
    extraState = null,
    lastIntent = 'handoff',
    skipChecklist = false,
    notificationText = null,
    includeQueretaro = true,
    includeVideo = false,
    timingStyle = 'standard',
  } = options;

  // ── Step 1: Pre-handoff zip check (unless skipped) ──
  if (!skipChecklist) {
    const zipAsk = await checkZipBeforeHandoff(psid, convo, userMessage, {
      reason,
      specsText
    });
    if (zipAsk) return zipAsk;
  }

  // ── Step 2: Mark conversation as needing human ──
  const stateUpdate = {
    handoffRequested: true,
    handoffReason: reason,
    handoffTimestamp: new Date(),
    state: "needs_human",
    lastIntent,
    unknownCount: 0,
    ...(extraState || {})
  };
  await updateConversation(psid, stateUpdate);

  // ── Step 3: Push notification ──
  const notifText = notificationText || reason;
  sendHandoffNotification(psid, convo, notifText).catch(err => {
    console.error("❌ Failed to send push notification:", err);
  });

  // ── Step 4: Build response text ──
  let text = responsePrefix;

  // Timing message
  if (timingStyle === 'standard') {
    text += getHandoffTimingMessage();
  } else if (timingStyle === 'elaborate') {
    if (isBusinessHours()) {
      text += "Un especialista te contactará pronto.";
    } else {
      text += `Un especialista te contactará el siguiente día hábil en horario de atención (lunes a viernes 9am-6pm).`;
    }
  }
  // timingStyle === 'none' → no timing appended

  // Queretaro pickup
  if (includeQueretaro && isQueretaroLocation(null, convo)) {
    const pickupMsg = await getQueretaroPickupMessage();
    text += `\n\n${pickupMsg}`;
  }

  // Malla sombra video
  if (includeVideo) {
    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    text += `\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`;
  }

  const response = { type: "text", text };
  if (followUp) {
    response.followUp = followUp;
  }

  return response;
}

/**
 * Handle user's zip/city response after a previous executeHandoff asked for it.
 * Call this at the top of flow handlers when convo.pendingHandoff === true.
 * Returns null if pendingHandoff is not set.
 *
 * @param {string} psid
 * @param {object} convo
 * @param {string} userMessage
 * @returns {Promise<object|null>} Response object or null
 */
async function resumePendingHandoff(psid, convo, userMessage) {
  if (!convo?.pendingHandoff) return null;

  console.log(`📍 resumePendingHandoff — processing zip/city response`);

  const zipResult = await handlePendingZipResponse(psid, convo, userMessage);
  if (!zipResult.proceed) return null;

  const info = convo.pendingHandoffInfo || {};

  // Mark handoff
  await updateConversation(psid, {
    handoffRequested: true,
    handoffReason: info.reason || 'Handoff after zip collection',
    handoffTimestamp: new Date(),
    state: "needs_human"
  });

  // Location acknowledgment
  const locationAck = zipResult.zipInfo
    ? `Perfecto, ${zipResult.zipInfo.city || 'ubicación registrada'}. `
    : '';

  // Timing
  const timingMsg = getHandoffTimingMessage();

  let text = `${locationAck}${info.specsText || ''}${timingMsg}`;

  // Queretaro pickup
  if (isQueretaroLocation(zipResult.zipInfo, convo)) {
    const pickupMsg = await getQueretaroPickupMessage();
    text += `\n\n${pickupMsg}`;
  }

  // Push notification
  sendHandoffNotification(psid, convo, info.reason || 'Handoff after zip collection').catch(err => {
    console.error("❌ Failed to send push notification:", err);
  });

  return { type: "text", text };
}

module.exports = { executeHandoff, resumePendingHandoff };
