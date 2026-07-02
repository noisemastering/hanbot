// ai/utils/aiUsageLogger.js
//
// Detailed, PERSISTENT per-call token telemetry — one AiUsage document per
// OpenAI chat.completions call, with an accurate USD cost (current input/output
// prices, cached-input discount, reasoning tokens). This is what powers the
// super-admin "Costos IA" view: real spend by day / by model and the true
// cost-per-conversation.
//
// It does NOT patch the SDK itself. index.js already monkey-patches
// OpenAI's completions.create (for the in-memory budget tracker); that single
// patch calls recordUsage() here with the full usage object. Keeping one patch
// avoids double-counting and load-order surprises.
//
// SAFETY: recordUsage is fire-and-forget — it never blocks a reply, never
// throws, and swallows its own errors. If it fails, the bot is unaffected.

// Prices per 1,000,000 tokens (USD). Reasoning tokens bill as OUTPUT and are
// already included by OpenAI in completion_tokens, so `out` covers them.
// cachedIn = discounted rate for prompt tokens served from the prompt cache
// (usage.prompt_tokens_details.cached_tokens).
const PRICES = {
  "gpt-4o":        { in: 2.50, cachedIn: 1.25, out: 10.00 },
  "gpt-4o-mini":   { in: 0.15, cachedIn: 0.075, out: 0.60 },
  "gpt-5.4-mini":  { in: 0.75, cachedIn: 0.375, out: 4.50 },
  "gpt-5.4":       { in: 2.50, cachedIn: 1.25, out: 15.00 },
  "gpt-5.5":       { in: 5.00, cachedIn: 2.50, out: 30.00 },
};

// Resolve a price entry. Exact match first, then longest-prefix match so dated
// snapshots (e.g. "gpt-4o-2024-08-06") map to their base price.
function priceFor(model) {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  return key ? PRICES[key] : null;
}

// USD cost from a usage object. Cached prompt tokens billed at cachedIn; the
// rest of the prompt at the full input rate.
function computeCost(model, usage) {
  const p = priceFor(model);
  if (!p || !usage) return 0;
  const promptTok = usage.prompt_tokens || 0;
  const cachedTok = usage.prompt_tokens_details?.cached_tokens || 0;
  const uncachedIn = Math.max(0, promptTok - cachedTok);
  const outTok = usage.completion_tokens || 0;
  return (uncachedIn * p.in + cachedTok * (p.cachedIn ?? p.in) + outTok * p.out) / 1e6;
}

// Persist one usage record. Fire-and-forget: never blocks, never throws.
function recordUsage(model, usage) {
  try {
    if (!usage) return;
    const AiUsage = require("../../models/AiUsage");
    AiUsage.create({
      model: model || "unknown",
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costUsd: computeCost(model, usage),
    }).catch(() => {});
  } catch {
    /* swallow — telemetry must never affect the bot */
  }
}

module.exports = { recordUsage, computeCost, priceFor, PRICES };
