// ai/utils/promptLoader.js
// Loads flow prompts from DB (FlowPrompt model) with in-memory cache.
// Falls back to the hardcoded default if not found in DB.
// Supports {{placeholder}} replacement via vars parameter.

const FlowPrompt = require('../../models/FlowPrompt');

// Cache: { "flow:key": { prompt, loadedAt } }
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function applyVars(template, vars) {
  if (!vars || !template) return template;
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || '');
  }
  return result;
}

/**
 * Get a prompt by flow and key. Returns the DB version if available,
 * otherwise falls back to the provided default.
 *
 * @param {string} flow - e.g. 'masterFlow'
 * @param {string} key - e.g. 'classify'
 * @param {string} defaultPrompt - hardcoded fallback
 * @param {Object} [vars] - optional placeholder replacements { voiceInstructions: '...', channelNote: '...' }
 * @returns {Promise<string>}
 */
async function getPrompt(flow, key, defaultPrompt, vars = null) {
  const cacheKey = `${flow}:${key}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return applyVars(cached.prompt, vars);
  }

  try {
    const doc = await FlowPrompt.findOne({ flow, key }).select('prompt').lean();
    if (doc?.prompt) {
      _cache.set(cacheKey, { prompt: doc.prompt, loadedAt: Date.now() });
      return applyVars(doc.prompt, vars);
    }
  } catch (err) {
    // Non-critical — fall through to default
  }

  return applyVars(defaultPrompt, vars);
}

/**
 * Invalidate cache for a specific prompt (called after dashboard edit).
 */
function invalidateCache(flow, key) {
  if (flow && key) {
    _cache.delete(`${flow}:${key}`);
  } else if (flow) {
    for (const k of _cache.keys()) {
      if (k.startsWith(`${flow}:`)) _cache.delete(k);
    }
  } else {
    _cache.clear();
  }
}

module.exports = { getPrompt, invalidateCache };
