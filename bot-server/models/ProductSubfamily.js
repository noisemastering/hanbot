const mongoose = require("mongoose");

const productSubfamilySchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily", required: true },
  name: { type: String, required: true },         // Ej: "Beige"
  aliases: [String],                              // Ej: ["beige", "malla sombra beige"]
  description: { type: String },
  available: { type: Boolean, default: true },
});

module.exports = mongoose.model("ProductSubfamily", productSubfamilySchema);
