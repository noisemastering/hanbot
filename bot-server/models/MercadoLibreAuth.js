// models/MercadoLibreAuth.js
const mongoose = require("mongoose");

const mercadoLibreAuthSchema = new mongoose.Schema(
  {
    // Mercado Libre seller ID (unique identifier)
    sellerId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // OAuth tokens
    accessToken: {
      type: String,
      required: true
    },

    refreshToken: {
      type: String,
      required: true
    },

    // Token metadata
    expiresIn: {
      type: Number,
      required: true  // seconds until expiration
    },

    tokenCreatedAt: {
      type: Date,
      required: true,
      default: Date.now
    },

    // Seller information (from /users/me)
    sellerInfo: {
      nickname: String,
      email: String,
      firstName: String,
      lastName: String,
      countryId: String,
      siteId: String
    },

    // Click tracking - link to Meta PSID that initiated auth
    psid: {
      type: String,
      default: null,
      index: true
    },

    // Authorization metadata
    scope: [String],  // Granted permissions
    authorizedAt: {
      type: Date,
      default: Date.now
    },

    // Status
    active: {
      type: Boolean,
      default: true,
      index: true
    },

    // Last token refresh
    lastRefreshedAt: Date,

    // Error tracking
    lastError: {
      message: String,
      code: String,
      timestamp: Date
    }
  },
  { timestamps: true }
);

// Compound index for active sellers lookup
mercadoLibreAuthSchema.index({ active: 1, sellerId: 1 });

// Method to check if token is expired (matches mlTokenManager.js pattern)
mercadoLibreAuthSchema.methods.isTokenExpired = function() {
  const now = Date.now();
  const expiryMs = this.tokenCreatedAt.getTime() + (this.expiresIn * 1000);
  // Consider expired if less than 60 seconds remaining (same as mlTokenManager.js)
  return now >= (expiryMs - 60000);
};

// Method to get time until expiration (in seconds)
mercadoLibreAuthSchema.methods.getTimeUntilExpiry = function() {
  const now = Date.now();
  const expiryMs = this.tokenCreatedAt.getTime() + (this.expiresIn * 1000);
  return Math.max(0, Math.floor((expiryMs - now) / 1000));
};

// Virtual for full seller name
mercadoLibreAuthSchema.virtual("fullName").get(function() {
  if (this.sellerInfo?.firstName && this.sellerInfo?.lastName) {
    return `${this.sellerInfo.firstName} ${this.sellerInfo.lastName}`;
  }
  return this.sellerInfo?.nickname || this.sellerId;
});

// Ensure virtuals are included in JSON
mercadoLibreAuthSchema.set('toJSON', { virtuals: true });
mercadoLibreAuthSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("MercadoLibreAuth", mercadoLibreAuthSchema);
