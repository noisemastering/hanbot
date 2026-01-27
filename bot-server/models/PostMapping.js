// models/PostMapping.js
// Maps Facebook post IDs to product context
// Can be populated manually or from ad post associations
const mongoose = require("mongoose");

const postMappingSchema = new mongoose.Schema({
  // Facebook post ID (format: pageId_postId)
  postId: { type: String, required: true, unique: true },

  // Product context
  productInterest: { type: String },
  productFamilyId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily" },

  // Optional metadata
  postContent: { type: String }, // Brief description of post
  imageUrl: { type: String },

  // Auto-detected keywords from post
  keywords: [String],

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("PostMapping", postMappingSchema);
