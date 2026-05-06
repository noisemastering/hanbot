const mongoose = require("mongoose");

const mlOrderSchema = new mongoose.Schema({
  mlOrderId: { type: String, required: true, unique: true, index: true },
  sellerId: { type: String, required: true, index: true },

  dateCreated: { type: Date, required: true, index: true },
  dateClosed: { type: Date },

  status: { type: String, index: true }, // paid, cancelled, etc.

  totalAmount: { type: Number },
  paidAmount: { type: Number },
  currencyId: { type: String, default: 'MXN' },

  buyer: {
    mlBuyerId: String,
    nickname: String,
    firstName: String,
    lastName: String
  },

  shippingCity: String,
  shippingState: String,
  shippingZipCode: String,

  items: [{
    mlItemId: { type: String },
    title: { type: String },
    categoryId: String,
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number },
    productFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFamily', default: null },
    mappingConfidence: { type: String, enum: ['high', 'medium', 'low', null], default: null }
  }],

  importBatchId: String,
  source: { type: String, enum: ['recent', 'archived'], default: 'recent' }
}, { timestamps: true });

mlOrderSchema.index({ sellerId: 1, dateCreated: -1 });
mlOrderSchema.index({ 'items.mlItemId': 1 });
mlOrderSchema.index({ 'items.productFamilyId': 1 });
mlOrderSchema.index({ 'items.title': 1, 'items.productFamilyId': 1 });

module.exports = mongoose.model("MLOrder", mlOrderSchema);
