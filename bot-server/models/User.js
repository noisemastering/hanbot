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
  last_interaction: { type: Date, default: Date.now }
});

// Ensure at least one identifier is present
userSchema.index({ psid: 1 }, { unique: true, sparse: true });
userSchema.index({ whatsappPhone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", userSchema);
