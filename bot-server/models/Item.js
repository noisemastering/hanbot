const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  // Link back to ProductFamily source (for single items)
  productFamilyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily'
  },

  // Core fields for bot compatibility
  nombre: {
    type: String,
    required: true,
    index: true
  },

  tipo: {
    type: String,
    index: true
  },

  tamaño: {
    type: String
  },

  precio: {
    type: Number,
    required: true
  },

  link: {
    type: String
  },

  // Stock tracking (must be >= 1 to be available)
  stock: {
    type: Number,
    default: 0,
    min: 0
  },

  // Status flags (both must be true for item to be available)
  active: {
    type: Boolean,
    default: true,
    index: true
  },

  available: {
    type: Boolean,
    default: true,
    index: true
  },

  // Combo support (array of ProductFamily IDs if this is a combo item)
  // If this array has items, this is a combo; otherwise it's a single item
  comboItems: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily'
  }],

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
itemSchema.index({ active: 1, available: 1, stock: 1 });
itemSchema.index({ nombre: 'text', tipo: 'text' });

// Virtual to check if item is truly available
itemSchema.virtual('isAvailable').get(function() {
  return this.active && this.available && this.stock >= 1;
});

// Method to check if this is a combo item
itemSchema.methods.isCombo = function() {
  return this.comboItems && this.comboItems.length > 0;
};

module.exports = mongoose.model('Item', itemSchema);
