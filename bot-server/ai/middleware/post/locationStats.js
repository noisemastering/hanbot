/**
 * Post-processor: locationStats
 *
 * Two-part location / statistics question logic:
 *
 * 1. If the response contains a Mercado Libre link, ask the user which city
 *    they're writing from (via appendStatsQuestionIfNeeded).
 *
 * 2. If a previous turn flagged shouldAskLocationStats, append the postal-code
 *    question now and update the conversation state so we don't ask again.
 */

const {
  appendStatsQuestionIfNeeded,
  shouldAskLocationStatsNow,
} = require('../../utils/locationStats');
const { updateConversation } = require('../../../conversationManager');

module.exports = async function locationStats(ctx) {
  const { response, convo, psid } = ctx;

  if (!response || !response.text) return;

  // Part 1 – ML-link stats question
  const statsResult = await appendStatsQuestionIfNeeded(response.text, convo, psid);
  if (statsResult.askedStats) {
    response.text = statsResult.text;
  }

  // Part 2 – deferred location stats question
  if (shouldAskLocationStatsNow(convo)) {
    response.text += '\n\n¿Me puedes compartir tu código postal para fines estadísticos?';
    await updateConversation(psid, {
      askedLocationStats: true,
      shouldAskLocationStats: false,
      pendingLocationResponse: true,
    });
  }
};
