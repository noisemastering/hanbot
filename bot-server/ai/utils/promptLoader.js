// ai/utils/promptLoader.js
// Loads flow prompts from DB (FlowPrompt model) with in-memory cache.
// Falls back to the hardcoded default if not found in DB.
// Supports {{placeholder}} replacement via vars parameter.

const FlowPrompt = require('../../models/FlowPrompt');

// Cache: { "flow:key": { prompt, loadedAt } }
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cached CompanyInfo → flat {{company.*}} vars, auto-injected into every prompt
// so any prompt can reference them without declaring each var at the call site.
let _companyVars = null;
let _companyVarsAt = 0;
async function getCompanyVars() {
  try {
    if (_companyVars && Date.now() - _companyVarsAt < CACHE_TTL) return _companyVars;
    const CompanyInfo = require('../../models/CompanyInfo');
    const ci = await CompanyInfo.findById('hanlob').lean();
    if (!ci) return _companyVars || {};
    const phones = (ci.phones || []).map((p) => p.number).filter(Boolean);
    const waPhone = (ci.phones || []).find((p) => /whats/i.test(p.label || ''));
    const email = (ci.emails || []).find((e) => e.email)?.email || '';
    const fullAddress = [ci.address, ci.city, ci.state, ci.zipCode, ci.country]
      .filter(Boolean)
      .join(', ');
    const hours = (ci.schedule || [])
      .filter((s) => !s.closed && s.open && s.close)
      .map((s) => `${s.day} ${s.open}-${s.close}`)
      .join(', ');
    _companyVars = {
      'company.name': ci.name || '',
      'company.address': ci.address || '',
      'company.fullAddress': fullAddress,
      'company.hours': hours,
      'company.phones': phones.join(' / '),
      'company.whatsapp': waPhone?.number || phones[0] || '',
      'company.website': ci.website || '',
      'company.googleMaps': ci.googleMapsUrl || '',
      'company.email': email,
    };
    _companyVarsAt = Date.now();
    return _companyVars;
  } catch (err) {
    return _companyVars || {};
  }
}

function applyVars(template, vars) {
  if (!template) return template;
  if (!vars || Object.keys(vars).length === 0) return template;
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // dotted keys like company.name
    result = result.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), v == null ? '' : String(v));
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
  // Auto-inject company vars ({{company.*}}); explicit call-site vars override.
  const companyVars = await getCompanyVars();
  const mergedVars = { ...companyVars, ...(vars || {}) };

  const cacheKey = `${flow}:${key}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return applyVars(cached.prompt, mergedVars);
  }

  try {
    const doc = await FlowPrompt.findOne({ flow, key }).select('prompt').lean();
    if (doc?.prompt) {
      _cache.set(cacheKey, { prompt: doc.prompt, loadedAt: Date.now() });
      return applyVars(doc.prompt, mergedVars);
    }
  } catch (err) {
    // Non-critical — fall through to default
  }

  return applyVars(defaultPrompt, mergedVars);
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
