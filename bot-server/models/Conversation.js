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
  adId: { type: String, default: null },           // Facebook Ad ID (referral.ad_id) or WhatsApp CTWA source_id
  campaignId: { type: String, default: null },     // Facebook Campaign ID (referral.campaign_id)
  // WhatsApp CTWA (Click-to-WhatsApp) ad tracking
  adHeadline: { type: String, default: null },     // WhatsApp ad headline
  adBody: { type: String, default: null },         // WhatsApp ad body text
  adSourceUrl: { type: String, default: null },    // WhatsApp ad source URL
  adSourceType: { type: String, default: null },   // WhatsApp ad source type (usually "ad")
  requestedSize: { type: String, default: null },  // Track last size user asked about
  productInterest: { type: String, default: null }, // Product type user is interested in (malla_sombra, borde_separador, rollo)

  // POI (Product of Interest) tree tracking - ensures variants stay in same tree
  productFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null }, // Current product node
  poiLocked: { type: Boolean, default: false },        // Whether POI is locked to a tree
  poiRootId: { type: String, default: null },          // Root of the locked tree
  poiRootName: { type: String, default: null },        // Name of root product (e.g., "Malla Sombra Raschel")

  // Product specifications tracking (remembers what user already told us)
  productSpecs: {
    productType: { type: String, default: null },    // "rollo", "confeccionada", "ground_cover"
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },
    size: { type: String, default: null },           // "2x100", "4x100", "3x5"
    width: { type: Number, default: null },          // 2, 4 (meters)
    length: { type: Number, default: null },         // 100 (meters for rolls)
    percentage: { type: Number, default: null },     // 90, 80, 50 (shade percentage)
    color: { type: String, default: null },          // "negro", "verde", "beige"
    quantity: { type: Number, default: null },       // 15 (number of units)
    customerName: { type: String, default: null },   // "Francisco Zamudio"
    updatedAt: { type: Date, default: null }         // When specs were last updated
  },

  // Location tracking (for sales attribution)
  city: { type: String, default: null },           // City mentioned by user (e.g., "Hermosillo")
  stateMx: { type: String, default: null },        // Mexican state (e.g., "Sonora")
  familyShown: { type: String, default: null },     // Track last family shown
  lastUnavailableSize: { type: String, default: null },  // Track unavailable size to detect insistence
  recommendedSize: { type: String, default: null },      // Size recommended by bot (for confirmation flow)
  oversizedRepeatCount: { type: Number, default: 0 },  // Track how many times user asked for same oversized dimension
  offeredToShowAllSizes: { type: Boolean, default: false },  // Track if bot offered to show all sizes

  // Track sizes we've already offered (to avoid repetitive suggestions)
  offeredSizes: [{
    size: String,           // e.g., "3x2m"
    forRequest: String,     // What user asked for, e.g., "3x1.8m"
    price: Number,
    offeredAt: { type: Date, default: Date.now }
  }],

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
    enum: [null, 'asking_zipcode', 'asking_neighborhood', 'asking_product_selection', 'asking_quantity', 'asking_more_items'],
    default: null
  },
  humanSalesCart: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily' },
    productName: String,
    quantity: Number,
    addedAt: { type: Date, default: Date.now }
  }],
  humanSalesZipcode: { type: String, default: null },
  humanSalesNeighborhood: { type: String, default: null },
  humanSalesPendingNeighborhoods: [{ name: String, type: String }],
  humanSalesCurrentProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },

  // Lead capture data (for distributor/wholesale campaigns)
  leadData: {
    name: { type: String, default: null },
    zipcode: { type: String, default: null },
    location: { type: String, default: null },
    products: { type: String, default: null },    // Raw text of requested products/dimensions
    quantity: { type: mongoose.Schema.Types.Mixed, default: null },
    contact: { type: String, default: null },     // WhatsApp or email
    contactType: { type: String, enum: ['whatsapp', 'email', null], default: null },
    capturedAt: { type: Date, default: null }
  },

  // Future purchase intent tracking
  futureInterest: {
    interested: { type: Boolean, default: false },
    timeframeRaw: { type: String, default: null },      // Original text: "en un par de meses"
    timeframeDays: { type: Number, default: null },     // Estimated days: 60
    followUpDate: { type: Date, default: null },        // Calculated follow-up date
    productInterest: { type: String, default: null },   // What they were interested in
    originalMessage: { type: String, default: null },   // The message that triggered this
    detectedAt: { type: Date, default: null },
    followedUp: { type: Boolean, default: false },      // Has been followed up
    followedUpAt: { type: Date, default: null }
  }
});

module.exports = mongoose.model("Conversation", conversationSchema);
