const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily", required: true },
  subfamilyId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSubfamily" },
  name: { type: String, required: true },
  price: { type: String },
  type: { type: String, enum: ["rollo", "confeccionada"], default: "confeccionada" },
  size: { type: String },                         // Ej: "4x6m" o "4.2x25m"
  mLink: { type: String },
  imageUrl: { type: String },
  description: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);
