const mongoose = require("mongoose");

const mlProductMappingSchema = new mongoose.Schema({
  mlItemTitle: { type: String, required: true },
  mlItemId: { type: String, index: true },

  productFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },

  confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
  matchedBy: { type: String, enum: ['ai', 'manual', 'link'], default: 'ai' },

  aiReasoning: String,
  alternativeMappings: [{
    productFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily' },
    productName: String,
    score: Number
  }],

  reviewed: { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'DashboardUser', default: null },
  reviewedAt: Date,

  orderCount: { type: Number, default: 0 },
  lastSeenAt: Date
}, { timestamps: true });

mlProductMappingSchema.index({ mlItemTitle: 1 }, { unique: true });
mlProductMappingSchema.index({ reviewed: 1, confidence: 1 });
mlProductMappingSchema.index({ productFamilyId: 1 });

module.exports = mongoose.model("MLProductMapping", mlProductMappingSchema);
