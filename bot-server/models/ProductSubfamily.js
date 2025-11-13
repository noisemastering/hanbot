const mongoose = require("mongoose");

const productSubfamilySchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily" },
  name: { type: String, required: true },         // Ej: "Beige"
  aliases: [String],                              // Ej: ["beige", "malla sombra beige"]
  description: { type: String },
  available: { type: Boolean, default: true },

  // Master Catalog Fields - Base product information that variants inherit from
  generalUse: [String],                           // Ej: ["Protección solar", "Cultivos agrícolas", "Estacionamientos"]
  materials: { type: String },                    // Ej: "Polietileno de alta densidad (HDPE) con tejido raschel"
  generalSpecs: {                                 // Technical specifications
    type: mongoose.Schema.Types.Mixed,            // Flexible structure for specs
    default: {}                                   // Ej: { shadeFactor: "90%", uvProtection: "Yes", waterResistant: false }
  },
  generalAppliances: [String],                    // Ej: ["Agricultura", "Construcción", "Hogar", "Comercial"]
});

module.exports = mongoose.model("ProductSubfamily", productSubfamilySchema);
