// Message debouncer to handle rapid-fire messages from users
// Waits for user to finish typing before responding

const MESSAGE_DEBOUNCE_MS = 3000; // 3 seconds - wait for more messages
const MAX_WAIT_MS = 8000; // 8 seconds max wait before forcing processing

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

  // Call the callback with combined message
  await callback(combinedMessage);
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
