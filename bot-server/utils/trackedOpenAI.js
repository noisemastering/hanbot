// utils/trackedOpenAI.js
// Wraps the OpenAI SDK to automatically track usage on every API call.
// Import this instead of 'openai' to get automatic tracking.

const { OpenAI } = require('openai');
const { recordCall, recordError } = require('./aiUsageTracker');

// Singleton — shared across the entire app
let _instance = null;

function getTrackedClient() {
  if (_instance) return _instance;

  const client = new OpenAI({ apiKey: process.env.AI_API_KEY });

  // Wrap chat.completions.create to track usage
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function (...args) {
    try {
      const result = await originalCreate(...args);

      // Track usage from response
      if (result?.usage) {
        const model = result.model || args[0]?.model || 'unknown';
        recordCall(model, result.usage.prompt_tokens, result.usage.completion_tokens);
      }

      return result;
    } catch (err) {
      recordError(err);
      throw err; // Re-throw so callers handle it normally
    }
  };

  _instance = client;
  return client;
}

module.exports = { getTrackedClient };
