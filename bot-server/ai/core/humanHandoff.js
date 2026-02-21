// ai/core/humanHandoff.js
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");
const { isBusinessHours } = require("../utils/businessHours");
const { executeHandoff } = require("../utils/executeHandoff");

/**
 * Detects if user explicitly wants to talk to a human agent
 * @param {string} cleanMsg - Lowercase trimmed message
 * @returns {boolean}
 */
function isHumanHandoffRequest(cleanMsg) {
  // Explicit human contact requests
  const explicitPatterns = [
    /\b(quiero|necesito|puedo|me\s+pued[eo])\s+(hablar|comunicar|contactar|platicar)\s+(con|a)\s+(alguien|una?\s+persona|un\s+humano|ustedes|equipo|asesor|especialista)/i,
    /\b(hablar|comunicar|contactar)\s+con\s+(alguien|una?\s+persona|un\s+asesor|ustedes)/i,
    /\bhab[eé]nenme\b/i,
    /\bll[aá]menme\b/i,
    /\bpasarme\s+con\s+(alguien|un\s+asesor|especialista)/i,
    /\b(necesito|requiero)\s+(un\s+)?(asesor|especialista)/i,
    /\b(me\s+atiend[ea]|que\s+me\s+atiend[ea])\s+(una?\s+persona|alguien|un\s+humano)/i,
    /\bpref(iero|erir[ií]a)\s+(hablar\s+)?con\s+(una?\s+persona|alguien)/i
  ];

  return explicitPatterns.some(pattern => pattern.test(cleanMsg));
}

/**
 * Handles human handoff request
 * @param {string} userMessage - Original user message
 * @param {string} psid - User's page-scoped ID
 * @param {object} convo - Current conversation state
 * @param {string} reason - Why handoff was requested ("explicit", "frustrated", "complex", "auto_escalation")
 * @returns {object} - Response object
 */
async function handleHumanHandoff(userMessage, psid, convo, reason = "explicit") {
  const businessInfo = await getBusinessInfo();

  console.log(`🤝 Human handoff requested by ${psid} - Reason: ${reason}`);

  // WhatsApp link for direct contact
  const whatsappLink = "https://wa.me/524425957432";
  const inBusinessHours = isBusinessHours();

  console.log(`🕒 Handoff during business hours: ${inBusinessHours ? 'YES' : 'NO'}`);

  // Timing suffix based on business hours
  const timingSuffix = inBusinessHours
    ? "Un especialista tomará tu conversación pronto 👍"
    : "Nuestro horario de atención es de lunes a viernes de 9am a 6pm. Un especialista te contactará el siguiente día hábil a primera hora 👍";

  // Different responses based on reason
  const responses = {
    explicit: [
      `Perfecto, te conectaré con uno de nuestros especialistas.\n\nPuedes contactarnos directamente por WhatsApp:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`,
      `Claro, con gusto te paso con nuestro equipo.\n\nEscríbenos por WhatsApp para atención inmediata:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`,
      `Entendido, voy a transferir tu conversación con un especialista.\n\nEscríbenos por WhatsApp:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`
    ],
    frustrated: [
      `Entiendo tu frustración, déjame conectarte con uno de nuestros especialistas para ayudarte mejor.\n\nEscríbenos directo por WhatsApp:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`
    ],
    complex: [
      `Esta consulta requiere atención especializada. Te paso con un especialista que podrá ayudarte mejor.\n\nContáctanos por WhatsApp:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`
    ],
    auto_escalation: [
      `Disculpa que no haya podido ayudarte como esperabas. Déjame conectarte con un especialista.\n\nEscríbenos por WhatsApp:\n\n💬 ${whatsappLink}\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n${timingSuffix}`
    ],
    purchase_help: [
      `¡No te preocupes! Te comunico con un especialista que te puede ayudar a realizar tu compra.\n\n${timingSuffix}`
    ]
  };

  const responseText = responses[reason]
    ? responses[reason][Math.floor(Math.random() * responses[reason].length)]
    : responses.explicit[0];

  const isMallaContext = convo?.productInterest === 'malla_sombra' ||
    convo?.currentFlow === 'malla_sombra' ||
    convo?.currentFlow === 'rollo' ||
    convo?.poiRootId;

  return await executeHandoff(psid, convo, userMessage, {
    reason,
    responsePrefix: responseText,
    lastIntent: 'human_handoff',
    skipChecklist: true,
    timingStyle: 'none',
    includeVideo: isMallaContext,
    extraState: { clarificationCount: 0 }
  });
}

/**
 * Detects frustration in user messages
 * @param {string} cleanMsg - Lowercase trimmed message
 * @returns {boolean}
 */
function detectFrustration(cleanMsg) {
  const frustrationPatterns = [
    /\bno\s+(me\s+)?entiend(es?|en|e)\b/i,
    /\bno\s+(me\s+)?ayu das?\b/i,
    /\bno\s+(me\s+)?sirv(es?|en|e)\b/i,
    /\beres\s+in[uú]til\b/i,
    /\bque\s+mal(o|a)?\s+servicio\b/i,
    /\bpésimo\b/i,
    /\bfrustrante\b/i,
    /\bya\s+te\s+(dije|pregunte)/i,
    /\b(otra|de\s+nuevo|nuevamente)\s+vez\s+lo\s+mismo\b/i
  ];

  return frustrationPatterns.some(pattern => pattern.test(cleanMsg));
}

/**
 * Checks if conversation should be auto-escalated to human
 * @param {object} convo - Conversation object
 * @returns {boolean}
 */
function shouldAutoEscalate(convo) {
  // Escalate after 2 unintelligible messages
  if (convo.clarificationCount >= 2) {
    return true;
  }

  // Escalate after 2 unknown intents
  if (convo.unknownCount >= 2) {
    return true;
  }

  return false;
}

module.exports = {
  isHumanHandoffRequest,
  handleHumanHandoff,
  detectFrustration,
  shouldAutoEscalate
};
