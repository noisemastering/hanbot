// models/Conversation.js
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
  psid: { type: String, required: true, unique: true }, // Now stores unifiedId (fb:xxx or wa:xxx)
  channel: { type: String, enum: ['facebook', 'whatsapp'], default: null }, // NEW: Track channel
  state: { type: String, default: "new" },  // new | active | closed | needs_human | human_handling
  greeted: { type: Boolean, default: false },
  lastIntent: { type: String, default: null },
  lastGreetTime: { type: Number, default: 0 },
  unknownCount: { type: Number, default: 0 },
  clarificationCount: { type: Number, default: 0 },  // Track unintelligible message attempts
  lastMessageAt: { type: Date, default: Date.now },
  lastBotResponse: { type: String, default: null },  // Track last bot response to detect repetition

  // Campaign & context tracking
  campaignRef: { type: String, default: null },
  adId: { type: String, default: null },           // Facebook Ad ID (referral.ad_id)
  campaignId: { type: String, default: null },     // Facebook Campaign ID (referral.campaign_id)
  requestedSize: { type: String, default: null },  // Track last size user asked about

  // Location tracking (for sales attribution)
  city: { type: String, default: null },           // City mentioned by user (e.g., "Hermosillo")
  stateMx: { type: String, default: null },        // Mexican state (e.g., "Sonora")
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
  handoffResolvedAt: { type: Date, default: null },    // When agent marked as resolved

  // Human-sellable product flow (multi-step purchase)
  humanSalesState: {
    type: String,
    enum: [null, 'asking_zipcode', 'asking_product_selection', 'asking_quantity', 'asking_more_items'],
    default: null
  },
  humanSalesCart: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily' },
    productName: String,
    quantity: Number,
    addedAt: { type: Date, default: Date.now }
  }],
  humanSalesZipcode: { type: String, default: null },
  humanSalesCurrentProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null }
});

module.exports = mongoose.model("Conversation", conversationSchema);
