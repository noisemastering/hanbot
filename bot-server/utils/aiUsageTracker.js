// utils/aiUsageTracker.js
// Tracks OpenAI API usage in-memory and alerts when approaching limits.
// Persists daily totals to MongoDB for historical tracking.
// Tracks both daily and monthly cumulative usage.

// In-memory counters (reset daily)
let dailyCalls = 0;
let dailyTokens = 0;
let dailyErrors = 0;
let lastQuotaError = null;
let lastResetDate = new Date().toISOString().split('T')[0];

// Monthly cumulative (reset on 1st of month)
let monthlyCalls = 0;
let monthlyTokens = 0;
let monthlyErrors = 0;
let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
let monthlyLoaded = false;

// Per-model token tracking for accurate cost
let modelTokens = {};

// Cost estimates per 1K tokens (USD)
const COST_PER_1K = {
  'gpt-4o': 0.005,
  'gpt-4o-mini': 0.00015,
  'gpt-4': 0.03,
  'gpt-3.5-turbo': 0.0005
};
const DEFAULT_COST = 0.001;

// Budget thresholds
const DAILY_BUDGET_MXN = parseFloat(process.env.AI_DAILY_BUDGET_ALERT || '50');
const MONTHLY_BUDGET_MXN = parseFloat(process.env.AI_MONTHLY_BUDGET_ALERT || '1500');
const USD_TO_MXN = 17;

function estimateCost(tokens, model) {
  const rate = COST_PER_1K[model] || DEFAULT_COST;
  return (tokens / 1000) * rate;
}

function recordCall(model, promptTokens, completionTokens) {
  resetIfNewDay();
  const tokens = (promptTokens || 0) + (completionTokens || 0);
  dailyCalls++;
  dailyTokens += tokens;
  monthlyCalls++;
  monthlyTokens += tokens;

  const m = model || 'unknown';
  if (!modelTokens[m]) modelTokens[m] = 0;
  modelTokens[m] += tokens;
}

function recordError(error) {
  resetIfNewDay();
  dailyErrors++;
  monthlyErrors++;

  const status = error?.response?.status || error?.status;
  const code = error?.response?.data?.error?.code || error?.code;
  const message = error?.response?.data?.error?.message || error?.message || '';

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

function getStats() {
  resetIfNewDay();

  // Daily cost estimate (use per-model breakdown for accuracy)
  let dailyCostUSD = 0;
  let monthlyCostUSD = 0;
  for (const [model, tokens] of Object.entries(modelTokens)) {
    const rate = COST_PER_1K[model] || DEFAULT_COST;
    // We can't separate daily vs monthly per model, so use overall ratio
    const dailyRatio = dailyTokens > 0 ? dailyTokens / monthlyTokens : 0;
    monthlyCostUSD += (tokens / 1000) * rate;
    dailyCostUSD += (tokens / 1000) * rate * dailyRatio;
  }
  // Fallback if no model breakdown
  if (monthlyCostUSD === 0 && monthlyTokens > 0) {
    monthlyCostUSD = (monthlyTokens / 1000) * DEFAULT_COST;
    dailyCostUSD = (dailyTokens / 1000) * DEFAULT_COST;
  }

  const dailyCostMXN = +(dailyCostUSD * USD_TO_MXN).toFixed(2);
  const monthlyCostMXN = +(monthlyCostUSD * USD_TO_MXN).toFixed(2);

  // Status: critical > warning > ok
  let status = 'ok';
  if (lastQuotaError && (Date.now() - new Date(lastQuotaError.at).getTime() < 3600000)) {
    status = 'critical';
  } else if (monthlyCostMXN > MONTHLY_BUDGET_MXN * 0.8 || dailyCostMXN > DAILY_BUDGET_MXN * 0.8) {
    status = 'warning';
  }

  return {
    // Daily
    date: lastResetDate,
    dailyCalls,
    dailyTokens,
    dailyErrors,
    dailyCostMXN,
    dailyBudget: DAILY_BUDGET_MXN,
    dailyBudgetPct: DAILY_BUDGET_MXN > 0 ? Math.round(dailyCostMXN / DAILY_BUDGET_MXN * 100) : 0,
    // Monthly
    month: currentMonth,
    monthlyCalls,
    monthlyTokens,
    monthlyErrors,
    monthlyCostUSD: +monthlyCostUSD.toFixed(4),
    monthlyCostMXN,
    monthlyBudget: MONTHLY_BUDGET_MXN,
    monthlyBudgetPct: MONTHLY_BUDGET_MXN > 0 ? Math.round(monthlyCostMXN / MONTHLY_BUDGET_MXN * 100) : 0,
    // Error state
    quotaError: lastQuotaError,
    status
  };
}

function resetIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.slice(0, 7);

  if (today !== lastResetDate) {
    persistStats();
    dailyCalls = 0;
    dailyTokens = 0;
    dailyErrors = 0;
    lastResetDate = today;
  }

  if (thisMonth !== currentMonth) {
    // New month — reset monthly counters
    monthlyCalls = 0;
    monthlyTokens = 0;
    monthlyErrors = 0;
    modelTokens = {};
    currentMonth = thisMonth;
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
