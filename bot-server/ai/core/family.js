// ai/core/family.js
const { updateConversation } = require("../../conversationManager");
const { findFamily } = require("../../familySearch");
const { findProductFamily } = require("../../hybridSearch");

async function handleFamilyFlow(cleanMsg, psid, convo) {
  const familyDetected = await findFamily(cleanMsg);
  if (!familyDetected) return null;

  // 🔴 SKIP if message contains MULTIPLE questions (let fallback handle comprehensive answer)
  const multiQuestionIndicators = [
    /precio|costo|cu[aá]nto.*(?:cuesta|vale)/i, // Price questions
    /\b(si|funciona|repele|impermeable|agua)\b.*\b(agua|repele|impermeable|funciona)/i, // Water/function questions
    /\by\s+(si|funciona|repele|tiempo|entrega|pago|forma|cuanto|donde)/i, // Multiple questions with "y"
    /\btambién|además|ademas/i, // Also/additionally
    /\?.*\?/, // Multiple question marks
    /,.*\b(y|si|tiempo|entrega|pago|forma|costo|precio)/i // Commas followed by other questions
  ];

  const isMultiQuestion = multiQuestionIndicators.some(regex => regex.test(cleanMsg));
  if (isMultiQuestion) {
    console.log("⏩ Multi-question detected in handleFamilyFlow, skipping to fallback");
    return null; // Let fallback handle it with complete answer
  }

  if (convo.familyShown === familyDetected.name) {
    await updateConversation(psid, { lastIntent: "family_repeat", unknownCount: 0 });
    return { type: "text", text: `Claro 😊, seguimos con ${familyDetected.name.toLowerCase()}. ¿Te interesa ver las opciones en beige confeccionada o en rollos monofilamento?` };
  }

  await updateConversation(psid, { familyShown: familyDetected.name, lastIntent: "family_info", unknownCount: 0 });

  if (!familyDetected.active) {
    return { type: "text", text: `Por ahora la familia ${familyDetected.name} no está disponible, pero pronto tendremos novedades. 🌱` };
  }

  if (!familyDetected.hasProducts) {
    return { type: "text", text: `Por ahora no tenemos productos disponibles en la familia ${familyDetected.name}, pero pronto los agregaremos. 😊` };
  }

  const familyInfo = await findProductFamily(cleanMsg);
  if (familyInfo) {
    return {
      type: "image",
      text:
        `Sí, contamos con ${familyInfo.name.toLowerCase()} 🌿\n` +
        `${familyInfo.description}\n\nUsos comunes:\n- ${familyInfo.commonUses?.join("\n- ") || "Jardines e invernaderos"}\n\n` +
        `¿Quieres ver opciones beige confeccionadas o en rollo monofilamento?`,
      imageUrl: familyInfo.imageUrl || "https://i.imgur.com/X3vYt8E.png"
    };
  }

  return {
    type: "text",
    text: `Sí, contamos con ${familyDetected.name.toLowerCase()}. ${familyDetected.description}\n¿Buscas algún tipo en especial, como beige o monofilamento?`
  };
}

module.exports = { handleFamilyFlow };
