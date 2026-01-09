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

    // User info (for sales attribution)
    userName: String,

    // Location tracking (for sales attribution)
    city: String,
    stateMx: String,

    // Click tracking
    clicked: {
      type: Boolean,
      default: false
    },

    clickedAt: Date,

    // Conversion tracking
    converted: {
      type: Boolean,
      default: false,
      index: true
    },

    convertedAt: Date,

    // ML Order correlation (time-based or webhook)
    correlatedOrderId: {
      type: String,
      index: true
    },

    correlationConfidence: {
      type: String,
      enum: ['high', 'medium', 'low', null],
      default: null
    },

    correlationMethod: {
      type: String,
      enum: ['time_based', 'webhook', 'manual', null],
      default: null
    },

    // Order details snapshot at correlation time
    conversionData: {
      orderId: String,
      orderStatus: String,
      buyerId: String,
      buyerNickname: String,
      totalAmount: Number,
      paidAmount: Number,
      currency: String,
      orderDate: Date,
      itemTitle: String,
      itemQuantity: Number
    },

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
clickLogSchema.index({ productId: 1, clickedAt: -1 }); // For time-based correlation
clickLogSchema.index({ correlatedOrderId: 1 });

module.exports = mongoose.model("ClickLog", clickLogSchema);
