#!/usr/bin/env node
// scripts/openAiCreditTest.js
//
// The low-credit alert (2026-10-27): "I need an alert for my eyes only when I have 5 USD
// left." At $0 the OpenAI API errors and the bot stops answering mid-conversation, and
// nothing else warns — OpenAI alerts on spend against the monthly cap, not on a low
// prepaid balance, and auto-reload is off. So the thing that must never break is: it
// fires, it fires ONCE, and it fires again after a top-up.
//
// NO PUSH IS SENT: sendToSuperAdmins is stubbed. The test DOES write SystemState (there
// is one shared state document) — it snapshots `openAiCredit` first and restores it in a
// finally block, so the real balance survives even if an assertion throws.
//
// Run: node scripts/openAiCreditTest.js

require("dotenv").config();
const mongoose = require("mongoose");

// Stub the push before the credit module can pull it in.
const pushPath = require.resolve("../services/pushNotifications");
const pushes = [];
const realPush = require(pushPath);
require.cache[pushPath].exports = {
  ...realPush,
  sendToSuperAdmins: async (title, body, url) => { pushes.push({ title, body, url }); return { sent: 1 }; },
};

const { creditStatus, checkAndAlertLowCredit } = require("../utils/openAiCredit");

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function setCredit(SystemState, patch) {
  const s = await SystemState.getState();
  s.openAiCredit = { ...(s.openAiCredit ? s.openAiCredit.toObject?.() || s.openAiCredit : {}), ...patch };
  await s.save();
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const SystemState = require("../models/SystemState");
  const snapshot = (await SystemState.getState()).openAiCredit;
  const saved = snapshot ? JSON.parse(JSON.stringify(snapshot)) : {};

  try {
    // 1. Nothing captured yet: no number, and above all NO alert — an unconfigured
    //    watch must stay quiet rather than cry wolf at a balance it doesn't know.
    await setCredit(SystemState, { balanceUsd: null, asOf: null, notifiedAt: null, notifiedBalance: null, thresholdUsd: 5 });
    let st = await creditStatus();
    ok("unconfigured reports nothing", st.configured === false && st.remaining === null);
    ok("unconfigured never alerts", (await checkAndAlertLowCredit()).alerted === false && pushes.length === 0);

    // 2. Comfortable balance, anchored a second ago: no alert.
    await setCredit(SystemState, { balanceUsd: 100, asOf: new Date(), thresholdUsd: 5, notifiedAt: null, notifiedBalance: null });
    st = await creditStatus();
    ok("a healthy balance is not low", st.configured && st.low === false, `remaining ${st.remaining}`);
    ok("a healthy balance does not alert", (await checkAndAlertLowCredit()).alerted === false && pushes.length === 0);

    // 3. Spend is subtracted from the anchor. Anchor in the PAST so today's real
    //    AiUsage records count against it — that is the whole mechanism.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    await setCredit(SystemState, { balanceUsd: 100, asOf: dayAgo, thresholdUsd: 5, notifiedAt: null, notifiedBalance: null });
    st = await creditStatus();
    ok("spend since the anchor is subtracted", st.spentSince >= 0 && Math.abs((100 - st.spentSince) - st.remaining) < 1e-9,
      `spent ${st.spentSince}, remaining ${st.remaining}`);

    // 4. Below the threshold: it alerts, exactly once.
    await setCredit(SystemState, { balanceUsd: 4.2, asOf: new Date(), thresholdUsd: 5, notifiedAt: null, notifiedBalance: null });
    st = await creditStatus();
    ok("below the threshold reads as low", st.low === true, `remaining ${st.remaining}`);
    const first = await checkAndAlertLowCredit();
    ok("it alerts", first.alerted === true && pushes.length === 1);
    ok("the alert says the amount and the consequence",
      /4\.\d\d/.test(pushes[0]?.body || "") && /deja de responder/i.test(pushes[0]?.body || ""), pushes[0]?.body);
    ok("the alert points at Costos IA", pushes[0]?.url === "/bot/costos-ia");
    const second = await checkAndAlertLowCredit();
    ok("it does not alert again on the next tick", second.alerted === false && pushes.length === 1);

    // 5. A top-up re-anchors and re-arms — otherwise the first alert would be the last
    //    one this account ever got.
    await setCredit(SystemState, { balanceUsd: 50, asOf: new Date(), notifiedAt: null, notifiedBalance: null });
    ok("after a top-up it is no longer low", (await creditStatus()).low === false);
    await setCredit(SystemState, { balanceUsd: 1, asOf: new Date(), notifiedAt: null, notifiedBalance: null });
    ok("and it can alert again when it drops", (await checkAndAlertLowCredit()).alerted === true && pushes.length === 2);

    // 6. A burn rate is only shown when there is a day of telemetry behind it. The
    //    first hours after the recorder was fixed produced "$0.07/day → 250 days left"
    //    from four test calls, against the $1.46/day OpenAI itself reported.
    await setCredit(SystemState, { balanceUsd: 100, asOf: new Date(), thresholdUsd: 5, notifiedAt: null, notifiedBalance: null });
    st = await creditStatus();
    const AiUsage = require("../models/AiUsage");
    const span = await AiUsage.aggregate([
      { $match: { createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } } },
      { $group: { _id: null, first: { $min: "$createdAt" }, calls: { $sum: 1 } } },
    ]);
    const haveADay = !!span[0] && (Date.now() - new Date(span[0].first).getTime()) / 86400000 >= 1 && span[0].calls >= 50;
    ok("the burn rate is only reported with enough telemetry behind it",
      st.burnReady === haveADay && (st.burnReady ? st.burnPerDay > 0 : st.burnPerDay === null),
      `burnReady ${st.burnReady}, have a day of data: ${haveADay}`);
    ok("no rate means no days-left figure (better blank than falsely reassuring)",
      st.burnReady || st.daysLeft === null);

    // 7. The threshold is configurable — 5 USD is the default the user asked for, not a
    //    hardcode.
    await setCredit(SystemState, { balanceUsd: 12, asOf: new Date(), thresholdUsd: 20, notifiedAt: null, notifiedBalance: null });
    ok("a higher threshold makes the same balance low", (await creditStatus()).low === true);
    await setCredit(SystemState, { balanceUsd: 12, asOf: new Date(), thresholdUsd: 5, notifiedAt: null, notifiedBalance: null });
    ok("a lower threshold makes it healthy again", (await creditStatus()).low === false);
  } finally {
    const s = await SystemState.getState();
    s.openAiCredit = saved;
    await s.save();
    console.log("\n↩︎  restored the real openAiCredit state");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
