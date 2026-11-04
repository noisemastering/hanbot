// scripts/coldLeadTest.js
//
// The one decision the pending-handoff timeout makes: ESCALATE this silent lead, or PARK
// it as cold and tell nobody. Reported 2026-10-27 by the asesora — "me mandó la alerta y
// el cliente aún no contesta nada" — and the user's rule for it: "if they don't provide
// their info for a quote we won't bother the salesforce with dead customers."
//
// Getting this wrong in either direction is expensive: park a reachable lead and a real
// sale goes unworked; escalate a dead one and we are back to the alert nobody can act on.
//
// TWO predicates, and the difference is the point (2026-11-04):
//   • handoffContactOf — what the asesor would have to WORK WITH. The CP belongs here:
//     the freight quote starts at it and the brief prints it.
//   • worthAlerting    — whether a SILENT lead is worth a PUSH. Only a phone or an email
//     the customer TYPED. The user's rule: "customers must provide their info before
//     handed off, otherwise they are not showing interest."
// The first section below tests contact-ness, not whether an alert goes out.
//
// Run: node scripts/coldLeadTest.js

const { handoffContactOf, worthAlerting } = require("../utils/coldLead");

let pass = 0, fail = 0;

function check(label, convo, expectAny, expectWhich) {
  const got = handoffContactOf(convo);
  const okAny = got.any === expectAny;
  const okWhich = !expectWhich || expectWhich.every((k) => !!got[k]);
  if (okAny && okWhich) {
    pass++;
    console.log(`✅ ${label} → ${got.any ? "escalate" : "park"}`);
  } else {
    fail++;
    console.log(`❌ ${label} → expected ${expectAny ? "escalate" : "park"}, got ${got.any ? "escalate" : "park"} ${JSON.stringify(got)}`);
  }
}

// ── PARK: nothing anyone can act on ─────────────────────────────────────────
// The reported conversation itself: one price question, the bot answered and asked for
// a phone + CP, and he never wrote again. The profile name is NOT contact — the platform
// hands us one on every conversation, which is what made this lead look complete.
check("the reported lead (profile name only)", {
  psid: "28849089548033204",
  extractedName: "Azul García",
  workflowState: { lead: { name: "Azul García" } },
}, false);

check("empty conversation", {}, false);
check("no workflowState at all", { psid: "x" }, false);
check("lead with only a name typed by the customer", { workflowState: { lead: { name: "Maria Celia" } } }, false);
check("product interest but no contact", { productInterest: "ground_cover", requestedSize: "2x100" }, false);
// A measure is not a way to reach anybody, and neither is a colonia — the freight quote
// needs the CP. Both are worth having; neither rescues a dead lead.
check("colonia but no CP and no phone", { neighborhood: "Centro" }, false);
check("empty strings are not data", {
  zipcode: "", workflowState: { lead: { phone: "", email: "" }, location: { zip: "" } },
}, false);

// ── CONTACT: something to work with (NOT the same as "worth an alert" — see below) ──
check("phone from the engine lead", { workflowState: { lead: { phone: "4421234567" } } }, true, ["phone"]);
// captureLateContact writes the engine lead; the legacy paths write leadData.contact.
// Both have to count, or a lead that gave a number gets parked anyway.
check("phone from leadData.contact", { leadData: { contact: "4421234567" } }, true, ["phone"]);
check("email only", { workflowState: { lead: { email: "a@b.mx" } } }, true, ["email"]);
check("CP on the conversation", { zipcode: "76000" }, true, ["zip"]);
check("CP in the engine location", { workflowState: { location: { zip: "92730" } } }, true, ["zip"]);
check("CP under the older zipcode key", { workflowState: { location: { zipcode: "50000" } } }, true, ["zip"]);
check("CP from leadData", { leadData: { zipcode: "76000" } }, true, ["zip"]);
check("CP from the human-sales flow", { humanSalesZipcode: "76000" }, true, ["zip"]);
check("CP on the legacy capitalised field", { zipCode: "76000" }, true, ["zip"]);
check("phone AND CP", {
  workflowState: { lead: { phone: "4421234567", name: "Azul" }, location: { zip: "76000" } },
}, true, ["phone", "zip"]);


// ── WORTH ALERTING: narrower than "has contact" ──────────────────────────────
// The user's rule, 2026-11-04: "customers must provide their info before handed off,
// otherwise they are not showing interest." A CP and a name are both useful — the brief
// prints them, the freight quote starts at the CP — but neither is something a
// salesperson can ACT on, and the platform hands us a name for free on every
// conversation. wa:5217351681034 was reported twice the same morning ("Me mandó la
// alerta y no requería atención") because her CP, given in answer to the SHIPPING
// question, made a silent lead look complete.
const ALERT_CASES = [
  { why: "a phone the customer typed is worth waking someone for",
    c: { workflowState: { lead: { phone: "4423521646" } } }, expect: true },
  { why: "an email too",
    c: { workflowState: { lead: { email: "cliente@correo.com" } } }, expect: true },
  { why: "THE REPORTED CASE: a CP alone is not",
    c: { workflowState: { location: { zip: "72760" } } }, expect: false },
  { why: "a CP on the Conversation root is still only a CP",
    c: { zipcode: "76286" }, expect: false },
  { why: "a name alone is not — the platform gives us one for free",
    c: { workflowState: { lead: { name: "Nubia Cervantes" } } }, expect: false },
  { why: "name + CP is still nothing to call",
    c: { workflowState: { lead: { name: "Nubia" }, location: { zip: "72760" } } }, expect: false },
  { why: "phone + CP: the complete lead",
    c: { workflowState: { lead: { phone: "4423521646" }, location: { zip: "72760" } } }, expect: true },
  { why: "leadData.contact counts as the phone (legacy capture path)",
    c: { leadData: { contact: "4423521646" } }, expect: true },
  { why: "nothing at all",
    c: {}, expect: false },
];
for (const t of ALERT_CASES) {
  const got = worthAlerting(t.c);
  if (got === t.expect) { pass++; console.log(`✅ alert=${String(t.expect).padEnd(5)} ${t.why}`); }
  else { fail++; console.log(`❌ ${t.why}\n   worthAlerting → ${got}, expected ${t.expect}`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
