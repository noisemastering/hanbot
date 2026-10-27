#!/usr/bin/env node
// scripts/lastResortTest.js
//
// The recovery line the bot sends when every engine flow came back empty — the silence
// Marbella got on 2026-10-24 ("Buenos días" / "Costo de La malla sombra" → nothing).
// It is the one reply nobody reviews until a customer has already seen it, and it must
// also be the one reply that cannot promise anything: the engine just failed, so we do
// not know the product, the measure or the price.
//
// The escalation is STUBBED here (it writes to the DB and pushes a notification), which
// is the point of the test: the text and the fact that it escalates exactly once are
// checked without touching prod.
//
// Run: node scripts/lastResortTest.js

require("dotenv").config();

// Stub the push service before ai/index pulls it in.
const pushPath = require.resolve("../services/pushNotifications");
const calls = [];
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true, exports: {
    triggerHandoff: async (psid, reason) => { calls.push({ psid, reason }); return true; },
  },
};

const { lastResortReply, LAST_RESORT_TEXT } = require("../ai/index");

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}`); }
}

(async () => {
  const text = await lastResortReply("test:last-resort", "Costo de La malla sombra");

  ok("returns the recovery text", text === LAST_RESORT_TEXT && !!text);
  ok("escalates exactly once", calls.length === 1 && calls[0].psid === "test:last-resort");
  ok("the reason names the engine failure, for the brief's system category",
    /falla del motor/i.test(calls[0].reason) && /sigue esperando/i.test(calls[0].reason));

  // It must never invent what the engine failed to work out.
  ok("quotes no price", !/\$|\bpesos\b/i.test(text));
  ok("names no measure", !/\d\s*[x×]\s*\d/.test(text));
  ok("promises no delivery time or discount", !/descuento|promoci[oó]n|hoy mismo|mañana|gratis/i.test(text));
  ok("shares no link (the link is what we couldn't resolve)", !/https?:\/\//i.test(text));
  // And it must leave the customer with a way forward: the two things an asesor needs.
  ok("asks for the measure", /medida/i.test(text));
  ok("asks for the CP", /c[oó]digo postal/i.test(text));
  ok("says a person will follow up", /compañero|asesor|especialista/i.test(text));
  ok("short enough for a chat bubble", text.length < 320);
  // The brief sorts on this wording; a silent failure must read as OUR fault, not as
  // the customer having given nothing.
  ok("does not blame the customer", !/no proporcion|no contest/i.test(text));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
