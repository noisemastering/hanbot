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
