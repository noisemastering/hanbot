/**
 * Enrichment middleware: intentClassifier
 *
 * Runs the AI intent classifier on the user's message and stores the
 * result in ctx.classification.  The classifier receives source context
 * and the current conversation flow state so it can make an informed
 * decision about the user's intent.
 *
 * Always calls next() — never sets ctx.response.
 */

const { classify, logClassification } = require("../classifier");

module.exports = async function intentClassifier(ctx, next) {
  const { userMessage, psid, convo, sourceContext, campaignContext } = ctx;

  const conversationFlow = convo?.productSpecs
    ? {
        product: convo.productSpecs.productType,
        stage: convo.lastIntent,
        collected: convo.productSpecs
      }
    : null;

  const classification = await classify(
    userMessage,
    sourceContext,
    conversationFlow,
    campaignContext
  );
  logClassification(psid, userMessage, classification);

  ctx.classification = classification;

  await next();
};
