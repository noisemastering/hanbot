// models/Campaign.js
const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    // Identificador propio para enlazar con ?ref= en el tráfico (obligatorio y único)
    ref: { type: String, unique: true, required: true }, // p.ej. "malla_beige_conf_2025"

    // Metadatos básicos
    name: { type: String, required: true },             // "Malla Sombra Beige Confeccionada"
    description: { type: String },

    // Estado
    active: { type: Boolean, default: true },
    startDate: Date,
    endDate: Date,

    // Origen/Ads: compatible con lo que ya tenías y con lo nuevo
    source: {
      medium: { type: String, default: "facebook_ads" }, // fb, ig, etc.
      ad_account_id: String,
      campaign_id: String,
      adset_id: String,
      ad_id: String
    },

    // Enfoque de producto (familia/variante/tipo)
    productFocus: {
      family: { type: String },
      variant: { type: String },
      type: { type: String },
    },


    // Mensajería / flujo 
    initialMessage: { type: String },     // primer texto al entrar por la campaña
    followupPrompts: [String],            // preguntas guía
    defaultFlow: { type: String, default: "malla_confeccionada" },
    conversionGoal: { type: String, default: "solicitar_cotizacion" },

    // Métricas simples (ampliables después)
    metrics: {
      visits: { type: Number, default: 0 },        // sesiones/entradas con ese ref
      interactions: { type: Number, default: 0 },  // mensajes intercambiados
      clicks: { type: Number, default: 0 },        // clics a links de compra
      leads: { type: Number, default: 0 },         // datos capturados
      conversions: { type: Number, default: 0 },   // compra/intención fuerte
      lastLeadAt: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Campaign", campaignSchema);
