// utils/sendCatalog.js
// Utility for sending catalog PDFs via Messenger

const axios = require('axios');

/**
 * Send a catalog PDF to a user via Facebook Messenger
 *
 * @param {string} psid - User's Page-Scoped ID
 * @param {string} catalogUrl - URL to the PDF file
 * @param {string} [introText] - Optional text to send before the file
 * @returns {Promise<object>} Result of send operations
 */
async function sendCatalog(psid, catalogUrl, introText = null) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
  const results = { textSent: false, fileSent: false, errors: [] };

  try {
    // Send intro text if provided
    if (introText) {
      try {
        await axios.post(
          "https://graph.facebook.com/v18.0/me/messages",
          {
            recipient: { id: psid },
            message: { text: introText }
          },
          {
            headers: {
              Authorization: `Bearer ${FB_PAGE_TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );
        results.textSent = true;
        console.log(`📝 Intro text sent to ${psid}`);
      } catch (error) {
        console.error('Error sending intro text:', error.response?.data || error.message);
        results.errors.push({ type: 'text', error: error.response?.data || error.message });
      }
    }

    // Send the PDF file
    try {
      await axios.post(
        "https://graph.facebook.com/v18.0/me/messages",
        {
          recipient: { id: psid },
          message: {
            attachment: {
              type: "file",
              payload: {
                url: catalogUrl,
                is_reusable: true
              }
            }
          }
        },
        {
          headers: {
            Authorization: `Bearer ${FB_PAGE_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
      results.fileSent = true;
      console.log(`📄 Catalog PDF sent to ${psid}: ${catalogUrl}`);
    } catch (error) {
      console.error('Error sending catalog PDF:', error.response?.data || error.message);
      results.errors.push({ type: 'file', error: error.response?.data || error.message });
    }

    return results;
  } catch (error) {
    console.error('Error in sendCatalog:', error);
    results.errors.push({ type: 'general', error: error.message });
    return results;
  }
}

/**
 * Check if a campaign/ad has a catalog available
 *
 * @param {object} settings - Resolved campaign settings from campaignResolver
 * @returns {object|null} Catalog info or null
 */
function getCatalogFromSettings(settings) {
  if (!settings) return null;
  return settings.catalog || null;
}

module.exports = {
  sendCatalog,
  getCatalogFromSettings
};
