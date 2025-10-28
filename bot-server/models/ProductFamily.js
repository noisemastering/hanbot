const mongoose = require("mongoose");

const productFamilySchema = new mongoose.Schema({
  name: { type: String, required: true },        // Ej: "Malla sombra"
  description: { type: String },                 // Texto breve general
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model("ProductFamily", productFamilySchema);
