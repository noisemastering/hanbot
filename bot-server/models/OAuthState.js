// models/OAuthState.js
const mongoose = require("mongoose");

const oauthStateSchema = new mongoose.Schema(
  {
    // Encoded state string sent to ML
    state: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // Decoded components
    psid: {
      type: String,
      default: null,
      index: true  // For tracking click attribution
    },

    nonce: {
      type: String,
      required: true  // Random security token
    },

    // PKCE (Proof Key for Code Exchange)
    codeVerifier: {
      type: String,
      required: true  // PKCE code_verifier for S256 challenge
    },

    // Metadata
    ipAddress: String,
    userAgent: String,

    // Validation tracking
    used: {
      type: Boolean,
      default: false
    },

    usedAt: Date,

    // Auto-expire after 10 minutes
    expiresAt: {
      type: Date,
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

// TTL index - MongoDB automatically deletes expired documents
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Prevent reuse of state tokens
oauthStateSchema.methods.markAsUsed = async function() {
  this.used = true;
  this.usedAt = new Date();
  return await this.save();
};

module.exports = mongoose.model("OAuthState", oauthStateSchema);
