// ai/flows/buyerFlow.js
// Model flow — persona layer for end buyers.
// Does NOT handle products or sales process directly.
// Shapes tone, detail level, and info presentation for other flows.
// Detects reseller intent and triggers flow switch.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Valid buyer profiles.
 * casual: everyday customer, simple language, focus on benefits
 * technical: contractor/professional, detailed specs, focus on features
 */
const PROFILES = ['casual', 'technical'];

/**
 * Detect if the buyer is actually looking to resell.
 * @param {string} userMessage
 * @returns {boolean}
 */
function detectReseller(userMessage) {
  if (!userMessage) return false;
  const resellerPatterns = /\b(revender|reventa|para\s*vender|mi\s*negocio|mi\s*tienda|distribuir|cliente[s]?\s*me\s*piden|para\s*ofrecer|margen|utilidad|ganancia)\b/i;
  return resellerPatterns.test(userMessage);
}

/**
 * Evaluate if the buyer profile should adjust based on conversation.
 * @param {string} userMessage
 * @param {string} currentProfile - 'casual' or 'technical'
 * @returns {string} adjusted profile
 */
function evaluateProfile(userMessage, currentProfile) {
  if (!userMessage) return currentProfile;
  const technicalSignals = /\b(especificaciones|densidad|gramaje|denier|UV|tensión|resistencia|norma|certificad|ficha\s*técnica|dato[s]?\s*técnico|protección\s*solar|factor\s*de\s*sombra)\b/i;
  const casualSignals = /\b(bonit[ao]|que\s*tal\s*sale|sirve\s*para|aguanta|jala|funciona|para\s*mi\s*patio|para\s*mi\s*casa|mi\s*cochera|mi\s*terraza)\b/i;

  if (technicalSignals.test(userMessage) && currentProfile === 'casual') return 'technical';
  if (casualSignals.test(userMessage) && currentProfile === 'technical') return 'casual';
  return currentProfile;
}

/**
 * Build persona instructions for AI prompts used by other flows.
 * @param {string} profile - 'casual' or 'technical'
 * @returns {string} instruction block to inject into AI prompts
 */
function getPersonaInstructions(profile) {
  if (profile === 'technical') {
    return `PERFIL DEL CLIENTE: Comprador técnico/profesional (contratista, instalador, etc.)
TONO: Profesional y preciso. Usa terminología técnica cuando sea relevante.
INFORMACIÓN: Enfócate en especificaciones del producto: porcentaje de sombra, gramaje, resistencia UV, material, durabilidad, dimensiones exactas.
OBJETIVO: El cliente busca el producto correcto para un proyecto. Dale datos concretos para que tome una decisión informada.`;
  }

  return `PERFIL DEL CLIENTE: Comprador casual (uso personal, casa, negocio pequeño).
TONO: Amigable y sencillo. Evita tecnicismos innecesarios.
INFORMACIÓN: Enfócate en beneficios prácticos: para qué sirve, cómo se ve, qué tan fácil es de instalar, qué colores hay.
OBJETIVO: El cliente quiere resolver una necesidad. Ayúdale a elegir sin abrumarlo con datos técnicos.`;
}

/**
 * Handle buyer persona evaluation.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context - { profile }
 *   profile: 'casual' | 'technical' — starting point from manifest
 * @returns {{ type: string, action?: string, profile: string, personaInstructions: string }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const { profile: initialProfile = 'casual' } = context;

  // ── RESELLER DETECTION ──
  if (detectReseller(userMessage)) {
    console.log('🏛️ [buyer] Reseller intent detected');
    return { type: 'flow_switch', action: 'reseller', reason: 'Cliente busca revender' };
  }

  // ── PROFILE ADJUSTMENT ──
  const adjustedProfile = evaluateProfile(userMessage, initialProfile);
  if (adjustedProfile !== initialProfile) {
    console.log(`🏛️ [buyer] Profile adjusted: ${initialProfile} → ${adjustedProfile}`);
  }

  // ── RETURN PERSONA FOR OTHER FLOWS TO USE ──
  return {
    type: 'persona',
    profile: adjustedProfile,
    personaInstructions: getPersonaInstructions(adjustedProfile)
  };
}

module.exports = {
  handle,
  detectReseller,
  evaluateProfile,
  getPersonaInstructions,
  PROFILES
};
