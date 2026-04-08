// conversationManager.js
const mongoose = require("mongoose");
const Conversation = require("./models/Conversation");
const User = require("./models/User");
const Message = require("./models/Message");

// Match the FB Page Instant Reply opener "¡Hola, Felipe!" / "Hola, Salvador!" / "¡Hola Acacia!"
// Must be at the very start of the message. Captures the first name.
// Excludes generic words like "Hola gracias" / "Hola buenos" that could be normal user replies.
const INSTANT_REPLY_NAME_RE = /^¡?\s*[Hh]ola[,!]?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20})\b[!,.]/;

const NOT_NAMES = new Set([
  'Buenos','Buenas','Hola','Saludos','Mucho','Muy','Gracias','Perfecto','Bien',
  'Necesito','Quiero','Hoy','Hola','Para','Con','Sin','Disculpa','Disculpe'
]);

/**
 * Harvest the first name from a FB Page Instant Reply ("¡Hola, X!") that
 * appears in the very early messages of a conversation. The Instant Reply is
 * sent automatically by Facebook when an ad CTA is clicked and contains the
 * user's first name from their public FB profile.
 *
 * Scans the first 5 messages only — if no match by then, the conversation
 * doesn't have an Instant Reply and we mark it harvested permanently.
 *
 * @param {string} psid
 */
async function harvestExtractedName(psid) {
  try {
    const firstMessages = await Message.find({ psid })
      .sort({ timestamp: 1 })
      .limit(5)
      .select('text')
      .lean();

    for (const msg of firstMessages) {
      if (!msg?.text) continue;
      const m = msg.text.match(INSTANT_REPLY_NAME_RE);
      const candidate = m?.[1];
      if (candidate && !NOT_NAMES.has(candidate)) {
        await Conversation.updateOne(
          { psid },
          { $set: { extractedName: candidate, nameHarvested: true } }
        );
        console.log(`👤 Harvested name for ${psid}: ${candidate}`);
        return candidate;
      }
    }

    // No Instant Reply pattern found in first 5 messages — mark harvested so
    // we never check again (per requirement: "if at first glance is not there
    // then it'll never be there").
    await Conversation.updateOne(
      { psid },
      { $set: { nameHarvested: true } }
    );
    return null;
  } catch (err) {
    console.error('❌ Error harvesting extractedName:', err.message);
    return null;
  }
}

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

    // Harvest first-message name (e.g. from FB Page Instant Reply) — runs at
    // most once per conversation. After this, nameHarvested=true and we never
    // try again, even if the field came back null.
    if (!convoObj.nameHarvested) {
      const harvested = await harvestExtractedName(psid);
      if (harvested) {
        convoObj.extractedName = harvested;
      }
      convoObj.nameHarvested = true;
    }
    // Prefer extractedName for downstream userName usage if present
    if (convoObj.extractedName && !convoObj.userName) {
      convoObj.userName = convoObj.extractedName;
    }

    return convoObj; // 🔥 devuelve snapshot limpio del documento actualizado
  } catch (err) {
    console.error("❌ Error en getConversation:", err);
    return { psid, state: "new", greeted: false, lastIntent: null };
  }
}

// 💾 Actualizar conversación
// Supports both $set and $push operations
// Pass { $push: { arrayField: value } } for array pushes
async function updateConversation(psid, updates = {}) {
  try {
    // Check if updates contains $push or other MongoDB operators
    const hasPush = updates.$push;
    const hasSet = updates.$set;

    if (hasPush || hasSet) {
      // Caller is using MongoDB operators directly
      const updateOps = {};

      // Handle $set - merge with lastMessageAt
      if (hasSet) {
        updateOps.$set = { ...updates.$set, lastMessageAt: new Date() };
      } else {
        updateOps.$set = { lastMessageAt: new Date() };
      }

      // Handle $push
      if (hasPush) {
        updateOps.$push = updates.$push;
      }

      await Conversation.updateOne({ psid }, updateOps, { upsert: true });
    } else {
      // Legacy behavior - treat all fields as $set
      await Conversation.updateOne(
        { psid },
        { $set: { ...updates, lastMessageAt: new Date() } },
        { upsert: true }
      );
    }
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
    // Auto-resume bot after 48 hours — humans often forget to clear the state
    if (convo && convo.state === "needs_human") {
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const handoffTime = convo.handoffTimestamp || convo.lastMessageAt;

      if (handoffTime && new Date(handoffTime) < fortyEightHoursAgo) {
        console.log(`🤖 Auto-resuming bot: needs_human state expired (handoff was ${Math.round((Date.now() - new Date(handoffTime).getTime()) / 3600000)}h ago)`);
        await updateConversation(psid, {
          state: "active",
          lastIntent: "bot_resumed",
          handoffResolved: true,
          handoffResolvedAt: new Date()
        });
        return false;
      }

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
