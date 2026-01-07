// models/MLItemStatus.js
// Stores local status for ML items (inactive, notes, etc.)

const mongoose = require("mongoose");

const mlItemStatusSchema = new mongoose.Schema({
  mlItemId: { type: String, required: true, unique: true, index: true },
  inactive: { type: Boolean, default: false },
  inactiveReason: { type: String, enum: ['discontinued', 'temporary', 'out_of_stock', 'other'], default: null },
  notes: { type: String, default: null },
  lastMLTitle: { type: String }, // Cache the title for reference
  lastMLPrice: { type: Number }, // Cache the price for reference
}, { timestamps: true });

module.exports = mongoose.model("MLItemStatus", mlItemStatusSchema);
