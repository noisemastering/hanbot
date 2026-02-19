// ai/context/adContextMapper.js
// Maps ad IDs to product context, angle, and audience type
// Uses the Ad model to look up full ad details

const Ad = require("../../models/Ad");
const Campaign = require("../../models/Campaign");
const ProductFamily = require("../../models/ProductFamily");
const { getProductInterest } = require("../utils/productEnricher");
const { resolveByAdId } = require("../../utils/campaignResolver");

/**
 * Product type mapping - consistent naming
 */
const PRODUCT_TYPES = {
  MALLA_SOMBRA: "malla_sombra",
  ROLLO: "rollo",
  BORDE_SEPARADOR: "borde_separador",
  GROUNDCOVER: "groundcover",
  MONOFILAMENTO: "monofilamento",
  UNKNOWN: "unknown"
};

/**
 * Look up ad details and enrich source context
 *
 * @param {object} source - Source context from sourceDetector
 * @returns {object} Enriched source with ad details
 */
async function enrichAdContext(source) {
  if (!source.ad?.id) {
    return source;
  }

  try {
    const ad = await Ad.findOne({ fbAdId: source.ad.id })
      .populate("productIds")
      .populate("mainProductId");

    if (!ad) {
      console.log(`⚠️ Ad ${source.ad.id} not found in database`);
      return source;
    }

    // Use campaign resolver cascade (Ad > AdSet > Campaign) for product and flowRef
    const resolvedSettings = await resolveByAdId(source.ad.id);

    if (resolvedSettings) {
      // Get product from cascaded hierarchy
      const productId = resolvedSettings.mainProductId || resolvedSettings.productIds?.[0];
      if (productId) {
        const productDoc = await ProductFamily.findById(productId).lean();
        if (productDoc) {
          source.ad.product = await getProductInterest(productDoc);
          source.ad.productName = productDoc.name;
        }
      }

      // Store cascaded flowRef
      if (resolvedSettings.flowRef) {
        source.ad.flowRef = resolvedSettings.flowRef;
      }

      // Store cascaded productIds so flows can filter by ad-specific items
      if (resolvedSettings.productIds?.length) {
        source.ad.productIds = resolvedSettings.productIds;
      }

      // Load campaign data from resolved settings
      if (resolvedSettings.campaignId) {
        const campaign = await Campaign.findById(resolvedSettings.campaignId).lean();
        if (campaign) {
          source.ad.campaign = campaign;
          source.ad.campaignId = campaign._id;
          source.ad.campaignGoal = campaign.conversationGoal;
          source.ad.campaignAudience = campaign.audience;
          source.ad.campaignCatalog = campaign.catalog?.url || null;
          console.log(`📣 Campaign loaded from resolver: ${campaign.name} (goal: ${campaign.conversationGoal})`);
        }
      }
    } else {
      // Fallback: get product directly from ad if resolver fails
      const productDoc = ad.mainProductId || ad.productIds?.[0];
      if (productDoc) {
        source.ad.product = await getProductInterest(productDoc);
        source.ad.productName = productDoc.name;
      }
    }

    // Get ad-specific details (angle, intent, creative) — these are ad-level only
    if (ad.adAngle) {
      source.ad.angle = ad.adAngle;
    }

    if (ad.adIntent) {
      source.ad.audienceType = ad.adIntent.audienceType || null;
      source.ad.primaryUse = ad.adIntent.primaryUse || null;
      source.ad.offerHook = ad.adIntent.offerHook || null;
    }

    if (ad.creative) {
      source.ad.headline = ad.creative.headline || null;
      source.ad.callToAction = ad.creative.callToAction || null;
    }

    console.log(`📦 Ad context enriched:`, {
      adId: source.ad.id,
      product: source.ad.product,
      angle: source.ad.angle,
      audienceType: source.ad.audienceType,
      campaignGoal: source.ad.campaignGoal || null
    });

    return source;

  } catch (error) {
    console.error(`❌ Error enriching ad context:`, error);
    return source;
  }
}

/**
 * Infer product from referral ref string (fallback when ad not in DB)
 *
 * @param {string} ref - The ref parameter from m.me link
 * @returns {string|null} Product type or null
 */
