// Message debouncer to handle rapid-fire messages from users
// Waits for user to finish typing before responding

const MESSAGE_DEBOUNCE_MS = 5000; // 5 seconds

// Store timers per user
const pendingTimers = new Map();

// Store queued messages per user
const queuedMessages = new Map();

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
  }
  queuedMessages.get(psid).push(messageText);
  console.log(`📝 Queued message ${queuedMessages.get(psid).length} for ${psid}: "${messageText}"`);

  // Set new timer
  const timer = setTimeout(async () => {
    console.log(`✅ Debounce period ended for ${psid}. Processing ${queuedMessages.get(psid).length} message(s)...`);

    // Get all queued messages
    const messages = queuedMessages.get(psid) || [];

    // Clear queue and timer
    queuedMessages.delete(psid);
    pendingTimers.delete(psid);

    // Combine all messages into one (separated by newlines if multiple)
    const combinedMessage = messages.join('\n');

    // Call the callback with combined message
    await callback(combinedMessage);
  }, MESSAGE_DEBOUNCE_MS);

  pendingTimers.set(psid, timer);
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
