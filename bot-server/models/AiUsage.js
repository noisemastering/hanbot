// models/AiUsage.js
//
// Per-call OpenAI token-usage telemetry. One document per chat.completions call,
// written fire-and-forget by ai/utils/aiUsageLogger.js (a global patch on the
// OpenAI SDK, so it captures EVERY call site — workflow engine, verifier, and
// all the gpt-4o-mini classifiers/extractors — without touching each caller).
//
// Powers the super-admin "Costos IA" view: real spend by day / by model and the
// true cost-per-conversation, replacing the hand estimates.
const mongoose = require("mongoose");

const aiUsageSchema = new mongoose.Schema(
  {
    model: { type: String, index: true },     // e.g. "gpt-5.4-mini", "gpt-4o", "gpt-4o-mini"
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 }, // includes reasoning tokens
    reasoningTokens: { type: Number, default: 0 },  // subset of completion, tracked for visibility
    cachedTokens: { type: Number, default: 0 },     // subset of prompt, billed at a discount
    totalTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    source: { type: String, default: null },   // optional coarse label (reserved)
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model("AiUsage", aiUsageSchema);
