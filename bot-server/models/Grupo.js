const mongoose = require("mongoose");

const grupoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // Products included in this group (from ProductFamily)
  products: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily'
  }],
  // Optional: Suggested products to recommend when showing this group
  suggestedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily'
  }],
  // Group type for categorization
  type: {
    type: String,
    enum: ['bundle', 'complementary', 'alternative', 'seasonal', 'custom'],
    default: 'custom'
    // bundle: Products that go well together
    // complementary: Products that complement each other
    // alternative: Alternative options for same use case
    // seasonal: Seasonal product groupings
    // custom: Custom grouping
  },
  // Priority for recommendation engine (higher = more important)
  priority: {
    type: Number,
    default: 5,
    min: 1,
    max: 10
  },
  // Active status
  available: {
    type: Boolean,
    default: true
  },
  // Optional image for group
  imageUrl: {
    type: String
  },
  // Tags for easier filtering and search
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // Optional: Discount when buying products from this group
  discountPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  }
}, {
  timestamps: true
});

// Index for faster queries
grupoSchema.index({ name: 1 });
grupoSchema.index({ type: 1, available: 1 });
grupoSchema.index({ tags: 1 });

// Virtual to get product count
grupoSchema.virtual('productCount').get(function() {
  return this.products ? this.products.length : 0;
});

// Ensure virtuals are included in JSON
grupoSchema.set('toJSON', { virtuals: true });
grupoSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Grupo", grupoSchema);
