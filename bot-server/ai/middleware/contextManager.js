// ai/middleware/contextManager.js
// Context Manager Protocol — retrieves full conversation history and formats it
// for injection into model flow AI prompts. No flow retrieves history on its own;
// convoFlow calls this once and passes the result through the context object.

const Message = require('../../models/Message');

/**
 * Retrieve full conversation history for a PSID and format as a transcript.
 * @param {string} psid
 * @returns {Promise<string>} Formatted transcript string (empty string if no history)
 */
async function getConversationContext(psid) {
  try {
    const messages = await Message.find({ psid })
      .sort({ timestamp: 1 })
      .select('text senderType timestamp')
      .lean();

    if (!messages.length) return '';

    const transcript = messages.map(msg => {
      const role = msg.senderType === 'user' ? 'Cliente'
        : msg.senderType === 'human' ? 'Asesor humano'
        : 'Tú (bot)';
      return `${role}: ${msg.text}`;
    }).join('\n');

    return [
      '\n\n📜 HISTORIAL DE LA CONVERSACIÓN:',
      transcript,
      '',
      '⚠️ IMPORTANTE:',
      '- Usa este historial para entender el contexto completo de la conversación.',
      '- NO repitas información que ya le dijiste al cliente.',
      '- El mensaje actual del cliente es el que debes responder — NO respondas mensajes anteriores.',
      '- Si el cliente ya pidió algo específico antes, recuérdalo.'
    ].join('\n');
  } catch (err) {
    console.error('❌ [contextManager] Error fetching history:', err.message);
    return '';
  }
}

module.exports = { getConversationContext };
