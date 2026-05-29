// ai/workflow/llmClient.js
//
// LLM client for the workflow engine. Uses OpenAI (the same provider + key the
// rest of the bot runs on: AI_API_KEY / AI_MODEL). Swappable behind this single
// module if we move the engine to another provider later.
const { OpenAI } = require("openai");

// Workflow-specific overrides fall back to the bot-wide settings.
const CHAT_MODEL = process.env.WORKFLOW_MODEL || process.env.AI_MODEL || "gpt-4o";

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
