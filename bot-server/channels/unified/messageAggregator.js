// Message Aggregator - Batches rapid messages from same user
// Prevents chaos when users send multiple messages quickly

const DEBOUNCE_MS = 2500; // Wait 2.5 seconds for more messages
const MAX_WAIT_MS = 8000; // Maximum wait time before forcing processing

// Pending messages per user: { unifiedId: { messages: [], timer: null, firstMessageAt: Date } }
const pendingMessages = new Map();

// Processing lock per user to prevent race conditions
const processingLock = new Map();

/**
 * Add a message to the aggregation queue
 * Returns a promise that resolves when the batch is ready to process
 *
 * @param {string} unifiedId - User identifier
 * @param {object} normalizedMessage - The normalized message object
 * @returns {Promise<object|null>} Combined message or null if this message was batched with another
 */
function aggregateMessage(unifiedId, normalizedMessage) {
  return new Promise((resolve) => {
    // Check if user is currently being processed - if so, queue this message
    if (processingLock.get(unifiedId)) {
      console.log(`⏳ User ${unifiedId} is being processed, queueing message`);
      // Add to a secondary queue that will be checked after current processing
      const existing = pendingMessages.get(unifiedId);
      if (existing) {
        existing.messages.push(normalizedMessage);
        existing.resolvers.push(resolve);
      } else {
        pendingMessages.set(unifiedId, {
          messages: [normalizedMessage],
          timer: null,
          firstMessageAt: Date.now(),
          resolvers: [resolve]
        });
      }
      return;
    }

    const existing = pendingMessages.get(unifiedId);

    if (existing) {
      // Add to existing batch
      console.log(`📦 Adding message to batch for ${unifiedId} (now ${existing.messages.length + 1} messages)`);
      existing.messages.push(normalizedMessage);
      existing.resolvers.push(resolve);

      // Clear existing timer
      if (existing.timer) {
        clearTimeout(existing.timer);
      }

      // Check if we've hit max wait time
      const elapsed = Date.now() - existing.firstMessageAt;
      if (elapsed >= MAX_WAIT_MS) {
        console.log(`⏰ Max wait time reached for ${unifiedId}, processing batch`);
        processBatch(unifiedId);
        return;
      }

      // Reset debounce timer
      existing.timer = setTimeout(() => processBatch(unifiedId), DEBOUNCE_MS);
    } else {
      // Start new batch
      console.log(`📦 Starting new message batch for ${unifiedId}`);
      pendingMessages.set(unifiedId, {
        messages: [normalizedMessage],
        timer: setTimeout(() => processBatch(unifiedId), DEBOUNCE_MS),
        firstMessageAt: Date.now(),
        resolvers: [resolve]
      });
    }
  });
}

/**
 * Process a batch of messages
 */
function processBatch(unifiedId) {
  const batch = pendingMessages.get(unifiedId);
  if (!batch) return;

  pendingMessages.delete(unifiedId);

  if (batch.timer) {
    clearTimeout(batch.timer);
  }

  const messages = batch.messages;
  const resolvers = batch.resolvers;

  if (messages.length === 0) {
    resolvers.forEach(r => r(null));
    return;
  }

  // Combine all message texts
  const combinedText = messages.map(m => m.text).filter(Boolean).join('\n');

  // Use first message as base, but with combined text
  const combinedMessage = {
    ...messages[0],
    text: combinedText,
    originalMessages: messages,
    isBatched: messages.length > 1
  };

  if (messages.length > 1) {
    console.log(`📬 Batch ready for ${unifiedId}: ${messages.length} messages combined`);
    console.log(`   Combined text: "${combinedText.substring(0, 100)}${combinedText.length > 100 ? '...' : ''}"`);
  }

  // Resolve the first message's promise with the combined message
  // All others get null (they were batched)
  resolvers[0](combinedMessage);
  for (let i = 1; i < resolvers.length; i++) {
    resolvers[i](null); // These messages were batched, don't process separately
  }
}

/**
 * Set processing lock for a user (call before generating AI response)
 */
function setProcessingLock(unifiedId) {
  processingLock.set(unifiedId, true);
}

/**
 * Clear processing lock and check for queued messages
 * @returns {object|null} Any messages that arrived during processing
 */
function clearProcessingLock(unifiedId) {
  processingLock.delete(unifiedId);

  // Check if new messages arrived while we were processing
  const queued = pendingMessages.get(unifiedId);
  if (queued && queued.messages.length > 0) {
    console.log(`🔔 ${queued.messages.length} new message(s) arrived while processing for ${unifiedId}`);
    return queued;
  }
  return null;
}

/**
 * Check if there are pending messages for a user
 * Call this before sending a response to see if we should wait
 */
function hasPendingMessages(unifiedId) {
  const pending = pendingMessages.get(unifiedId);
  return pending && pending.messages.length > 0;
}

/**
 * Get count of pending messages
 */
function getPendingCount(unifiedId) {
  const pending = pendingMessages.get(unifiedId);
  return pending ? pending.messages.length : 0;
}

module.exports = {
  aggregateMessage,
  setProcessingLock,
  clearProcessingLock,
  hasPendingMessages,
  getPendingCount,
  DEBOUNCE_MS,
  MAX_WAIT_MS
};
