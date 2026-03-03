/**
 * Post-processor: repetitionCheck
 *
 * Runs the repetition checker on the final response.  If the bot is about to
 * send something it already said recently, checkForRepetition will rephrase
 * or adjust the response.  The returned value replaces ctx.response.
 */

const { checkForRepetition } = require('../../utils/repetitionChecker');

module.exports = async function repetitionCheck(ctx) {
  const { response, psid, convo } = ctx;

  ctx.response = await checkForRepetition(response, psid, convo);
};
