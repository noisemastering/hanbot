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
 * AI-driven: classify buyer intent and profile.
 * Detects reseller intent and adjusts casual/technical profile.
 * @param {string} userMessage
 * @param {string} currentProfile - 'casual' or 'technical'
 * @param {Object} options - { conversationHistory }
 * @returns {Promise<{ isReseller: boolean, profile: string }>}
 */
async function classifyBuyerIntent(userMessage, currentProfile = 'casual', options = {}) {
  if (!userMessage) return { isReseller: false, profile: currentProfile };
  const { conversationHistory = '' } = options;

  try {
    const response = await _openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Analiza el mensaje de un cliente de malla sombra. Responde con JSON:
{ "isReseller": true/false, "profile": "casual"|"technical" }

- isReseller: true si el cliente quiere revender, distribuir, tiene un negocio/tienda y busca vender a sus clientes, o pregunta por márgenes/utilidad.
- profile: "technical" si usa lenguaje técnico (especificaciones, densidad, gramaje, UV, resistencia, fichas técnicas, normas). "casual" si habla de forma cotidiana (para mi casa, mi patio, sirve para, aguanta).
- Perfil actual del cliente: ${currentProfile}. Solo cambia si hay señales claras.`
        },
        { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
      ],
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      isReseller: parsed.isReseller === true,
      profile: PROFILES.includes(parsed.profile) ? parsed.profile : currentProfile
    };
  } catch (err) {
    console.error('❌ [buyer] Intent classification error:', err.message);
    return { isReseller: false, profile: currentProfile };
  }
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
  const { profile: initialProfile = 'casual', conversationHistory = '' } = context;

  // ── AI CLASSIFICATION (reseller detection + profile adjustment) ──
  const { isReseller, profile: adjustedProfile } = await classifyBuyerIntent(
    userMessage, initialProfile, { conversationHistory }
  );

  if (isReseller) {
    console.log('🏛️ [buyer] Reseller intent detected (AI)');
    return { type: 'flow_switch', action: 'reseller', reason: 'Cliente busca revender' };
  }

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
  classifyBuyerIntent,
  getPersonaInstructions,
  PROFILES
};
