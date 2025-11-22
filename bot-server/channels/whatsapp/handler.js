// WhatsApp Webhook Handler
const { markMessageAsRead } = require('./api');
const { normalizeWhatsAppMessage } = require('../unified/normalizer');
const { processMessage } = require('../unified/processor');

/**
 * Verify WhatsApp webhook (GET request)
 */
function verifyWhatsAppWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('❌ WhatsApp webhook verification failed');
    res.sendStatus(403);
  }
}

/**
 * Handle incoming WhatsApp webhooks (POST request)
 * Requires Socket.IO instance to be passed from index.js
 */
async function handleWhatsAppWebhook(req, res, io = null) {
  const body = req.body;

  console.log('📱 WhatsApp webhook received');

  // Validate webhook structure
  if (body.object !== 'whatsapp_business_account') {
    console.log('⚠️ Not a WhatsApp webhook, ignoring');
    return res.sendStatus(404);
  }

  // Acknowledge receipt immediately
  res.sendStatus(200);

  // Process webhook events
  try {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Handle incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            await handleIncomingMessage(message, value.metadata, io);
          }
        }

        // Handle message status updates (delivered, read, failed)
        if (value.statuses) {
          for (const status of value.statuses) {
            handleMessageStatus(status);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing WhatsApp webhook:', error);
  }
}

/**
 * Process an incoming WhatsApp message
 */
async function handleIncomingMessage(message, metadata, io = null) {
  const messageType = message.type;

  // Only process text and interactive messages
  if (messageType !== 'text' && messageType !== 'interactive') {
    console.log(`⚠️  Unsupported WhatsApp message type: ${messageType}`);
    return;
  }

  // Mark message as read
  await markMessageAsRead(message.id);

  // Normalize message to unified format
  const normalizedMessage = normalizeWhatsAppMessage(message, metadata);

  // Pass to unified processor (connects to AI)
  await processMessage(normalizedMessage, io);
}

/**
 * Handle message status updates
 */
function handleMessageStatus(status) {
  console.log(`📊 Message status update:`, {
    messageId: status.id,
    status: status.status, // sent, delivered, read, failed
    timestamp: status.timestamp,
    recipient: status.recipient_id
  });

  // TODO: Update message status in database
}

module.exports = {
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook
};
