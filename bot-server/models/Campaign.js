// models/Campaign.js
const mongoose = require("mongoose");

/**
 * Campaign Product Schema
 * Defines products available in this campaign with constraints
 */
const campaignProductSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String },
  primaryBenefit: { type: String },
  commonUses: [String],
  constraints: {
    soldBy: { type: String }, // "metro", "rollo", "pieza"
    requiresQuote: { type: Boolean, default: false },
    minOrder: { type: Number },
    maxOrder: { type: Number }
  },
  // Link to ProductFamily if available
  productFamilyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProductFamily"
  },
  // Direct ML link if available
  mlLink: { type: String }
}, { _id: false });

/**
 * Campaign Schema
 * Provides context for AI to handle conversations from specific ads/campaigns
 */
const campaignSchema = new mongoose.Schema(
  {
    // ====== IDENTIFICATION ======
    ref: { type: String, unique: true, required: true }, // e.g. "malla_beige_conf_2025"
    name: { type: String, required: true },
    description: { type: String },
    active: { type: Boolean, default: true },

    // ====== TRAFFIC SOURCE ======
    trafficSource: {
      type: String,
      enum: ["facebook_ad", "instagram_ad", "google_ad", "organic", "referral", "direct"],
      default: "facebook_ad"
    },

    // ====== AD CONTEXT ======
    // What the ad promised - helps AI acknowledge and deliver
    ad: {
      angle: {
        type: String,
        enum: [
          null, "",          // Allow empty
          "problem_pain",    // "Evita quemaduras en tus cultivos"
          "price_value",     // "Desde $320"
          "quality",         // "La mejor malla del mercado"
          "urgency",         // "Últimas piezas"
          "social_proof",    // "Miles de clientes satisfechos"
          "convenience",     // "Envío gratis a todo México"
          "bulk_b2b",        // "Precios de mayoreo"
          "diy_ease",        // "Fácil de instalar"
          "comparison"       // "Mejor que la competencia"
        ]
      },
      summary: { type: String }, // Brief description of ad message
      cta: { type: String },     // "Cotizar ahora", "Ver precios", "Comprar"
      offerHook: { type: String } // Specific offer: "20% desc", "Envío gratis"
    },

    // ====== TARGET AUDIENCE ======
    audience: {
      type: {
        type: String,
        enum: [
          null, "",          // Allow empty
          "homeowner",       // Casa/jardín personal
          "farmer",          // Agricultor
          "greenhouse",      // Invernadero/vivero
          "business",        // Negocio (estacionamiento, restaurante)
          "contractor",      // Instalador/contratista
          "reseller"         // Revendedor
        ]
      },
      experienceLevel: {
        type: String,
        enum: [null, "", "beginner", "practical", "expert"],
        default: "practical"
      }
    },

    // ====== PRODUCTS ======
    products: [campaignProductSchema],

    // Legacy: link to ProductFamily (kept for backwards compatibility)
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductFamily"
    }],

    // ====== CONVERSATION GOAL ======
    conversationGoal: {
      type: String,
      enum: [
        "cotizacion",        // Get quote request, hand to human
        "venta_directa",     // Direct to ML link for purchase
        "lead_capture",      // Capture contact info
        "informacion"        // Just provide information
      ],
      default: "cotizacion"
    },

    // ====== RESPONSE GUIDELINES ======
    responseGuidelines: {
      tone: {
        type: String,
        default: "claro, directo y útil"
      },
      mustNot: {
        type: [String],
        default: [
          "inventar precios",
          "prometer disponibilidad sin confirmar",
          "ofrecer descuentos no autorizados"
        ]
      },
      shouldDo: {
        type: [String],
        default: [
          "confirmar el producto de interés",
          "preguntar medidas si aplica",
          "ofrecer ayuda de asesor si es necesario"
        ]
      }
    },

    // ====== INITIAL MESSAGING ======
    initialMessage: { type: String },
    followupPrompts: [String],

    // ====== CATALOG / FILES ======
    catalog: {
      url: { type: String },           // Cloudinary URL to PDF
      publicId: { type: String },      // Cloudinary public_id for deletion
      name: { type: String },          // Original filename
      uploadedAt: { type: Date }
    },

    // ====== FACEBOOK/META INTEGRATION ======
    fbCampaignId: { type: String, unique: true, sparse: true },
    fbAdAccountId: { type: String },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
      default: "ACTIVE"
    },
    startDate: { type: Date },
    endDate: { type: Date },

    // ====== BUDGET (from Meta) ======
    dailyBudget: { type: Number },
    lifetimeBudget: { type: Number },
    objective: { type: String },

    // ====== METRICS ======
    metrics: {
      visits: { type: Number, default: 0 },
      interactions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      leads: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      lastLeadAt: { type: Date }
    }
  },
  { timestamps: true }
);

/**
 * Build context object for AI classifier
 * Returns the structure needed for the AI prompt
 */
campaignSchema.methods.toAIContext = function() {
  return {
    traffic_source: this.trafficSource,
    ad: {
      angle: this.ad?.angle,
      summary: this.ad?.summary,
      cta: this.ad?.cta,
      offer_hook: this.ad?.offerHook
    },
    audience: {
      type: this.audience?.type,
      experience_level: this.audience?.experienceLevel
    },
    products: this.products.map(p => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      primary_benefit: p.primaryBenefit,
      common_uses: p.commonUses,
      constraints: {
        sold_by: p.constraints?.soldBy,
        requires_quote: p.constraints?.requiresQuote
      }
    })),
    conversation_goal: this.conversationGoal,
    response_guidelines: {
      tone: this.responseGuidelines?.tone,
      must_not: this.responseGuidelines?.mustNot,
      should_do: this.responseGuidelines?.shouldDo
    }
  };
};

/**
 * Check if any product requires a quote (vs direct ML sale)
 */
campaignSchema.methods.requiresQuote = function() {
  return this.products.some(p => p.constraints?.requiresQuote);
};

/**
 * Get product by SKU
 */
campaignSchema.methods.getProduct = function(sku) {
  return this.products.find(p => p.sku === sku);
};

module.exports = mongoose.model("Campaign", campaignSchema);
