// models/Conversation.js
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
  psid: { type: String, required: true, unique: true },
  state: { type: String, default: "new" },
  greeted: { type: Boolean, default: false },
  lastIntent: { type: String, default: null },
  lastGreetTime: { type: Number, default: 0 },
  unknownCount: { type: Number, default: 0 },
  lastMessageAt: { type: Date, default: Date.now },

  // Campaign & context tracking
  campaignRef: { type: String, default: null },
  requestedSize: { type: String, default: null },  // Track last size user asked about
  familyShown: { type: String, default: null }     // Track last family shown
});

module.exports = mongoose.model("Conversation", conversationSchema);
