// models/Campaign.js
const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    // Identificador propio para enlazar con ?ref= en el tráfico (obligatorio y único)
    ref: { type: String, unique: true, required: true }, // p.ej. "malla_beige_conf_2025"

    // Metadatos básicos
    name: { type: String, required: true },             // "Malla Sombra Beige Confeccionada"
    description: { type: String },

    // Facebook Campaign ID
    fbCampaignId: { type: String, unique: true, sparse: true },

    // Ad Account
    fbAdAccountId: String,

    // Estado
    active: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
      default: "ACTIVE"
    },
    startDate: Date,
    endDate: Date,

    // Budget
    dailyBudget: Number,
    lifetimeBudget: Number,

    // Campaign objective
    objective: String,  // e.g., "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES"

    // Enfoque de producto (familia/variante/tipo)
    productFocus: {
      family: { type: String },
      variant: { type: String },
      type: { type: String },
    },


    // Products associated with this campaign
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product"
    }],

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
