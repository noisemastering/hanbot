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

  // Extract referral from Click-to-WhatsApp ads
  // When user clicks a CTWA ad, first message includes referral with:
  // - source_type: "ad"
  // - source_id: the ad ID
  // - source_url: the ad URL
  // - headline: ad headline
  // - body: ad body text
  const referral = message.referral || null;
  if (referral) {
    console.log(`📣 WhatsApp CTWA referral detected:`, {
      source_type: referral.source_type,
      source_id: referral.source_id,
      headline: referral.headline
    });
  }

  return {
    channel: 'whatsapp',
    unifiedId: `wa:${senderPhone}`,
    userId: senderPhone,
    messageId: message.id,
    text: text,
    timestamp: message.timestamp * 1000, // Convert to milliseconds
    referral: referral,
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
