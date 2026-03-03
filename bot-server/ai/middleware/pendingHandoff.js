/**
 * Routing middleware: pendingHandoff
 *
 * Catch-all for pending handoff zip/city responses. When a previous handoff
 * asked the user for their location (zip code or city), this middleware
 * resumes that handoff flow. Only runs if no earlier middleware already
 * produced a response.
 */

module.exports = async function pendingHandoff(ctx, next) {
  const { psid, convo, userMessage } = ctx;

  if (!ctx.response && convo?.pendingHandoff) {
    const { resumePendingHandoff } = require("../utils/executeHandoff");
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) {
      ctx.response = pendingResult;
      ctx.handledBy = pendingResult.handledBy || "pending_handoff";
      return;
    }
  }

  await next();
};
