const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  psid: { type: String, required: true },          // ID del usuario en Messenger
  text: { type: String, required: true },          // Texto del mensaje recibido
  senderType: { type: String, enum: ['user', 'bot', 'human'], required: true },
  messageId: { type: String, sparse: true, unique: true }, // Facebook message ID for deduplication (mid)
  timestamp: { type: Date, default: Date.now },    // Fecha y hora
  answered: { type: Boolean, default: false }      // True if user message was answered by bot/human
});

module.exports = mongoose.model('Message', messageSchema);
