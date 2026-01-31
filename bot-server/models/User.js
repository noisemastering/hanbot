const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  // Facebook fields
  psid: { type: String, sparse: true }, // Sparse index allows nulls for WhatsApp users

  // WhatsApp fields (NEW)
  whatsappPhone: { type: String, sparse: true }, // Phone number for WhatsApp users

  // Multi-channel fields (NEW)
  channel: { type: String, enum: ['facebook', 'whatsapp'], required: true },
  unifiedId: { type: String, unique: true }, // Format: "fb:psid" or "wa:phone"

  // User profile (works for both channels)
  first_name: String,
  last_name: String,
  profile_pic: String,
  locale: String,
  timezone: Number,
  gender: String,
  last_interaction: { type: Date, default: Date.now },

  // Location data (for sales correlation)
  location: {
    zipcode: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    source: { type: String, enum: ['conversation', 'stats_question', 'shipping_flow', null], default: null },
    updatedAt: { type: Date, default: null }
  },

  // Product of Interest (for sales correlation)
  poi: {
    productInterest: { type: String, default: null },     // "malla_sombra", "borde_separador", "rollo", etc.
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },
    familyName: { type: String, default: null },          // "Malla Sombra Raschel 90%"
    rootId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },
    rootName: { type: String, default: null },            // "Malla Sombra"
    updatedAt: { type: Date, default: null }
  }
});

// Ensure at least one identifier is present
userSchema.index({ psid: 1 }, { unique: true, sparse: true });
userSchema.index({ whatsappPhone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", userSchema);
