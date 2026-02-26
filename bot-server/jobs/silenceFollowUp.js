// jobs/silenceFollowUp.js
// Auto-send store link after 10 minutes of customer silence

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { generateClickLink } = require('../tracking');
const axios = require('axios');
const { sendTextMessage: sendWhatsAppText, sendWhatsAppMessage } = require('../channels/whatsapp/api');
const { sendCatalog } = require('../utils/sendCatalog');
const { getCatalogUrl } = require('../ai/flowManager');

const STORE_URL = 'https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob';
const FOLLOW_UP_DELAY_MS = 10 * 60 * 1000; // 10 minutes

/** Flows considered wholesale — prefer catalog + pitch over ML store link */
const WHOLESALE_FLOWS = ['rollo', 'groundcover', 'monofilamento'];

const WHOLESALE_MESSAGE = `Recuerda que somos fabricantes y buscamos revendedores para ayudarlos a expandir sus negocios con un producto de la más alta calidad 100% hecho en México.

🔹 Beneficios para revendedores:
✔ Descuento por mayoreo para maximizar tu ganancia.
✔ Variedad de medidas y colores para diferentes usos.
✔ Entrega rápida y atención personalizada.

Si quieres ampliar tu catálogo con un producto rentable, contáctanos hoy mismo para recibir tu cotización especial. ¡Hagamos negocios juntos!

Te comparto nuestra lista de precios.`;

/**
 * Schedule a silence follow-up if needed.
 * Called after every bot response is sent.
 *
 * @param {string} psid - Unified conversation ID (fb:xxx or wa:xxx)
 * @param {string} botResponseText - The text the bot just sent
 */
async function scheduleFollowUpIfNeeded(psid, botResponseText) {
  const convo = await Conversation.findOne({ psid });
  if (!convo) return;

  // Skip if already sent for this conversation
  if (convo.silenceFollowUpSent) return;

  // Skip if conversation is not in a bot-active state
  if (['closed', 'needs_human', 'human_active'].includes(convo.state)) return;

  // Check if bot response contains a URL — customer already has something to click
  const hasUrl = /https?:\/\//.test(botResponseText || '');

  if (hasUrl) {
    // Cancel any pending follow-up — they already have a link
    if (convo.silenceFollowUpAt) {
      await Conversation.updateOne({ psid }, { $set: { silenceFollowUpAt: null } });
    }
    return;
  }

  // Schedule follow-up 5 minutes from now
  await Conversation.updateOne({ psid }, {
    $set: { silenceFollowUpAt: new Date(Date.now() + FOLLOW_UP_DELAY_MS) }
  });
}

/**
 * Send a message via Facebook Messenger (same pattern as conversationsRoutes)
 */
async function sendMessengerMessage(psid, text) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  await axios.post(
    'https://graph.facebook.com/v18.0/me/messages',
    {
      recipient: { id: psid },
      message: { text },
    },
    {
      headers: {
        Authorization: `Bearer ${FB_PAGE_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Periodic job: find conversations where silenceFollowUpAt has passed
 * and send the store link.
 */
async function runSilenceFollowUpJob() {
  try {
    const now = new Date();

    const conversations = await Conversation.find({
      silenceFollowUpAt: { $lte: now, $ne: null },
      silenceFollowUpSent: { $ne: true },
      state: { $in: ['active', 'new'] }
    }).lean();

    if (conversations.length === 0) return;

    console.log(`🔕 Silence follow-up job: found ${conversations.length} conversation(s) to process`);

    for (const convo of conversations) {
      try {
        // Verify user hasn't replied since the follow-up was scheduled
        const lastUserMessage = await Message.findOne({
          psid: convo.psid,
          senderType: 'user'
        }).sort({ timestamp: -1 }).lean();

        if (lastUserMessage && new Date(lastUserMessage.timestamp) > new Date(convo.silenceFollowUpAt.getTime() - FOLLOW_UP_DELAY_MS)) {
          // User replied after the bot response that triggered the schedule — skip
          // (A new bot response would have rescheduled or cleared the timer)
          // But check: did the user reply AFTER the bot response that set the timer?
          const lastBotMessage = await Message.findOne({
            psid: convo.psid,
            senderType: 'bot'
          }).sort({ timestamp: -1 }).lean();

          if (lastUserMessage && lastBotMessage &&
              new Date(lastUserMessage.timestamp) > new Date(lastBotMessage.timestamp)) {
            // User replied after last bot message — they're active, clear timer
            await Conversation.updateOne({ psid: convo.psid }, {
              $set: { silenceFollowUpAt: null }
            });
            continue;
          }
        }

        // Determine channel
        const channel = convo.channel || (convo.psid.startsWith('wa:') ? 'whatsapp' : 'facebook');
        let followUpText;

        if (WHOLESALE_FLOWS.includes(convo.currentFlow)) {
          // --- Wholesale follow-up: pitch + catalog PDF ---
          followUpText = WHOLESALE_MESSAGE;
          const catalogUrl = await getCatalogUrl(convo);

          if (channel === 'whatsapp') {
            const phone = convo.psid.replace('wa:', '');
            await sendWhatsAppText(phone, followUpText);
            if (catalogUrl) {
              await sendWhatsAppMessage(phone, {
                type: 'document',
                document: { link: catalogUrl, filename: 'Lista_Precios_Hanlob.pdf' }
              });
            }
          } else {
            const fbPsid = convo.psid.startsWith('fb:') ? convo.psid.replace('fb:', '') : convo.psid;
            if (catalogUrl) {
              await sendCatalog(fbPsid, catalogUrl, followUpText);
            } else {
              await sendMessengerMessage(fbPsid, followUpText);
            }
          }
        } else {
          // --- Default follow-up: ML store link ---
          const trackedLink = await generateClickLink(convo.psid, STORE_URL, {
            productName: 'Tienda ML (follow-up)'
          });

          followUpText =
            `Por si te interesa echar un vistazo, te comparto nuestra tienda en Mercado Libre con envío incluido a todo México:\n\n${trackedLink}`;

          if (channel === 'whatsapp') {
            const phone = convo.psid.replace('wa:', '');
            await sendWhatsAppText(phone, followUpText);
          } else {
            const fbPsid = convo.psid.startsWith('fb:') ? convo.psid.replace('fb:', '') : convo.psid;
            await sendMessengerMessage(fbPsid, followUpText);
          }
        }

        // Save as bot message
        await Message.create({
          psid: convo.psid,
          text: followUpText,
          senderType: 'bot'
        });

        // Mark as sent
        await Conversation.updateOne({ psid: convo.psid }, {
          $set: {
            silenceFollowUpSent: true,
            silenceFollowUpAt: null
          }
        });

        console.log(`✅ Silence follow-up sent to ${convo.psid} (${WHOLESALE_FLOWS.includes(convo.currentFlow) ? 'wholesale' : 'store link'})`);
      } catch (err) {
        console.error(`❌ Error sending silence follow-up to ${convo.psid}:`, err.message);
        // Clear the timer so we don't retry endlessly on a broken conversation
        await Conversation.updateOne({ psid: convo.psid }, {
          $set: { silenceFollowUpAt: null }
        });
      }
    }
  } catch (err) {
    console.error('❌ Silence follow-up job error:', err.message);
  }
}

module.exports = { scheduleFollowUpIfNeeded, runSilenceFollowUpJob };
