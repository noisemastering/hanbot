/**
 * Enrichment middleware: specExtractor
 *
 * Extracts product specs (dimensions, percentage, color, quantity, etc.)
 * from the user's message and merges them into the conversation's
 * productSpecs basket.  The extracted specs are also stored on
 * ctx.extractedSpecs so downstream middleware can react to newly
 * provided information without re-parsing.
 *
 * Always calls next() — never sets ctx.response.
 */

const { extractAllSpecs, mergeSpecs } = require("../utils/specExtractor");

module.exports = async function specExtractor(ctx, next) {
  const { userMessage, convo, psid } = ctx;

  const extractedSpecs = extractAllSpecs(userMessage, {
    lastIntent: convo.lastIntent
  });

  ctx.extractedSpecs = extractedSpecs;

  if (Object.keys(extractedSpecs).length > 0) {
    const mergedSpecs = mergeSpecs(convo.productSpecs || {}, extractedSpecs);
    console.log(`🛒 Basket updated:`, JSON.stringify(mergedSpecs));

    ctx.updateConvo({ productSpecs: mergedSpecs }).catch(err =>
      console.error("Error updating productSpecs:", err.message)
    );
    convo.productSpecs = mergedSpecs;
  }

  await next();
};
