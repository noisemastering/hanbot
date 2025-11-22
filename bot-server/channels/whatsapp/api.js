// WhatsApp Cloud API Client
const axios = require('axios');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Get WhatsApp configuration from environment
 */
function getWhatsAppConfig() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN
  };
}

/**
 * Send a WhatsApp message (base function)
 */
async function sendWhatsAppMessage(recipientPhone, messageData) {
  const config = getWhatsAppConfig();

  if (!config.phoneNumberId || !config.accessToken) {
    console.error('❌ WhatsApp credentials not configured');
    throw new Error('WhatsApp credentials missing');
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        ...messageData
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ WhatsApp message sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send a text message
 */
async function sendTextMessage(recipientPhone, text) {
  return sendWhatsAppMessage(recipientPhone, {
    type: 'text',
    text: { body: text }
  });
}

/**
 * Send an image with optional caption
 */
async function sendImageMessage(recipientPhone, imageUrl, caption = null) {
  const imageData = {
    type: 'image',
    image: { link: imageUrl }
  };

  if (caption) {
    imageData.image.caption = caption;
  }

  return sendWhatsAppMessage(recipientPhone, imageData);
}

/**
 * Mark a message as read
 */
async function markMessageAsRead(messageId) {
  const config = getWhatsAppConfig();

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('❌ Error marking message as read:', error.message);
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendTextMessage,
  sendImageMessage,
  markMessageAsRead,
  getWhatsAppConfig
};
