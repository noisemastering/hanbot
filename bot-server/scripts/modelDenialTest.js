// scripts/modelDenialTest.js — measure how often the main-reply model DENIES an
// in-catalog size instead of quoting it. Run per model:
//   WORKFLOW_MODEL=gpt-5.4-mini node scripts/modelDenialTest.js
//   WORKFLOW_MODEL=gpt-5.6-luna node scripts/modelDenialTest.js
require("dotenv").config(); // does NOT override a shell-set WORKFLOW_MODEL
const m = require("mongoose");
(async () => {
  await m.connect(process.env.MONGODB_URI);
  const WF = require("../models/Workflow");
  const { runWorkflowTurn, initState } = require("../ai/workflow/index.js");
  const { CHAT_MODEL } = require("../ai/workflow/llmClient");
  const TRI = "6941e4abe41e752e5b96ed45"; // triangular 5x5x5 ad preload (matches the reported convos)
  const wf = await WF.findOne({ name: /con Refuerzo.*Retail/i, active: true });
  const cases = [
    ["7x7", "Hola, ocupo una,pero de 7×7,precio,porfavor"],
    ["5x5", "precio de una de 5x5 metros"],
    ["8x8", "una de 8x8 metros precio"],
    ["4x3", "precio de 4x3"],
    ["6x9", "me podría cotizar una malla de 6mx9m color beige"],
  ];
  const N = 5;
  const DENY = /no est[aá]|no dispon|no la manejo|no contamos|m[aá]s cercana|medida especial|\basesor\b|especialista|fuera de|no maneja/i;
  console.log(`\nMODEL: ${CHAT_MODEL}  |  ${N} runs/case  |  triangular preload\n`);
  let totQ = 0, totBad = 0;
  for (const [lbl, msg] of cases) {
    let q = 0, bad = 0;
    for (let i = 0; i < N; i++) {
      const r = await runWorkflowTurn(wf, initState(wf, {}, { hasPromo: TRI }), msg, { psid: `CMP-${lbl}-${i}`, sandbox: true });
      const t = r.reply || "";
      const denied = DENY.test(t);
      const quoted = /\$|\b\d{3,4}\b/.test(t) && /http/.test(t) && !denied;
      if (quoted) { q++; totQ++; } else { bad++; totBad++; }
    }
    console.log(`  ${lbl}:  ✅ ${q}/${N} quoted   ❌ ${bad}/${N} denied/handoff`);
  }
  console.log(`\n  TOTAL: ✅ ${totQ}/${cases.length * N} quoted   ❌ ${totBad}/${cases.length * N} denied/handoff\n`);
  await m.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