function inferProductFromRef(ref) {
  if (!ref) return null;

  const refLower = ref.toLowerCase();

  // Borde separador
  if (refLower.includes("borde") || refLower.includes("separador") || refLower.includes("jardin")) {
    return PRODUCT_TYPES.BORDE_SEPARADOR;
  }

  // Groundcover / antimaleza
  if (refLower.includes("ground") || refLower.includes("cover") || refLower.includes("maleza") || refLower.includes("antimaleza")) {
    return PRODUCT_TYPES.GROUNDCOVER;
  }

  // Rollo
  if (refLower.includes("rollo") || refLower.includes("roll") || refLower.includes("mayoreo") || refLower.includes("bulk")) {
    return PRODUCT_TYPES.ROLLO;
  }

  // Monofilamento
  if (refLower.includes("mono") || refLower.includes("filamento")) {
    return PRODUCT_TYPES.MONOFILAMENTO;
  }

  // Malla sombra (default for malla/sombra mentions)
  if (refLower.includes("malla") || refLower.includes("sombra") || refLower.includes("beige")) {
    return PRODUCT_TYPES.MALLA_SOMBRA;
  }

  return null;
}

/**
 * Get the greeting message based on ad context
 *
 * @param {object} source - Enriched source context
 * @returns {string} Greeting message
 */
function getAdGreeting(source) {
  if (!source.ad?.product) {
    return "👋 ¡Hola! Gracias por contactarnos. ¿Qué tipo de producto te interesa?";
  }

  const greetings = {
    [PRODUCT_TYPES.MALLA_SOMBRA]: "👋 ¡Hola! Veo que te interesa la *malla sombra* 🌿 ¿Qué medida necesitas?",
    [PRODUCT_TYPES.ROLLO]: "👋 ¡Hola! Veo que te interesan los *rollos de malla sombra* 📦 ¿Qué ancho necesitas? Tenemos 2.10m y 4.20m",
    [PRODUCT_TYPES.BORDE_SEPARADOR]: "🌱 ¡Hola! Veo que te interesa el *borde separador para jardín*. ¿Qué largo necesitas?",
    [PRODUCT_TYPES.GROUNDCOVER]: "🌱 ¡Hola! Veo que te interesa el *ground cover antimaleza*. ¿Qué medida necesitas?",
    [PRODUCT_TYPES.MONOFILAMENTO]: "👋 ¡Hola! Veo que te interesa la *malla monofilamento*. ¿Qué porcentaje de sombra necesitas?"
  };

  return greetings[source.ad.product] || "👋 ¡Hola! Gracias por contactarnos. ¿Qué tipo de producto te interesa?";
}

/**
 * Get tone/style hints based on ad angle
 *
 * @param {string} angle - Ad angle from source.ad.angle
 * @returns {object} Tone hints for response generation
 */
function getToneFromAngle(angle) {
  const tones = {
    price_sensitive: {
      emphasis: "value",
      style: "Emphasize competitive pricing and good value",
      avoid: "Don't oversell premium features"
    },
    quality_premium: {
      emphasis: "quality",
      style: "Emphasize durability, materials, and longevity",
      avoid: "Don't lead with price"
    },
    urgency_offer: {
      emphasis: "offer",
      style: "Mention active promotions, create urgency",
      avoid: "Don't be pushy"
    },
    problem_pain: {
      emphasis: "solution",
      style: "Focus on solving their problem (sun, heat, weeds)",
      avoid: "Don't be technical"
    },
    bulk_b2b: {
      emphasis: "volume",
      style: "Professional tone, mention bulk pricing, availability",
      avoid: "Don't be too casual"
    },
    diy_ease: {
      emphasis: "simplicity",
      style: "Emphasize easy installation, DIY-friendly",
      avoid: "Don't overwhelm with technical details"
    },
    comparison_switching: {
      emphasis: "advantage",
      style: "Highlight what makes us better than alternatives",
      avoid: "Don't badmouth competitors"
    }
  };

  return tones[angle] || { emphasis: "neutral", style: "Be helpful and friendly", avoid: "" };
}

module.exports = {
  enrichAdContext,
  inferProductFromRef,
  getAdGreeting,
  getToneFromAngle,
  PRODUCT_TYPES
};
