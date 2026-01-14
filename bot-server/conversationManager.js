// conversationManager.js
const mongoose = require("mongoose");
const Conversation = require("./models/Conversation");
const User = require("./models/User");

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
  clarificationCount: { type: Number, default: 0 }, // 👈 Para rastrear intentos de clarificación
  agentTookOverAt: { type: Date, default: null } // 👈 Timestamp when human agent took over
});

// 🔍 Obtener (y crear si no existe)
async function getConversation(psid) {
  try {
    let convo = await Conversation.findOne({ psid });
    if (!convo) {
      convo = await Conversation.create({ psid });
      console.log(`🆕 Nueva conversación iniciada para usuario ${psid}`);
    } else {
      // Actualiza el timestamp para mantener "activa" la sesión
      convo.lastMessageAt = new Date();
      await convo.save();
    }

    // Fetch user's name from User model
    const convoObj = convo.toObject();
    try {
      const user = await User.findOne({ psid });
      if (user && user.first_name) {
        convoObj.userName = user.first_name;
      }
    } catch (userErr) {
      console.log("⚠️ Could not fetch user name:", userErr.message);
    }

    return convoObj; // 🔥 devuelve snapshot limpio del documento actualizado
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

// 🤝 Check if human agent is currently handling this conversation
// Returns true if human took over within last 2 hours OR if last message was from human
// Also returns true if conversation needs_human (custom orders, handoff requests)
async function isHumanActive(psid) {
  try {
    const convo = await Conversation.findOne({ psid });

    // Check if conversation is waiting for human (custom orders, explicit handoff)
    // Bot should NEVER respond when needs_human - only human can clear this state
    if (convo && convo.state === "needs_human") {
      console.log(`🚨 Conversation needs human attention (state: needs_human). Bot will not respond.`);
      return true;
    }

    // Check if conversation state is human_active with timestamp
    if (convo && convo.state === "human_active" && convo.agentTookOverAt) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (convo.agentTookOverAt > twoHoursAgo) {
        console.log(`👨‍💼 Human is still active (took over ${Math.round((Date.now() - convo.agentTookOverAt.getTime()) / 60000)} minutes ago)`);
        return true;
      } else {
        // More than 2 hours passed, auto-resume bot
        console.log(`🤖 Auto-resuming bot after 2+ hours of human inactivity`);
        await updateConversation(psid, {
          state: "active",
          lastIntent: "bot_resumed",
          agentTookOverAt: null
        });
        return false;
      }
    }

    // ALWAYS check message history - even if state isn't human_active
    // This catches cases where human message wasn't detected via webhook
    const Message = require('./models/Message');
    const lastMessage = await Message.findOne({ psid }).sort({ createdAt: -1 }).limit(1);

    if (lastMessage && lastMessage.senderType === "human") {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (lastMessage.createdAt > twoHoursAgo) {
        console.log(`👨‍💼 Human is active (last human message ${Math.round((Date.now() - lastMessage.createdAt.getTime()) / 60000)} minutes ago)`);
        // Also update state to human_active for consistency
        await updateConversation(psid, {
          state: "human_active",
          agentTookOverAt: lastMessage.createdAt
        });
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error("❌ Error checking if human is active:", err);
    return false;
  }
}

module.exports = {
  getConversation,
  updateConversation,
  resetConversation,
  isHumanActive,
};
