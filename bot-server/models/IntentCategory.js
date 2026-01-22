const mongoose = require("mongoose");

const intentCategorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },  // e.g., "greeting", "product"
  name: { type: String, required: true },               // e.g., "Saludos", "Productos"
  description: { type: String },
  color: { type: String, default: '#6366f1' },          // For UI display
  icon: { type: String },                               // Optional icon name
  order: { type: Number, default: 0 },                  // For sorting in UI
  active: { type: Boolean, default: true }
}, { timestamps: true });

intentCategorySchema.index({ order: 1 });

module.exports = mongoose.model("IntentCategory", intentCategorySchema);
