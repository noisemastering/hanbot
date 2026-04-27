// utils/aiUsageTracker.js
// Tracks OpenAI API usage in-memory and alerts when approaching limits.
// Persists daily totals to MongoDB for historical tracking.

const mongoose = require('mongoose');

// In-memory counters (reset daily)
let dailyCalls = 0;
let dailyTokens = 0;
let dailyErrors = 0;
let lastQuotaError = null;
let lastResetDate = new Date().toISOString().split('T')[0];

// Cost estimates per 1K tokens (approximate, varies by model)
const COST_PER_1K = {
  'gpt-4o': 0.005,
  'gpt-4o-mini': 0.00015,
  'gpt-4': 0.03,
  'gpt-3.5-turbo': 0.0005,
  'default': 0.001
};

// Budget threshold (MXN) — alert when estimated daily cost exceeds this
let DAILY_BUDGET_ALERT = parseFloat(process.env.AI_DAILY_BUDGET_ALERT || '50'); // $50 MXN default

/**
 * Record an API call and its token usage.
 */
function recordCall(model, promptTokens, completionTokens) {
  resetIfNewDay();
  dailyCalls++;
  const tokens = (promptTokens || 0) + (completionTokens || 0);
  dailyTokens += tokens;
}

/**
 * Record an API error.
 */
function recordError(error) {
  resetIfNewDay();
  dailyErrors++;

  const status = error?.response?.status || error?.status;
  const code = error?.response?.data?.error?.code || error?.code;
  const message = error?.response?.data?.error?.message || error?.message || '';

  // Detect quota/billing errors
  if (status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded' ||
      message.includes('exceeded your current quota') || message.includes('billing')) {
    lastQuotaError = {
      at: new Date(),
      status,
      code,
      message: message.slice(0, 200)
    };
    console.error('🚨 AI QUOTA WARNING:', message.slice(0, 200));
  }
}

/**
 * Get current usage stats.
 */
function getStats() {
  resetIfNewDay();
  const costPerK = COST_PER_1K['gpt-4o-mini']; // Primary model
  const estimatedCostUSD = (dailyTokens / 1000) * costPerK;
  const estimatedCostMXN = estimatedCostUSD * 17; // Approximate USD→MXN

  return {
    date: lastResetDate,
    calls: dailyCalls,
    tokens: dailyTokens,
    errors: dailyErrors,
    estimatedCostUSD: +estimatedCostUSD.toFixed(4),
    estimatedCostMXN: +estimatedCostMXN.toFixed(2),
    budgetAlert: DAILY_BUDGET_ALERT,
    budgetUsedPct: DAILY_BUDGET_ALERT > 0 ? Math.round(estimatedCostMXN / DAILY_BUDGET_ALERT * 100) : 0,
    quotaError: lastQuotaError,
    status: lastQuotaError && (Date.now() - new Date(lastQuotaError.at).getTime() < 3600000)
      ? 'critical'
      : estimatedCostMXN > DAILY_BUDGET_ALERT * 0.8
        ? 'warning'
        : 'ok'
  };
}

function resetIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    // Persist yesterday's stats before reset
    persistStats();
    dailyCalls = 0;
    dailyTokens = 0;
    dailyErrors = 0;
    lastResetDate = today;
  }
}

async function persistStats() {
  try {
    const ApiHealth = require('../models/ApiHealth');
    await ApiHealth.findOneAndUpdate(
      { service: 'openai', date: lastResetDate },
      {
        service: 'openai',
        date: lastResetDate,
        calls: dailyCalls,
        tokens: dailyTokens,
        errors: dailyErrors,
        updatedAt: new Date()
      },
      { upsert: true }
    );
  } catch (e) {
    // Non-critical
  }
}

module.exports = { recordCall, recordError, getStats };
