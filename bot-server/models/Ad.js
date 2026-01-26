// models/Ad.js
const mongoose = require("mongoose");

const adSchema = new mongoose.Schema(
  {
    // Reference to parent AdSet
    adSetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSet",
      required: true
    },

    // Facebook Ad ID
    fbAdId: { type: String, required: true, unique: true },

    // Basic info
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
      default: "ACTIVE"
    },

    // Creative
    creative: {
      headline: String,
      body: String,
      description: String,
      callToAction: String,       // e.g., "LEARN_MORE", "SHOP_NOW"
      linkUrl: String,

      // Media
      imageUrl: String,
      videoUrl: String,
      thumbnailUrl: String,

      // Card format (for carousel)
      cards: [{
        headline: String,
        description: String,
        imageUrl: String,
        linkUrl: String
      }]
    },

    // Products associated with this ad
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductFamily"
    }],

    // Main product for determining productInterest (optional)
    mainProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductFamily",
      default: null
    },

    // Ad intent - context for tailoring responses
    adIntent: {
      primaryUse: String,        // e.g., "protección solar agrícola", "sombra para patio"
      audienceType: String,      // e.g., "agricultor / vivero", "dueño de casa"
      offerHook: String          // e.g., "envío gratis por tiempo limitado"
    },

    // Ad angle - messaging strategy (same as Campaign for consistency)
    adAngle: {
      type: String,
      enum: [
        null, "",
        "problem_pain",    // Solving a specific problem (sun damage, heat)
        "price_value",     // Focus on value/affordable pricing
        "quality",         // Focus on quality/durability
        "urgency",         // Limited time offers
        "social_proof",    // Testimonials and social proof
        "convenience",     // Easy shipping/purchase
        "bulk_b2b",        // Business/wholesale focus
        "diy_ease",        // Easy to install/use yourself
        "comparison"       // Better than alternatives
      ]
    },

    // ====== OVERRIDES (inherit from AdSet/Campaign if not set) ======

    // Audience override
    audience: {
      type: {
        type: String,
        enum: [null, "", "homeowner", "farmer", "greenhouse", "business", "contractor", "reseller"]
      },
      experienceLevel: {
        type: String,
        enum: [null, "", "beginner", "practical", "expert"]
      }
    },

    // Conversation goal override
    conversationGoal: {
      type: String,
      enum: [null, "", "cotizacion", "venta_directa", "lead_capture", "informacion"]
    },

    // Response guidelines override
    responseGuidelines: {
      tone: String,
      mustNot: [String],
      shouldDo: [String]
    },

    // Initial message override
    initialMessage: String,

    // Specific flow to use (overrides default flow selection)
    flowRef: String,  // e.g., "rolloFlow", "mallaFlow", "bordeFlow"

    // Catalog override (inherits from AdSet/Campaign if not set)
    catalog: {
      url: { type: String },
      publicId: { type: String },
      name: { type: String },
      uploadedAt: { type: Date }
    },

    // Ad context override (more specific than campaign-level)
    adContext: {
      angle: {
        type: String,
        enum: [null, "", "problem_pain", "price_value", "quality", "urgency", "social_proof", "convenience", "bulk_b2b", "diy_ease", "comparison"]
      },
      summary: String,
      cta: String,
      offerHook: String
    },

    // Tracking
    tracking: {
      utmSource: String,
      utmMedium: String,
      utmCampaign: String,
      utmContent: String,
      utmTerm: String,
      pixelId: String
    },

    // Metrics
    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      spend: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },
      cpc: { type: Number, default: 0 },
      cpm: { type: Number, default: 0 },
      frequency: { type: Number, default: 0 },
      lastUpdated: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ad", adSchema);
