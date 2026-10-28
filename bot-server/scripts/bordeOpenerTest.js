#!/usr/bin/env node
// scripts/bordeOpenerTest.js
//
// THE AD'S OWN FIRST MESSAGE MUST GET PRICES (2026-10-28, two asesora reports:
// "no dio los precios", "no le termina de dar precio").
//
// Meta prefills the click-to-WhatsApp message, so on the borde campaign almost every
// conversation opens with "¡Hola! Quiero más información" or "Quiero obtener más
// información." — 37 of them in the 30 days before this was written. Neither matched
// the borde info-opener gate, which demanded the whole message be one of a handful of
// bare tokens; a bare "Información" got the four priced lengths and the ad's own
// wording did not. It fell to the model, which has NO price in context on this flow
// (the ad preloads the FAMILY, not a leaf), and answered with a list of largos and no
// numbers — or, three times that morning, with a literal "[precio]" where each number
// belonged.
//
// So this covers both halves: the opener quotes, and a reply that still carries an
// unfilled placeholder is never sent.
//
// Needs the DB and resolves LIVE prices (that is the point — a hardcoded amount would
// pass while the quote was broken), so amounts are asserted as "a number", never as a
// value. NO LLM for the opener cases: if the gate claims the turn, no model runs — a
// case that reaches the model fails loudly, which is exactly the regression to catch.
//
// Run: node scripts/bordeOpenerTest.js

require("dotenv").config();
const mongoose = require("mongoose");

const BORDE_WF = "6a286dfbad0ab617355c63f8"; // Borde separador - Mayoreo y menudeo
// What the ad assigns: the FAMILY, not a measure — which is why nothing is preloaded.
const AD_SETUP = {
  buyer: "reseller", tone: "professional", purchaseType: "wholesale", saleChannel: "marketplace",
  products: [{ kind: "family", id: "68f6c372bfaca6a28884afd9", name: "Borde Separador" }],
};

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// Stub the model BEFORE the engine is loaded (it destructures executeNode at module
// scope). `reply` null = "the model was never supposed to run this turn".
const nePath = require.resolve("../ai/workflow/nodeExecutor");
const real = require(nePath);
let stubText = null, stubCalls = 0;
require.cache[nePath].exports = {
  ...real,
  executeNode: async (...args) => {
    stubCalls++;
    if (stubText != null) return { text: stubText, toolCalls: [] };
    return { text: "[EL MODELO NO DEBÍA CORRER ESTE TURNO]", toolCalls: [] };
  },
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Workflow = require("../models/Workflow");
  const { runWorkflowTurn, initState } = require("../ai/workflow");
  const wf = await Workflow.findById(BORDE_WF);
  if (!wf) { console.error(`❌ workflow ${BORDE_WF} not found`); process.exit(1); }

  const turn = async (msg) => {
    const before = stubCalls;
    const r = await runWorkflowTurn(wf, initState(wf, {}, AD_SETUP), msg, { psid: "test:borde-opener", sandbox: true });
    return { text: r.reply || "", diag: r.diagnostics || {}, hitModel: stubCalls > before };
  };
  const priced = (t) => (t.match(/\$\s?[\d,]+(?:\.\d+)?/g) || []).length;
  const lengths = (t) => ["6", "9", "18", "54"].filter((l) => new RegExp(`\\b${l}\\s*m\\b`).test(t));

  // 1. The two messages Meta actually prefills. These are THE regression.
  for (const msg of ["¡Hola! Quiero más información", "Quiero obtener más información."]) {
    const { text, hitModel, diag } = await turn(msg);
    ok(`"${msg}" is answered by the gate, not the model`, !hitModel && diag.bordeInfoOpener === true, text.slice(0, 90));
    ok(`"${msg}" quotes all four lengths with prices`,
      lengths(text).length === 4 && priced(text) >= 4, `lengths ${lengths(text).join("/")}, prices ${priced(text)}`);
    ok(`"${msg}" names no placeholder`, !/\[[a-z_]+\]/i.test(text), text.slice(0, 120));
  }

  // 2. The wordings that already worked must keep working. A BARE "Hola" is not in
  //    the list on purpose: the flow-agnostic greeting gate upstream owns it and
  //    answers with "¿en qué te puedo ayudar?" — unchanged by any of this.
  for (const msg of ["Información", "Hola, me interesa", "Buenas tardes, informes"]) {
    const { text, hitModel } = await turn(msg);
    ok(`"${msg}" still gets the priced menu`, !hitModel && lengths(text).length === 4 && priced(text) >= 4, text.slice(0, 90));
  }

  // 3. An opener that ASKS SOMETHING ELSE must not be swallowed by it — the gate that
  //    answers half a message drops the other half, which is its own reported bug.
  for (const msg of ["Hola, ¿cuánto tarda el envío?", "Hola, ¿lo tienen en verde?", "Hola, ¿dónde están ubicados?", "Hola, quiero precio de mayoreo"]) {
    const { diag } = await turn(msg);
    ok(`"${msg}" is not claimed by the opener`, diag.bordeInfoOpener !== true);
  }

  // 4. A digit means the message carries a measure or a quantity; the opener never
  //    talks over one.
  for (const msg of ["Hola, quiero información del de 18 m", "Hola quiero info, necesito 3"]) {
    const { diag } = await turn(msg);
    ok(`"${msg}" is not claimed by the opener`, diag.bordeInfoOpener !== true);
  }

  // 5. THE PLACEHOLDER GUARD. A model reply that still carries "[precio]" is a
  //    template, not an answer: it must never be sent. Dropping it hands the turn to
  //    the engine's rescue ladder in ai/index.js.
  // The probe message must be one the gates do NOT claim, or the model never runs:
  // a shipping question reaches it (and the gates contribute the borde facts).
  const MODEL_TURN = "¿Cuánto tarda el envío?";
  stubText = "Te comparto los precios:\n- Rollo de 6 m: [precio]\n- Rollo de 9 m: [precio]";
  const ph = await turn(MODEL_TURN);
  ok("a reply with [precio] is dropped, not sent", ph.text === "", ph.text.slice(0, 120));

  // A missing template variable leaks the same way (applyVars leaves the token).
  stubText = "¡Hola [first_name]! Con gusto te ayudo.";
  const ph2 = await turn(MODEL_TURN);
  ok("an unfilled [first_name] is dropped too", ph2.text === "", ph2.text.slice(0, 120));

  // And a legitimate reply with brackets in it is NOT dropped.
  stubText = "Mira el catálogo aquí: [catálogo](https://hanlob.com.mx) y me dices.";
  const okLink = await turn(MODEL_TURN);
  // (the engine rewrites the URL to the tracked catalog link — what matters is that
  //  the reply SURVIVED the guard.)
  ok("a markdown link is not a placeholder", /\[cat[aá]logo\]\(http/i.test(okLink.text), okLink.text.slice(0, 120));
  stubText = "Recibí tu mensaje [Reacción enviada] y con gusto te ayudo.";
  const okReact = await turn(MODEL_TURN);
  ok("bracketed text with a space is not a placeholder", okReact.text !== "", okReact.text.slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
