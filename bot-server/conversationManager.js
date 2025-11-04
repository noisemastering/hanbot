// conversationManager.js
const mongoose = require("mongoose");
const Conversation = require("./models/Conversation");

const ConversationSchema = new mongoose.Schema({
  psid: { type: String, required: true, unique: true },
  state: {
    type: String,
    default: "new",
    enum: ["new", "active", "closed", "needs_human", "human_active"] // 👈 Added human_active
  }, // new | active | closed | needs_human | human_active
  greeted: { type: Boolean, default: false },
  lastIntent: { type: String, default: null },
  lastMessageAt: { type: Date, default: Date.now },
  lastGreetTime: { type: Number, default: 0 },
  unknownCount: { type: Number, default: 0 },
  clarificationCount: { type: Number, default: 0 } // 👈 Para rastrear intentos de clarificación
});

// 🔍 Obtener (y crear si no existe)
async function getConversation(psid) {
  try {
    let convo = await Conversation.findOne({ psid });
    if (!convo) {
      convo = await Conversation.create({ psid });
      console.log(`🆕 Nueva conversación iniciada para usuario ${psid}`);
    } else {
      // Actualiza el timestamp para mantener “activa” la sesión
      convo.lastMessageAt = new Date();
      await convo.save();
    }
    return convo.toObject(); // 🔥 devuelve snapshot limpio del documento actualizado
  } catch (err) {
    console.error("❌ Error en getConversation:", err);
    return { psid, state: "new", greeted: false, lastIntent: null };
  }
}

// 💾 Actualizar conversación
async function updateConversation(psid, updates = {}) {
  try {
    await Conversation.updateOne(
      { psid },
      { $set: { ...updates, lastMessageAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error("❌ Error en updateConversation:", err);
  }
}

// 🧹 Reiniciar conversación (útil para pruebas o cierre manual)
async function resetConversation(psid) {
  try {
    await Conversation.deleteOne({ psid });
    console.log(`🧹 Conversación reiniciada para ${psid}`);
  } catch (err) {
    console.error("❌ Error en resetConversation:", err);
  }
}

module.exports = {
  getConversation,
  updateConversation,
  resetConversation,
};
