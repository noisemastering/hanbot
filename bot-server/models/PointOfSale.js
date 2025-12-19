// models/PointOfSale.js
const mongoose = require('mongoose');

const pointOfSaleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Optional default URL pattern (e.g., "https://mercadolibre.com.mx/")
  defaultUrl: {
    type: String,
    trim: true
  },
  // Optional icon URL or emoji
  icon: {
    type: String,
    trim: true
  },
  // Whether this POS is active and should be shown in dropdowns
  active: {
    type: Boolean,
    default: true
  },
  // Optional description
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for faster queries
pointOfSaleSchema.index({ name: 1 });
pointOfSaleSchema.index({ active: 1 });

const PointOfSale = mongoose.model('PointOfSale', pointOfSaleSchema);

module.exports = PointOfSale;
