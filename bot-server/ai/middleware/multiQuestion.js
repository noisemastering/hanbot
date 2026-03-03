/**
 * Routing middleware: multiQuestion
 *
 * Detects messages that contain multiple questions or topics (e.g. price +
 * shipping + payment in one message). When detected, delegates to the AI
 * splitter which breaks the message into segments, classifies each one
 * independently, and combines the answers into a single cohesive response.
 */

const { INTENTS } = require("../classifier");

const TOPIC_PATTERNS = [
  /\b(precio|cu[aá]nto|cuesta|vale|costo)\b/i,
  /\b(env[ií][oa]s?|entrega|hacen\s+env[ií]os?)\b/i,
  /\b(pago|forma\s+de\s+pago|tarjeta|contra\s*entrega)\b/i,
  /\b(d[oó]nde\s+est[aá]n|ubicaci[oó]n|direcci[oó]n)\b/i,
  /\b(instala|garant[ií]a|impermeable|material|durabilidad)\b/i,
  /\b(cu[aá]nto\s+tarda|tiempo\s+de\s+entrega)\b/i,
  /\d+(?:\.\d+)?\s*(?:[xX\u00D7*]|(?:metros?\s*)?por)\s*\d+/i,
];

module.exports = async function multiQuestion(ctx, next) {
  const { userMessage, psid, convo, classification, sourceContext, campaign, campaignContext } = ctx;

  const isMultiQuestion =
    classification.intent === INTENTS.MULTI_QUESTION ||
    (userMessage.match(/\?/g) || []).length >= 2 ||
    TOPIC_PATTERNS.filter(p => p.test(userMessage)).length >= 3;

  if (isMultiQuestion) {
    console.log(`\u{1F4CE} Multi-question detected, using AI splitter`);

    const { handleMultiQuestion } = require("../utils/multiQuestionHandler");
    const mqResponse = await handleMultiQuestion(
      userMessage, psid, convo, sourceContext, campaign, campaignContext
    );

    if (mqResponse) {
      ctx.response = mqResponse;
      ctx.handledBy = mqResponse.handledBy || "multi_question";
      return;
    }
  }

  await next();
};
