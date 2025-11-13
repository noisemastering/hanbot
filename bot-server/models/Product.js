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

  // Variant-specific fields (differences from base master catalog)
  reinforcements: { type: Boolean, default: false },  // Has corner reinforcements
  ojillos: { type: Boolean, default: false },         // Has grommets/eyelets
  borderType: { type: String },                        // Ej: "Reforzado", "Simple", "Dobladillo"
  customizable: { type: Boolean, default: false },    // Can be custom-made to order

  // Applications - Link to use case/context tree
  applicationIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Application"
  }],                                                   // e.g., [id1, id2] where id1="Industrial>Agrícola>Invernaderos"
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);
