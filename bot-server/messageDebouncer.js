// Message debouncer to handle rapid-fire messages from users
// Waits for user to finish typing before responding

const MESSAGE_DEBOUNCE_MS = 10000; // 10 seconds - wait for more messages
const MAX_WAIT_MS = 20000; // 20 seconds max wait before forcing processing

// Store timers per user
const pendingTimers = new Map();

// Store queued messages per user
const queuedMessages = new Map();

// Track when first message arrived (for max wait)
const firstMessageTime = new Map();

/**
 * Debounce incoming messages to wait for user to finish typing
 * @param {string} psid - User's PSID
 * @param {string} messageText - The message text
 * @param {Function} callback - Function to call when debounce period expires
 */
function debounceMessage(psid, messageText, callback) {
  // Clear existing timer if any
  if (pendingTimers.has(psid)) {
    console.log(`⏱️  Resetting debounce timer for ${psid} (user still typing...)`);
    clearTimeout(pendingTimers.get(psid));
  }

  // Add message to queue
  if (!queuedMessages.has(psid)) {
    queuedMessages.set(psid, []);
    firstMessageTime.set(psid, Date.now());
  }
  queuedMessages.get(psid).push(messageText);
  console.log(`📝 Queued message ${queuedMessages.get(psid).length} for ${psid}: "${messageText}"`);

  // Check if we've exceeded max wait time
  const elapsed = Date.now() - firstMessageTime.get(psid);
  if (elapsed >= MAX_WAIT_MS) {
    console.log(`⏰ Max wait time reached for ${psid}, processing immediately`);
    processQueue(psid, callback);
    return;
  }

  // Set new timer (remaining time capped at debounce interval)
  const remainingMaxWait = MAX_WAIT_MS - elapsed;
  const waitTime = Math.min(MESSAGE_DEBOUNCE_MS, remainingMaxWait);

  const timer = setTimeout(() => processQueue(psid, callback), waitTime);
  pendingTimers.set(psid, timer);
}

/**
 * Process the queued messages for a user
 */
async function processQueue(psid, callback) {
  console.log(`✅ Debounce period ended for ${psid}. Processing ${queuedMessages.get(psid)?.length || 0} message(s)...`);

  // Get all queued messages
  const messages = queuedMessages.get(psid) || [];

  // Clear queue and timer
  queuedMessages.delete(psid);
  pendingTimers.delete(psid);
  firstMessageTime.delete(psid);

  if (messages.length === 0) return;

  // Combine all messages into one (separated by newlines if multiple)
  const combinedMessage = messages.join('\n');

  // Call the callback with combined message.
  //
  // The try/catch is load-bearing: this runs inside a setTimeout, so a throw here is an
  // UNHANDLED REJECTION — which in modern Node takes the whole process down, loses every
  // other pending timer with it, and leaves the customer with no reply and no record.
  // The queue is already cleared above, so nothing retries it either. That is the shape
  // of the silence reported on 2026-10-26 (psid 24149409157993042: two messages saved
  // with real mids, no answer, nothing in the logs to say why).
  //
  // Catching it here does NOT rescue the turn by itself — jobs/unansweredSweep.js does
  // that, by re-reading what was never answered. This just stops one bad turn from
  // becoming an outage.
  try {
    await callback(combinedMessage);
  } catch (err) {
    console.error(`❌ debounced reply failed for ${psid}:`, err && err.message);
    try {
      const Conversation = require('./models/Conversation');
      await Conversation.updateOne({ psid }, {
        $set: { lastSilentTurn: { at: new Date(), why: `debounced reply threw: ${String(err && err.message).slice(0, 200)}`, msg: combinedMessage.slice(0, 200) } },
      });
    } catch (e) {
      console.error('⚠️ could not record the dropped turn:', e.message);
    }
  }
}

/**
 * Cancel debounce for a user (e.g., if human takes over)
 * @param {string} psid - User's PSID
 */
function cancelDebounce(psid) {
  if (pendingTimers.has(psid)) {
    clearTimeout(pendingTimers.get(psid));
    pendingTimers.delete(psid);
  }
  if (queuedMessages.has(psid)) {
    queuedMessages.delete(psid);
  }
  console.log(`🚫 Cancelled debounce for ${psid}`);
}

/**
 * Check if user has pending messages
 * @param {string} psid - User's PSID
 * @returns {boolean}
 */
function hasPendingMessages(psid) {
  return pendingTimers.has(psid);
}

module.exports = {
  debounceMessage,
  cancelDebounce,
  hasPendingMessages
};
