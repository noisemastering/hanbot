const mongoose = require("mongoose");

const productFamilySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  marketingDescription: {
    type: String  // Marketing copy for promotional purposes
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
  wholesalePrice: {
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
  active: {
    type: Boolean,
    default: true  // Whether product is actively being sold
  },
  size: {
    type: String  // Dimension string for sellable products (e.g., "6x4m", "3x5m")
    // Only populated for sellable products that represent physical dimensions
    // Used by bot for dimension-based queries like "malla sombra de 6x4"
  },
  // Additional metadata
  imageUrl: {
    type: String
  },
  thumbnail: {
    type: String  // Link to product thumbnail image
  },
  onlineStoreLinks: [{
    url: {
      type: String,
      required: true
    },
    store: {
      type: String,  // e.g., "Mercado Libre", "Amazon", "Website"
      required: true
    },
    isPreferred: {
      type: Boolean,
      default: false  // Mark the main/preferred link (e.g., Mercado Libre)
    }
  }],
  attributes: {
    type: Map,
    of: String  // Flexible attributes like { size: "3x5m", finish: "Reforzada" }
  },
  // Enabled dimensions - which dimensions are active for this product and its descendants
  // These cascade down the tree - children inherit all enabled dimensions from ancestors
  enabledDimensions: [{
    type: String,
    enum: ['width', 'length', 'height', 'depth', 'thickness', 'weight', 'diameter',
           'side1', 'side2', 'side3', 'side4', 'side5', 'side6']
  }],
  // Unit preferences for each enabled dimension (e.g., { width: 'm', thickness: 'mm' })
  // These also cascade down the tree - children inherit unit preferences from ancestors
  dimensionUnits: {
    type: Map,
    of: String  // Maps dimension name to unit (e.g., 'm', 'in', 'cm', 'mm', 'kg', 'lb')
  },
  // Display template for inventory tables (defines which columns to show for children)
  displayTemplate: {
    name: { type: String },  // Template name (e.g., "Size + Color", "Material", "Direct Sale")
    columns: [{
      key: { type: String },      // Column identifier (e.g., 'size', 'color', 'material')
      label: { type: String },    // Display label (e.g., 'Tamaño', 'Color')
      source: { type: String }    // Where to get data: 'attribute', 'name', 'description', or field name
    }]
  },
  // Cross-selling and human handoff features
  requiresHumanAdvisor: {
    type: Boolean,
    default: false  // Flag products that need human assistance
  },
  genericDescription: {
    type: String  // Brief description for cross-selling (when customer asks about this product)
    // e.g., "Rollo antimaleza - ideal para control de hierbas en cultivos"
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

// Helper function to extract size from text
function extractSizeFromText(text) {
  if (!text) return null;

  // Pattern 1: "6x4m", "6 x 4m", "6x4", "6 x 4"
  const pattern1 = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*m?(?:etros?)?/;
  const match1 = text.match(pattern1);
  if (match1) {
    return `${match1[1]}x${match1[2]}m`;
  }

  // Pattern 2: "6 metros x 4 metros", "6m x 4m"
  const pattern2 = /(\d+(?:\.\d+)?)\s*m(?:etros?)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*m(?:etros?)?/;
  const match2 = text.match(pattern2);
  if (match2) {
    return `${match2[1]}x${match2[2]}m`;
  }

  // Pattern 3: Triangle - "3x4x5m", "3 x 4 x 5"
  const pattern3 = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*m?/;
  const match3 = text.match(pattern3);
  if (match3) {
    return `${match3[1]}x${match3[2]}x${match3[3]}m`;
  }

  return null;
}

// Pre-save hook to calculate generation based on parent and validate sellable
productFamilySchema.pre('save', async function(next) {
  let parent = null;

  if (this.parentId) {
    parent = await mongoose.model('ProductFamily').findById(this.parentId);
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

  // AUTO-GENERATE SIZE FIELD for sellable products
  if (this.sellable) {
    // Strategy 1: Try to extract from own name
    let extractedSize = extractSizeFromText(this.name);

    // Strategy 2: If not found and has parent, try parent's name
    if (!extractedSize && parent) {
      extractedSize = extractSizeFromText(parent.name);
    }

    // Strategy 3: If still not found, try to construct from attributes
    if (!extractedSize && this.attributes) {
      const attrs = this.attributes;

      // Triangular (3 sides)
      if (attrs.get('side1') && attrs.get('side2') && attrs.get('side3')) {
        const s1 = attrs.get('side1').replace(/[^\d.]/g, '');
        const s2 = attrs.get('side2').replace(/[^\d.]/g, '');
        const s3 = attrs.get('side3').replace(/[^\d.]/g, '');
        extractedSize = `${s1}x${s2}x${s3}m`;
      }
      // Rectangular/Roll (width x length)
      else if (attrs.get('width') && attrs.get('length')) {
        const w = attrs.get('width').replace(/[^\d.]/g, '');
        const l = attrs.get('length').replace(/[^\d.]/g, '');
        extractedSize = `${w}x${l}m`;
      }
    }

    // Set the size field if we found something
    if (extractedSize) {
      this.size = extractedSize;
      console.log(`📏 Auto-generated size for "${this.name}": ${extractedSize}`);
    }
  }

  next();
});

// Ensure virtuals are included in JSON
productFamilySchema.set('toJSON', { virtuals: true });
productFamilySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("ProductFamily", productFamilySchema);
