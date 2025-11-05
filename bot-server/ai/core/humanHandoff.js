// ai/core/humanHandoff.js
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");

/**
 * Detects if user explicitly wants to talk to a human agent
 * @param {string} cleanMsg - Lowercase trimmed message
 * @returns {boolean}
 */
function isHumanHandoffRequest(cleanMsg) {
  // Explicit human contact requests
  const explicitPatterns = [
    /\b(quiero|necesito|puedo|me\s+pued[eo])\s+(hablar|comunicar|contactar|platicar)\s+(con|a)\s+(alguien|una?\s+persona|un\s+humano|ustedes|equipo|asesor)/i,
    /\b(hablar|comunicar|contactar)\s+con\s+(alguien|una?\s+persona|un\s+asesor|ustedes)/i,
    /\bhab[eé]nenme\b/i,
    /\bll[aá]menme\b/i,
    /\bpasarme\s+con\s+(alguien|un\s+asesor)/i,
    /\b(necesito|requiero)\s+(un\s+)?asesor/i,
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

  // Update conversation state to mark handoff request
  await updateConversation(psid, {
    state: "needs_human",
    lastIntent: "human_handoff",
    handoffRequested: true,
    handoffReason: reason,
    handoffTimestamp: new Date(),
    unknownCount: 0,
    clarificationCount: 0
  });

  console.log(`🤝 Human handoff requested by ${psid} - Reason: ${reason}`);

  // Different responses based on reason
  const responses = {
    explicit: [
      `Perfecto, te conectaré con uno de nuestros asesores.\n\nMientras tanto, puedes contactarnos por:\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\nUn asesor tomará tu conversación pronto 👍`,
      `Claro, con gusto te paso con nuestro equipo.\n\nPuedes llamarnos directamente:\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\nO si prefieres, un asesor atenderá tu mensaje en breve 💬`,
      `Entendido, voy a transferir tu conversación con un asesor.\n\nSi es urgente, puedes comunicarte:\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\n¡Un asesor estará contigo pronto! 😊`
    ],
    frustrated: [
      `Entiendo tu frustración, déjame conectarte con uno de nuestros asesores para ayudarte mejor.\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\nUn asesor atenderá tu caso personalmente 🙏`
    ],
    complex: [
      `Esta consulta requiere atención especializada. Te paso con un asesor que podrá ayudarte mejor.\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\nUn experto revisará tu caso pronto 🤓`
    ],
    auto_escalation: [
      `Disculpa que no haya podido ayudarte como esperabas. Déjame conectarte con un asesor.\n\n📞 ${businessInfo.phones.join(" / ")}\n🕓 ${businessInfo.hours}\n\nNuestro equipo te atenderá pronto 💚`
    ]
  };

  const responseText = responses[reason]
    ? responses[reason][Math.floor(Math.random() * responses[reason].length)]
    : responses.explicit[0];

  return {
    type: "text",
    text: responseText
  };
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
