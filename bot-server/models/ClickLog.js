// models/ClickLog.js
const mongoose = require("mongoose");

const clickLogSchema = new mongoose.Schema(
  {
    // Unique click ID
    clickId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // User identifier (PSID from Facebook)
    psid: {
      type: String,
      required: true,
      index: true
    },

    // Link information
    originalUrl: {
      type: String,
      required: true
    },

    // Context information
    productName: String,
    productId: String,
    campaignId: String,
    adSetId: String,
    adId: String,

    // Click tracking
    clicked: {
      type: Boolean,
      default: false
    },

    clickedAt: Date,

    // Conversion tracking
    converted: {
      type: Boolean,
      default: false
    },

    conversionData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    convertedAt: Date,

    // Metadata
    userAgent: String,
    ipAddress: String,
    referrer: String
  },
  {
    timestamps: true
  }
);

// Index for performance
clickLogSchema.index({ psid: 1, createdAt: -1 });
clickLogSchema.index({ clicked: 1, createdAt: -1 });
clickLogSchema.index({ converted: 1, createdAt: -1 });

module.exports = mongoose.model("ClickLog", clickLogSchema);
