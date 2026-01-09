// models/CampaignProduct.js
const mongoose = require("mongoose");

const campaignProductSchema = new mongoose.Schema(
  {
    campaignRef: { type: String, required: true, index: true }, // ej: "hanlob_confeccionada_general_oct25"
    
    name: { type: String, required: true }, // Malla sombra confeccionada 90% beige
    shortName: { type: String }, // "Malla sombra beige"
    shade: { type: String, default: "90%" },
    color: { type: String, default: "Beige" },

    descriptionVariants: [
      {
        title: String,           // Opcional: "Cálida y enfocada en acción"
        body: String,            // Texto principal de descripción
        callToAction: String,    // Pregunta o cierre del bloque
      }
    ],

    features: [String],          // ["Refuerzos en esquinas", "Argollas en todo el borde", "Fabricación de larga duración"]

    variants: [
      {
        size: { type: String, required: true },
        price: { type: Number, required: true },
        stock: { type: Boolean, default: true },
        source: { type: String, enum: ["local", "mercadolibre"], default: "local" },
        permalink: String,       // link de compra
        imageUrl: String
      }
    ],

    // Control de sugerencias en caso de medida no disponible
    suggestClosest: { type: Boolean, default: true },

    // Fallback genérico
    fallbackMessage: {
      type: String,
      default: "Los precios van desde $320 hasta $1,800 dependiendo de la medida 📐\n\n¿Qué medida necesitas?"
    },

    relatedVariants: [
        {
            color: String,           // "Verde", "Azul"
            shape: String,           // "Triangular", "Rectangular"
            withHooks: { type: Boolean, default: true }, // con o sin argollas
            availability: { type: Boolean, default: true },
            note: String              // "Disponible bajo pedido", "Edición especial"
        }
    ],


    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CampaignProduct", campaignProductSchema);
