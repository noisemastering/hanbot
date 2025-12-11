const mongoose = require("mongoose");

const usoSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  // Products associated with this use case
  products: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily'
  }],
  available: { type: Boolean, default: true },
  // Optional image for the use case
  imageUrl: { type: String },
  // Priority for display ordering
  priority: {
    type: Number,
    default: 5,
    min: 1,
    max: 10
  }
}, {
  timestamps: true
});

// Index for faster queries
usoSchema.index({ name: 1 });
usoSchema.index({ available: 1, priority: -1 });

// Virtual to get product count
usoSchema.virtual('productCount').get(function() {
  return this.products ? this.products.length : 0;
});

// Ensure virtuals are included in JSON
usoSchema.set('toJSON', { virtuals: true });
usoSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Uso", usoSchema);
