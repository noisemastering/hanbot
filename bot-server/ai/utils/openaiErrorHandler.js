const ApiHealth = require("../../models/ApiHealth");

// In-memory throttle to avoid flooding ApiHealth with duplicate logs
let _lastLoggedAt = 0;
const LOG_THROTTLE_MS = 30_000; // 30 seconds between DB logs for the same service

/**
 * Handle OpenAI API errors: log to ApiHealth, console-warn on quota issues.
 * Call this from any catch block that wraps an OpenAI API call.
 *
 * @param {Error} error - The caught error
 * @param {string} context - Where the error happened, e.g. "intentClassifier", "fallback"
 */
async function handleOpenAIError(error, context = "unknown") {
  const statusCode = error?.status || error?.statusCode || "unknown";
  const isQuotaError = statusCode === 429 ||
    error?.message?.includes("quota") ||
    error?.message?.includes("rate limit") ||
    error?.code === "insufficient_quota";

  // Always log prominently to console
  if (isQuotaError) {
    console.error(`🚨🚨🚨 OPENAI QUOTA/RATE LIMIT ERROR in ${context} — Status: ${statusCode}`);
    console.error(`🚨 Message: ${error.message}`);
    console.error(`🚨 The bot CANNOT respond to customers until credit is added.`);
  }

  // Throttle DB writes to avoid hammering mongo when every message triggers the same 429
  const now = Date.now();
  if (now - _lastLoggedAt < LOG_THROTTLE_MS) return;
  _lastLoggedAt = now;

  try {
    await ApiHealth.logError(
      "openai",
      String(statusCode),
      error.message?.slice(0, 500) || "Unknown OpenAI error",
      { context, isQuotaError, timestamp: new Date().toISOString() }
    );
  } catch (logErr) {
    // Don't let health logging break the main flow
    console.error("⚠️ Failed to log OpenAI error to ApiHealth:", logErr.message);
  }
}

/**
 * Log a successful OpenAI call (resets the error state in ApiHealth).
 * Call this sparingly — e.g. after the first success following errors.
 */
let _lastSuccessLoggedAt = 0;
async function logOpenAISuccess() {
  const now = Date.now();
  if (now - _lastSuccessLoggedAt < LOG_THROTTLE_MS) return;
  _lastSuccessLoggedAt = now;

  try {
    await ApiHealth.logSuccess("openai");
  } catch (err) {
    // silent
  }
}

module.exports = { handleOpenAIError, logOpenAISuccess };
