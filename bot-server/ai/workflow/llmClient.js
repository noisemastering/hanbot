// ai/workflow/llmClient.js
//
// LLM client for the workflow engine. Uses OpenAI (the same provider + key the
// rest of the bot runs on: AI_API_KEY / AI_MODEL). Swappable behind this single
// module if we move the engine to another provider later.
const { OpenAI } = require("openai");

// The workflow engine ALWAYS uses gpt-4o (good tool-calling judgment). We do NOT
// fall back to AI_MODEL, because that var may be a weaker/legacy model
// (gpt-4o-mini / gpt-3.5) used elsewhere — inheriting it once made the engine
// behave badly. Override only via an explicit WORKFLOW_MODEL.
const CHAT_MODEL = process.env.WORKFLOW_MODEL || "gpt-4o";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_API_KEY is not set — the workflow engine requires it.");
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

module.exports = { getClient, CHAT_MODEL };
