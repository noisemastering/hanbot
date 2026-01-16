// models/MercadoLibreOrderEvent.js
const mongoose = require("mongoose");

const mercadoLibreOrderEventSchema = new mongoose.Schema(
  {
    // Seller ID (user_id from notification)
    sellerId: {
      type: String,
      required: true,
      index: true
    },

    // Order ID (parsed from resource)
    orderId: {
      type: String,
      required: true,
      index: true
    },

    // Notification metadata
    topic: {
      type: String,
      required: true,
      index: true
    },

    resource: {
      type: String,
      required: true
    },

    applicationId: String,

    // Timestamps
    receivedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    // Raw notification payload from ML
    rawNotificationBody: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },

    // Full order details fetched from ML API
    orderDetail: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    // Processing status
    processed: {
      type: Boolean,
      default: false,
      index: true
    },

    processedAt: Date,

    // Error tracking
    error: {
      message: String,
      code: String,
      timestamp: Date
    },

    // Correlation tracking
    correlated: {
      type: Boolean,
      default: false,
      index: true
    },
    correlatedClickId: String,
    correlationConfidence: {
      type: String,
      enum: ['high', 'medium', 'low', null]
    },
    correlatedAt: Date
  },
  {
    timestamps: true
  }
);

// Compound index for quick lookups
mercadoLibreOrderEventSchema.index({ sellerId: 1, orderId: 1 });
mercadoLibreOrderEventSchema.index({ topic: 1, receivedAt: -1 });
mercadoLibreOrderEventSchema.index({ processed: 1, receivedAt: -1 });

module.exports = mongoose.model("MercadoLibreOrderEvent", mercadoLibreOrderEventSchema);
