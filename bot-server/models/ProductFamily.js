const mongoose = require("mongoose");

const productFamilySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductFamily',
    default: null  // null means root/generation 1
  },
  generation: {
    type: Number,
    default: 1  // Auto-calculated based on parent
  },
  sellable: {
    type: Boolean,
    default: false  // Only sellable items can be offered in campaigns
  },
  // Fields for sellable products
  price: {
    type: Number
  },
  sku: {
    type: String
  },
  stock: {
    type: Number,
    default: 0
  },
  available: {
    type: Boolean,
    default: true
  },
  // Additional metadata
  imageUrl: {
    type: String
  },
  attributes: {
    type: Map,
    of: String  // Flexible attributes like { size: "3x5m", finish: "Reforzada" }
  }
}, {
  timestamps: true
});

// Virtual for getting children
productFamilySchema.virtual('children', {
  ref: 'ProductFamily',
  localField: '_id',
  foreignField: 'parentId'
});

// Pre-save hook to calculate generation based on parent and validate sellable
productFamilySchema.pre('save', async function(next) {
  if (this.parentId) {
    const parent = await mongoose.model('ProductFamily').findById(this.parentId);
    if (parent) {
      this.generation = parent.generation + 1;

      // Parent cannot be sellable (sellable products are "infertile")
      if (parent.sellable) {
        const error = new Error('No se puede agregar un hijo a un producto vendible. Los productos vendibles no pueden tener hijos.');
        error.name = 'ValidationError';
        return next(error);
      }
    }
  } else {
    this.generation = 1;

    // Root products cannot be sellable
    if (this.sellable) {
      const error = new Error('Los productos raíz no pueden ser vendibles. Solo los productos con padre pueden marcarse como vendibles.');
      error.name = 'ValidationError';
      return next(error);
    }
  }

  // If marking as sellable, check if it has children
  if (this.sellable && this.isModified('sellable')) {
    const childCount = await mongoose.model('ProductFamily').countDocuments({ parentId: this._id });
    if (childCount > 0) {
      const error = new Error('No se puede marcar como vendible un producto que tiene hijos. Elimine los hijos primero.');
      error.name = 'ValidationError';
      return next(error);
    }
  }

  next();
});

// Ensure virtuals are included in JSON
productFamilySchema.set('toJSON', { virtuals: true });
productFamilySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("ProductFamily", productFamilySchema);
