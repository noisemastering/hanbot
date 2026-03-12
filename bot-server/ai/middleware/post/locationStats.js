/**
 * Post-processor: locationStats
 *
 * Appends zip code question to responses that contain a Mercado Libre link
 * (price quotes with purchase links). The question is asked in the same
 * message as the price quote.
 */

const {
  appendStatsQuestionIfNeeded,
} = require('../../utils/locationStats');

module.exports = async function locationStats(ctx) {
  const { response, convo, psid } = ctx;

  if (!response || !response.text) return;

  const statsResult = await appendStatsQuestionIfNeeded(response.text, convo, psid);
  if (statsResult.askedStats) {
    response.text = statsResult.text;
  }
};
