const mongoose = require("mongoose");

const usoSchema = new mongoose.Schema({
  name: { type: String, required: true },         // Ej: "Protección solar", "Agricultura"
  description: { type: String },                   // Description of the use case
  available: { type: Boolean, default: true },
}, {
  timestamps: true
});

module.exports = mongoose.model("Uso", usoSchema);
