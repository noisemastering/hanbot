// models/Conversation.js
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
  psid: { type: String, required: true, unique: true },
  state: { type: String, default: "new" },  // new | active | closed | needs_human | human_handling
  greeted: { type: Boolean, default: false },
  lastIntent: { type: String, default: null },
  lastGreetTime: { type: Number, default: 0 },
  unknownCount: { type: Number, default: 0 },
  clarificationCount: { type: Number, default: 0 },  // Track unintelligible message attempts
  lastMessageAt: { type: Date, default: Date.now },

  // Campaign & context tracking
  campaignRef: { type: String, default: null },
  requestedSize: { type: String, default: null },  // Track last size user asked about
  familyShown: { type: String, default: null },     // Track last family shown
  lastUnavailableSize: { type: String, default: null },  // Track unavailable size to detect insistence
  oversizedRepeatCount: { type: Number, default: 0 },  // Track how many times user asked for same oversized dimension

  // Human handoff tracking
  handoffRequested: { type: Boolean, default: false },  // User explicitly requested human
  handoffReason: { type: String, default: null },      // Why handoff was triggered
  handoffTimestamp: { type: Date, default: null },     // When handoff was requested
  assignedAgent: { type: String, default: null },      // Agent email/ID who took over
  agentTookOverAt: { type: Date, default: null },      // When agent took over conversation
  handoffResolved: { type: Boolean, default: false },  // Agent marked as resolved
  handoffResolvedAt: { type: Date, default: null }     // When agent marked as resolved
});

module.exports = mongoose.model("Conversation", conversationSchema);
