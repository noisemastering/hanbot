#!/usr/bin/env node
// scripts/aiUsagePatchTest.js
//
// Proves that OpenAI token usage is actually recorded. The patch this covers replaced one
// that silently did nothing for months (assigning to `require('openai').OpenAI`, a getter
// with no setter on openai v6), and the failure was invisible precisely because telemetry
// is fire-and-forget: no error, no log, just an empty AiUsage collection. So the wiring
// gets a test that FAILS when the recorder stops being called.
//
// No network: the SDK's real `create` is swapped for a stub that returns a canned usage
// object BEFORE the patch is installed, so the patch wraps the stub exactly as it would
// wrap the real method. Probe docs are written to AiUsage and deleted at the end.
//
// Run: node scripts/aiUsagePatchTest.js

require("dotenv").config();
const mongoose = require("mongoose");

const PROBE_MODEL = "gpt-4o-mini"; // a real priced model, so the cost math is exercised
const PROBE_TOTAL = 4242;          // unmistakable in the DB

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const AiUsage = require("../models/AiUsage");
  const { OpenAI } = require("openai");
  const { computeCost } = require("../ai/utils/aiUsageLogger");

  // Stand in for the network call.
  const probeClient = new OpenAI({ apiKey: "sk-not-used" });
  const proto = Object.getPrototypeOf(probeClient.chat.completions);
  const realCreate = proto.create;
  let stubCalls = 0;
  proto.create = async function () {
    stubCalls++;
    return {
      model: PROBE_MODEL,
      usage: {
        prompt_tokens: 4000, completion_tokens: 242, total_tokens: PROBE_TOTAL,
        prompt_tokens_details: { cached_tokens: 1000 },
        completion_tokens_details: { reasoning_tokens: 42 },
      },
      choices: [{ message: { content: "ok" } }],
    };
  };

  const { installOpenAiUsagePatch } = require("../utils/openaiUsagePatch");
  ok("the patch installs", installOpenAiUsagePatch() === true);
  ok("installing twice is a no-op", installOpenAiUsagePatch() === false);

  const before = await AiUsage.countDocuments({ model: PROBE_MODEL, totalTokens: PROBE_TOTAL });

  // Two different ways to get a client — the old patch only ever reached one of them,
  // and on v6 not even that. Both must record.
  const viaNamed = new (require("openai").OpenAI)({ apiKey: "sk-not-used" });
  const viaDefault = new (require("openai"))({ apiKey: "sk-not-used" });
  await viaNamed.chat.completions.create({ model: PROBE_MODEL, messages: [] });
  await viaDefault.chat.completions.create({ model: PROBE_MODEL, messages: [] });
  // A client built BEFORE the patch was installed must record too — prototype, not instance.
  await probeClient.chat.completions.create({ model: PROBE_MODEL, messages: [] });

  ok("the call still reaches the SDK", stubCalls === 3, `stub calls: ${stubCalls}`);

  // recordUsage is fire-and-forget, so give the writes a moment to land.
  await new Promise((r) => setTimeout(r, 1500));
  const docs = await AiUsage.find({ model: PROBE_MODEL, totalTokens: PROBE_TOTAL }).sort({ createdAt: -1 }).limit(5).lean();
  ok("every call was recorded", docs.length - before >= 3, `found ${docs.length}, had ${before}`);

  const d = docs[0];
  ok("tokens are stored", !!d && d.promptTokens === 4000 && d.completionTokens === 242);
  ok("cached and reasoning tokens are kept", !!d && d.cachedTokens === 1000 && d.reasoningTokens === 42);
  // 3000 uncached in @ $0.15/M + 1000 cached @ $0.075/M + 242 out @ $0.60/M
  const expected = (3000 * 0.15 + 1000 * 0.075 + 242 * 0.6) / 1e6;
  ok("the cost matches the price sheet", !!d && Math.abs(d.costUsd - expected) < 1e-9,
    `${d && d.costUsd} vs ${expected}`);
  ok("the cached discount is actually applied", computeCost(PROBE_MODEL, { prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1000 } })
    < computeCost(PROBE_MODEL, { prompt_tokens: 1000, completion_tokens: 0 }));

  await AiUsage.deleteMany({ model: PROBE_MODEL, totalTokens: PROBE_TOTAL });
  proto.create = realCreate;
  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
