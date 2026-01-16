// ai/utils/adContextHelper.js
// Helper functions to tailor responses based on ad context

/**
 * Get angle-specific messaging additions based on adAngle
 * @param {string} adAngle - The ad angle type
 * @returns {object} - Object with greeting, qualifier, and closing additions
 */
function getAngleMessaging(adAngle) {
  const messaging = {
    price_sensitive: {
      qualifier: "al mejor precio",
      emphasis: "precio competitivo",
      closing: "con el mejor precio del mercado"
    },
    quality_premium: {
      qualifier: "de alta calidad",
      emphasis: "calidad premium y durabilidad",
      closing: "con la mejor calidad garantizada"
    },
    urgency_offer: {
      qualifier: "con promoción especial",
      emphasis: "oferta por tiempo limitado",
      closing: "aprovecha la promoción vigente"
    },
    problem_pain: {
      qualifier: "para proteger del sol",
      emphasis: "solución efectiva contra el sol",
      closing: "protege tu espacio del sol intenso"
    },
    bulk_b2b: {
      qualifier: "para tu negocio",
      emphasis: "precios mayoreo disponibles",
      closing: "manejamos volumen con precios especiales"
    },
    diy_ease: {
      qualifier: "fácil de instalar",
      emphasis: "instalación sencilla",
      closing: "la puedes instalar tú mismo fácilmente"
    },
    comparison_switching: {
      qualifier: "la mejor opción",
      emphasis: "mejor relación calidad-precio",
      closing: "la opción más conveniente"
    }
  };

  return messaging[adAngle] || null;
}

/**
 * Get audience-specific language adjustments
 * @param {string} audienceType - The target audience type
 * @returns {object} - Object with tone and terminology adjustments
 */
function getAudienceLanguage(audienceType) {
  if (!audienceType) return null;

  const lowerAudience = audienceType.toLowerCase();

  if (lowerAudience.includes("agricultor") || lowerAudience.includes("vivero") || lowerAudience.includes("agr")) {
    return {
      tone: "técnico",
      greeting: "¡Hola! ¿Buscas malla sombra para tu cultivo?",
      useTerms: ["protección de cultivos", "invernadero", "vivero", "sombreado agrícola"],
      benefits: ["protege tus plantas del sol excesivo", "regula la temperatura", "reduce evaporación"]
    };
  }

  if (lowerAudience.includes("casa") || lowerAudience.includes("hogar") || lowerAudience.includes("residencial")) {
    return {
      tone: "amigable",
      greeting: "¡Hola! ¿Buscas sombra para tu patio o jardín?",
      useTerms: ["patio", "jardín", "terraza", "cochera"],
      benefits: ["disfruta tu espacio exterior", "reduce el calor", "protege del sol"]
    };
  }

  if (lowerAudience.includes("negocio") || lowerAudience.includes("comercial") || lowerAudience.includes("empresa")) {
    return {
      tone: "profesional",
      greeting: "¡Hola! ¿Necesitas malla sombra para tu negocio?",
      useTerms: ["estacionamiento", "área comercial", "instalaciones"],
      benefits: ["protege a tus clientes", "mejora el confort", "solución duradera"]
    };
  }

  return null;
}

/**
 * Apply ad context to a response text
 * @param {string} baseResponse - The base response text
 * @param {object} adContext - The ad context object
 * @param {string} position - Where to add context: "start", "end", or "inline"
 * @returns {string} - Modified response with ad context applied
 */
function applyAdContext(baseResponse, adContext, position = "end") {
  if (!adContext) return baseResponse;

  let additions = [];

  // Add offer hook if present
  if (adContext.adIntent?.offerHook || adContext.creative?.offerHook) {
    const hook = adContext.adIntent?.offerHook || adContext.creative?.offerHook;
    additions.push(`🎁 ${hook}`);
  }

  // Add angle-specific closing
  const angleMsg = getAngleMessaging(adContext.adAngle);
  if (angleMsg?.closing) {
    // Only add if not redundant with offer hook
    if (!additions.some(a => a.toLowerCase().includes(angleMsg.closing.toLowerCase()))) {
      additions.push(`✨ ${angleMsg.closing}`);
    }
  }

  if (additions.length === 0) return baseResponse;

  if (position === "end") {
    return `${baseResponse}\n\n${additions.join("\n")}`;
  } else if (position === "start") {
    return `${additions.join("\n")}\n\n${baseResponse}`;
  }

  return baseResponse;
}

/**
 * Check if we should mention the offer hook in this response
 * @param {object} adContext - The ad context object
 * @param {object} convo - The conversation object
 * @returns {boolean}
 */
function shouldMentionOffer(adContext, convo) {
  if (!adContext?.adIntent?.offerHook && !adContext?.creative?.offerHook) {
    return false;
  }

  // Don't repeat offer too often - check if we mentioned it recently
  if (convo.lastOfferMention) {
    const lastMention = new Date(convo.lastOfferMention);
    const now = new Date();
    const minutesSince = (now - lastMention) / (1000 * 60);
    // Only mention offer again after 10 minutes
    return minutesSince > 10;
  }

  return true;
}

/**
 * Get the offer hook text if available
 * @param {object} adContext - The ad context object
 * @returns {string|null}
 */
function getOfferHook(adContext) {
  return adContext?.adIntent?.offerHook || adContext?.creative?.offerHook || null;
}

module.exports = {
  getAngleMessaging,
  getAudienceLanguage,
  applyAdContext,
  shouldMentionOffer,
  getOfferHook
};
