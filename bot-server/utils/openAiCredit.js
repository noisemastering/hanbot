// utils/openAiCredit.js
//
// "How much OpenAI credit is left, and warn me at $5." (user's request, 2026-10-27 —
// super_admin only.)
//
// THE BALANCE CANNOT BE READ FROM THE API. A `sk-proj-` key gets 403 on
// `/v1/organization/costs` (missing scope `api.usage.read`), and
// `/dashboard/billing/credit_grants` answers "This endpoint is only available through a
// browser". There is no endpoint that returns a prepaid credit balance at all. So the
// number is anchored by hand — the super_admin reads it off the billing page and types
// it in — and drawn down from there by our OWN per-call cost records (`AiUsage`).
//
// That makes `remaining` an ESTIMATE, and every surface that shows it says so. Two
// things can make it drift: our price table (`ai/utils/aiUsageLogger.js`) going stale
// against OpenAI's, and spend from outside this bot on the same org. Re-anchoring is one
// field and takes a second, which is the right trade against a number that cannot be
// fetched at all. Note the floor on how far back it can see: `AiUsage` only began
// recording on 2026-10-27, when the SDK patch that feeds it was fixed.
//
// Why this matters more than the monthly cap: at $0 the API returns errors and the bot
// stops answering mid-conversation. OpenAI's own alerts fire on spend-against-the-cap,
// not on a low balance, and auto-reload is off — so nothing else in the system would say
// a word before it happened.

const WINDOW_DAYS = 7; // the burn rate used for "days left" — recent, not lifetime

/**
 * Current credit picture. Safe to call often; two cheap aggregates.
 *
 * @returns {Promise<{configured: boolean, balanceUsd: number|null, asOf: Date|null,
 *   spentSince: number, remaining: number|null, thresholdUsd: number, low: boolean,
 *   burnPerDay: number|null, daysLeft: number|null, estimate: true}>}
 */
async function creditStatus() {
  const SystemState = require("../models/SystemState");
  const AiUsage = require("../models/AiUsage");
  const s = await SystemState.getState();
  const c = (s && s.openAiCredit) || {};
  const thresholdUsd = c.thresholdUsd != null ? c.thresholdUsd : 5;

  if (c.balanceUsd == null || !c.asOf) {
    return {
      configured: false, balanceUsd: null, asOf: null, spentSince: 0, remaining: null,
      thresholdUsd, low: false, burnPerDay: null, burnReady: false, daysLeft: null, estimate: true,
    };
  }

  const since = new Date(c.asOf);
  const [spent] = await AiUsage.aggregate([
    { $match: { createdAt: { $gt: since } } },
    { $group: { _id: null, usd: { $sum: "$costUsd" } } },
  ]);
  const spentSince = spent ? spent.usd : 0;
  const remaining = Math.max(0, c.balanceUsd - spentSince);

  // Burn rate from the recent window, and deliberately NOT clamped to the anchor: the
  // rate is a property of the traffic, not of when someone last typed in a balance.
  // Anchoring it would blank out "days left" for a day every time the balance is
  // re-entered — exactly when it is being looked at. It IS clamped to the first record
  // we hold, because dividing by days we have no telemetry for understates the burn
  // (AiUsage only began recording on 2026-10-27).
  const winStart = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const [win] = await AiUsage.aggregate([
    { $match: { createdAt: { $gt: winStart } } },
    { $group: { _id: null, usd: { $sum: "$costUsd" }, first: { $min: "$createdAt" }, calls: { $sum: 1 } } },
  ]);
  const firstSeen = win && win.first ? new Date(win.first).getTime() : Date.now();
  const spanDays = (Date.now() - Math.max(winStart.getTime(), firstSeen)) / 86400000;
  // A rate needs a day of traffic behind it. Without this floor the first hours after
  // the telemetry was fixed produced "$0.07/day → 250 days left" from four test calls,
  // against the $1.46/day OpenAI itself was reporting — a comforting number that would
  // have let the balance hit zero unannounced. Better to show nothing than that.
  const burnReady = !!(win && win.usd > 0 && spanDays >= 1 && win.calls >= 50);
  const burnPerDay = burnReady ? win.usd / spanDays : null;

  return {
    configured: true,
    balanceUsd: c.balanceUsd,
    asOf: c.asOf,
    setBy: c.setBy || null,
    spentSince,
    remaining,
    thresholdUsd,
    low: remaining <= thresholdUsd,
    burnPerDay,
    burnReady,
    daysLeft: burnPerDay ? remaining / burnPerDay : null,
    notifiedAt: c.notifiedAt || null,
    estimate: true,
  };
}

/**
 * Alert the super_admin ONCE per drop below the threshold. Re-arms when the balance is
 * re-anchored (a top-up, or just re-reading the billing page), because `notifiedBalance`
 * is cleared on every write of the balance — so a refill genuinely resets the alert
 * instead of silencing it forever after the first fire.
 */
async function checkAndAlertLowCredit() {
  try {
    const st = await creditStatus();
    if (!st.configured || !st.low) return { alerted: false, ...st };

    const SystemState = require("../models/SystemState");
    const s = await SystemState.getState();
    if (s.openAiCredit?.notifiedAt) return { alerted: false, ...st };

    const money = (n) => `$${Number(n).toFixed(2)}`;
    const days = st.daysLeft != null ? ` (~${st.daysLeft.toFixed(1)} días al ritmo actual)` : "";
    const { sendToSuperAdmins } = require("../services/pushNotifications");
    await sendToSuperAdmins(
      "Crédito de OpenAI bajo",
      `Quedan aprox. ${money(st.remaining)} de crédito${days}. En $0 el bot deja de responder. Recarga en platform.openai.com.`,
      "/bot/costos-ia"
    ).catch((e) => console.error("⚠️ low-credit push failed:", e.message));

    s.openAiCredit.notifiedAt = new Date();
    s.openAiCredit.notifiedBalance = st.remaining;
    await s.save();
    console.warn(`💸 [openai-credit] LOW: ~${money(st.remaining)} left — super_admin alerted`);
    return { alerted: true, ...st };
  } catch (e) {
    console.error("❌ low-credit check failed:", e.message);
    return { alerted: false, error: e.message };
  }
}

module.exports = { creditStatus, checkAndAlertLowCredit, WINDOW_DAYS };
