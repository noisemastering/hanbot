// models/AdSet.js
const mongoose = require("mongoose");

const adSetSchema = new mongoose.Schema(
  {
    // Reference to parent Campaign
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true
    },

    // Facebook AdSet ID
    fbAdSetId: { type: String, required: true, unique: true },

    // Basic info
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
      default: "ACTIVE"
    },

    // Targeting
    targeting: {
      locations: [String],
      ageMin: Number,
      ageMax: Number,
      genders: [String],
      interests: [String],
      behaviors: [String],
      customAudiences: [String]
    },

    // Budget & Schedule
    dailyBudget: Number,
    lifetimeBudget: Number,
    startTime: Date,
    endTime: Date,

    // Optimization
    optimizationGoal: String,  // e.g., "REACH", "LINK_CLICKS", "CONVERSIONS"
    billingEvent: String,      // e.g., "IMPRESSIONS", "LINK_CLICKS"
    bidAmount: Number,

    // Placement
    placements: [String],      // e.g., ["facebook_feed", "instagram_feed"]

    // Products associated with this ad set
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product"
    }],

    // Metrics
    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      spend: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },        // Click-through rate
      cpc: { type: Number, default: 0 },        // Cost per click
      cpm: { type: Number, default: 0 },        // Cost per mille
      lastUpdated: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdSet", adSetSchema);
