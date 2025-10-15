// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: String,
  price: String,
  mLink: String,  // 👈 usa el mismo nombre que en tu CSV
  category: String,
  description: String
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);
