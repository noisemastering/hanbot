// Message Normalizer - Converts platform-specific messages to unified format

/**
 * Normalize Facebook Messenger message to unified format
 */
function normalizeFacebookMessage(webhookEvent) {
  const senderPsid = webhookEvent.sender.id;
  const recipientPsid = webhookEvent.recipient?.id;
  const FB_PAGE_ID = process.env.FB_PAGE_ID;

  const isFromPage = senderPsid === FB_PAGE_ID;

  return {
    channel: 'facebook',
    unifiedId: `fb:${senderPsid}`,
    userId: senderPsid,
    messageId: webhookEvent.message?.mid,
    text: webhookEvent.message?.text || null,
    timestamp: webhookEvent.timestamp,
    referral: webhookEvent.referral || webhookEvent.postback?.referral,
    isFromPage: isFromPage,
    recipientId: isFromPage ? recipientPsid : null,
    raw: webhookEvent
  };
}

/**
 * Normalize WhatsApp message to unified format
 */
function normalizeWhatsAppMessage(message, metadata) {
  const senderPhone = message.from;

  // Extract text based on message type
  let text = null;
  if (message.type === 'text') {
    text = message.text.body;
  } else if (message.type === 'interactive') {
    // Button or list reply
    text = message.interactive.button_reply?.title ||
           message.interactive.list_reply?.title;
  }

  return {
    channel: 'whatsapp',
    unifiedId: `wa:${senderPhone}`,
    userId: senderPhone,
    messageId: message.id,
    text: text,
    timestamp: message.timestamp * 1000, // Convert to milliseconds
    referral: null, // WhatsApp doesn't have referral tracking like FB
    isFromPage: false, // WhatsApp messages are always from users (business can't initiate)
    recipientId: metadata.phone_number_id,
    raw: message
  };
}

/**
 * Get channel from unified ID
 */
function getChannelFromUnifiedId(unifiedId) {
  if (unifiedId.startsWith('fb:')) return 'facebook';
  if (unifiedId.startsWith('wa:')) return 'whatsapp';
  return null;
}

/**
 * Extract user ID from unified ID
 */
function getUserIdFromUnifiedId(unifiedId) {
  const parts = unifiedId.split(':');
  return parts.length > 1 ? parts[1] : unifiedId;
}

module.exports = {
  normalizeFacebookMessage,
  normalizeWhatsAppMessage,
  getChannelFromUnifiedId,
  getUserIdFromUnifiedId
};
